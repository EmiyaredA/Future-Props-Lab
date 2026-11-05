"""Record the reviewed source ranges for an independent segment group."""

from sqlalchemy import text

from app.apps.video_editor.errors import (
    VideoEditorNotFoundError,
    VideoEditorValidationError,
)
from app.apps.video_editor.models import VideoEditorTask, VideoEditorTimeline
from app.apps.video_editor.segment_names import segment_filename
from app.apps.video_editor.segment_selection import segment_selection
from app.apps.video_editor.task_reads import VideoTaskReads, task_out
from app.runtime.ids import new_id
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now
from fpl_runtime.video_exports import ExportInput, SegmentEncodeInput, VideoSegmentRequest

from .models import VideoRenderDispatch, VideoSegmentDelivery
from .segment_targets import plan_target

KIND = "segment_export"
MISSING = "分段导出任务不存在"


class SegmentRequests:
    def __init__(self, session, owner, request=None):
        self.session, self.owner, self.request = session, owner, request
        self.reads = VideoTaskReads(session, owner)

    async def _existing(self, project, request_id, payload):
        query = await self.reads.query(project, None)
        task = await self.session.scalar(query.where(VideoEditorTask.request_id == request_id))
        if task is not None and (task.kind != KIND or task.request_payload != payload):
            raise VideoEditorValidationError("requestId 已用于不同任务", code="request_id_reused")
        return task

    async def _timeline(self, project, expected):
        timeline = await self.session.get(VideoEditorTimeline, project, populate_existing=True)
        if timeline is None:
            raise VideoEditorNotFoundError("时间轴不存在")
        if timeline.revision != expected:
            raise RevisionConflictError(
                expected,
                timeline.revision,
                {"revision": timeline.revision, "document": timeline.document},
            )
        return timeline

    async def create(self, project, body):
        payload = body.model_dump(mode="json", by_alias=True)
        existing = await self._existing(project, body.request_id, payload)
        if existing is not None:
            return task_out(existing)
        timeline = await self._timeline(project, body.expected_revision)
        document = timeline.document
        target = None
        if body.target is not None:
            await self.session.rollback()
            target = await plan_target(self.request, body.target)
        selected = segment_selection(document, body.segments)
        ids = {item["assetId"] for item in selected}
        media = self.session.info["video_timeline_assets"](self.session, self.owner)
        assets = await media.describe(project, ids)
        if assets.keys() != ids or any(
            item.processing_status != "ready" or item.kind != "video" for item in assets.values()
        ):
            raise VideoEditorValidationError("部分视频素材尚未处理完成", code="asset_not_ready")
        await media.guard_write(project)
        existing = await self._existing(project, body.request_id, payload)
        if existing is not None:
            return task_out(existing)
        await self._timeline(project, body.expected_revision)
        try:
            frozen = VideoSegmentRequest(
                target=target,
                files=tuple(
                    ExportInput(id=identity, sha256=assets[identity].fingerprint)
                    for identity in sorted(ids)
                ),
                segments=tuple(
                    SegmentEncodeInput(
                        asset_id=clip["assetId"],
                        filename=segment_filename(item.name),
                        source_in_us=clip["sourceInUs"],
                        duration_us=clip["durationUs"],
                        playback_rate=clip["playbackRate"],
                        resolution=item.resolution,
                        fps=item.fps,
                        quality=item.quality,
                        audio_mode=item.audio_mode,
                        label=item.name if target else None,
                    )
                    for clip, item in zip(selected, body.segments, strict=True)
                ),
            )
        except ValueError:
            raise VideoEditorValidationError(
                "部分视频素材摘要无效", code="asset_not_ready"
            ) from None
        task = VideoEditorTask(
            id=new_id(),
            owner_user_id=self.owner,
            project_id=project,
            request_id=body.request_id,
            kind=KIND,
            request_payload=payload,
            snapshot_document=document,
            result_detail={
                "timelineRevision": body.expected_revision,
                "importRequested": target is not None,
                "targetCanvasRevision": target.expected_revision if target else None,
                "segments": selected,
            },
        )
        self.session.add_all(
            (
                task,
                VideoRenderDispatch(
                    task_id=task.id,
                    owner_user_id=self.owner,
                    project_id=project,
                    frozen=frozen.model_dump(mode="json"),
                ),
            )
        )
        await self.session.commit()
        return task_out(task)

    async def cancel(self, project, identity):
        await self.session.execute(text("BEGIN IMMEDIATE"))
        query = await self.reads.query(project, KIND)
        task = await self.session.scalar(query.where(VideoEditorTask.id == identity))
        if task is None:
            raise VideoEditorNotFoundError(MISSING)
        delivery = await self.session.get(VideoSegmentDelivery, identity)
        if task.status in {"queued", "running"} and not (delivery and delivery.state == "commit"):
            task.cancel_requested = True
            if task.status == "queued":
                task.status, task.progress, task.finished_at = "cancelled", 0, utc_now()
            task.revision += 1
            task.updated_at = utc_now()
            await self.session.commit()
        return task_out(task)
