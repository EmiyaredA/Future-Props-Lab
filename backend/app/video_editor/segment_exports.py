from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    VideoEditorAssetMetadata,
    VideoEditorTask,
    VideoEditorTimeline,
    VisualAsset,
    VisualCanvasDocument,
    VisualWorkshopProject,
)
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now
from app.schemas.video_editor import (
    VideoEditorSegmentExportCreateIn,
    VideoEditorTaskListOut,
    VideoEditorTaskOut,
    VideoEditorTimelineDocument,
)
from app.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from app.video_editor.projects import VideoEditorProjects
from app.video_editor.rendering import task_out


class VideoEditorSegmentExports:
    def __init__(self, session: AsyncSession, workspace_id: str) -> None:
        self.session = session
        self.workspace_id = workspace_id

    async def _timeline(self, project_id: str) -> VideoEditorTimeline:
        await VideoEditorProjects(self.session, self.workspace_id).row(project_id)
        row = await self.session.get(VideoEditorTimeline, project_id)
        if row is None:
            raise VideoEditorNotFoundError("时间轴不存在")
        return row

    async def create(
        self, project_id: str, body: VideoEditorSegmentExportCreateIn
    ) -> VideoEditorTaskOut:
        payload = body.model_dump(mode="json", by_alias=True)
        existing = (
            await self.session.execute(
                select(VideoEditorTask).where(
                    VideoEditorTask.project_id == project_id,
                    VideoEditorTask.workspace_id == self.workspace_id,
                    VideoEditorTask.request_id == body.request_id,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            if existing.kind != "segment_export" or existing.request_payload != payload:
                raise VideoEditorValidationError(
                    "requestId 已用于不同任务", code="request_id_reused"
                )
            return task_out(existing)

        timeline = await self._timeline(project_id)
        if timeline.revision != body.expected_revision:
            raise RevisionConflictError(
                body.expected_revision,
                timeline.revision,
                {"revision": timeline.revision, "document": timeline.document},
            )
        if body.target and body.target.project_id:
            target = (
                await self.session.execute(
                    select(VisualWorkshopProject).where(
                        VisualWorkshopProject.id == body.target.project_id,
                        VisualWorkshopProject.workspace_id == self.workspace_id,
                    )
                )
            ).scalar_one_or_none()
            if target is None:
                raise VideoEditorValidationError("目标工作坊项目不存在", code="target_not_found")
            target_canvas = await self.session.get(VisualCanvasDocument, body.target.project_id)
            if target_canvas is None:
                raise VideoEditorValidationError("目标工作坊画布不存在", code="target_not_found")

        document = VideoEditorTimelineDocument.model_validate(timeline.document)
        clips = {
            clip.id: clip
            for track in document.tracks
            for clip in track.clips
            if clip.kind == "video"
        }
        selected = []
        for item in body.segments:
            clip = clips.get(item.clip_id)
            if clip is None or not clip.asset_id:
                raise VideoEditorValidationError(
                    f"视频片段 {item.clip_id} 不存在", code="clip_not_found"
                )
            selected.append((item, clip))
        asset_ids = {clip.asset_id for _item, clip in selected if clip.asset_id}
        rows = list(
            (
                await self.session.execute(
                    select(VisualAsset, VideoEditorAssetMetadata)
                    .join(
                        VideoEditorAssetMetadata,
                        VideoEditorAssetMetadata.asset_id == VisualAsset.id,
                    )
                    .where(
                        VisualAsset.id.in_(asset_ids),
                        VisualAsset.video_editor_project_id == project_id,
                    )
                )
            ).all()
        )
        assets = {asset.id: metadata for asset, metadata in rows}
        if set(assets) != asset_ids or any(
            assets[asset_id].processing_status != "ready" for asset_id in asset_ids
        ):
            raise VideoEditorValidationError("部分视频素材尚未处理完成", code="asset_not_ready")

        detail_segments = [
            {
                "clipId": clip.id,
                "name": item.name,
                "sourceInUs": clip.source_in_us,
                "playbackRate": clip.playback_rate or 1,
                "durationUs": clip.duration_us,
                "assetId": clip.asset_id,
                "status": "queued",
                "progress": 0,
            }
            for item, clip in selected
        ]
        task = VideoEditorTask(
            workspace_id=self.workspace_id,
            project_id=project_id,
            request_id=body.request_id,
            kind="segment_export",
            request_payload=payload,
            snapshot_document=timeline.document,
            result_detail={
                "timelineRevision": timeline.revision,
                "importRequested": body.target is not None,
                "targetCanvasRevision": (
                    target_canvas.revision if body.target and body.target.project_id else None
                ),
                "segments": detail_segments,
            },
        )
        self.session.add(task)
        await self.session.commit()
        await self.session.refresh(task)
        return task_out(task)

    async def list(self, project_id: str) -> VideoEditorTaskListOut:
        await VideoEditorProjects(self.session, self.workspace_id).row(project_id)
        rows = list(
            (
                await self.session.execute(
                    select(VideoEditorTask)
                    .where(
                        VideoEditorTask.project_id == project_id,
                        VideoEditorTask.workspace_id == self.workspace_id,
                        VideoEditorTask.kind == "segment_export",
                    )
                    .order_by(VideoEditorTask.created_at.desc())
                )
            ).scalars()
        )
        return VideoEditorTaskListOut(items=[task_out(row) for row in rows])

    async def get(self, project_id: str, task_id: str) -> VideoEditorTaskOut:
        await VideoEditorProjects(self.session, self.workspace_id).row(project_id)
        row = (
            await self.session.execute(
                select(VideoEditorTask).where(
                    VideoEditorTask.id == task_id,
                    VideoEditorTask.project_id == project_id,
                    VideoEditorTask.workspace_id == self.workspace_id,
                    VideoEditorTask.kind == "segment_export",
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise VideoEditorNotFoundError("分段导出任务不存在")
        return task_out(row)

    async def cancel(self, project_id: str, task_id: str) -> VideoEditorTaskOut:
        await VideoEditorProjects(self.session, self.workspace_id).row(project_id)
        row = (
            await self.session.execute(
                select(VideoEditorTask).where(
                    VideoEditorTask.id == task_id,
                    VideoEditorTask.project_id == project_id,
                    VideoEditorTask.workspace_id == self.workspace_id,
                    VideoEditorTask.kind == "segment_export",
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise VideoEditorNotFoundError("分段导出任务不存在")
        if row.status in {"queued", "running"}:
            row.cancel_requested = True
            if row.status == "queued":
                row.status = "cancelled"
                row.progress = 0
                row.finished_at = utc_now()
            row.revision += 1
            row.updated_at = utc_now()
            await self.session.commit()
        return task_out(row)
