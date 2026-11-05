"""Freeze the exact reviewed timeline and commit it with a Video export task."""

from pathlib import Path

from sqlalchemy import case, select, text, update

from app.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from app.apps.video_editor.models import VideoEditorAssetMetadata, VideoEditorTask
from app.apps.video_editor.projects import VideoEditorProjects
from app.apps.video_editor.render_preflight import VideoRenderPreflight
from app.apps.video_editor.schemas import VideoEditorRenderPreviewIn
from app.apps.video_editor.task_reads import task_out
from app.runtime.ids import new_id
from app.runtime.time import utc_now
from fpl_runtime.video_exports import MAX_EXPORT_REQUEST_BYTES, ExportInput, VideoExportRequest

from .models import VideoRenderDispatch


class RenderRequests:
    def __init__(self, session, owner):
        self.session, self.owner = session, owner
        self.projects = VideoEditorProjects(session, owner)
        self.preflight = VideoRenderPreflight(session, owner)

    async def create(self, project_id, body):
        await self.session.execute(text("BEGIN IMMEDIATE"))
        project = await self.projects.row(project_id)
        existing = await self.session.scalar(
            select(VideoEditorTask).where(
                VideoEditorTask.project_id == project_id,
                VideoEditorTask.owner_user_id == self.owner,
                VideoEditorTask.request_id == body.request_id,
            )
        )
        if existing is not None:
            return task_out(existing)
        preview = await self.preflight.preview(
            project_id,
            VideoEditorRenderPreviewIn(
                expectedRevision=body.expected_revision,
                preset=body.preset,
                startUs=body.start_us,
                endUs=body.end_us,
            ),
        )
        if not preview.ready:
            raise VideoEditorValidationError("渲染预检未通过", code="render_not_ready")
        if preview.fingerprint != body.preview_fingerprint:
            raise VideoEditorValidationError("预检结果已过期", code="preview_stale")
        timeline = await self.preflight._timeline(project_id)
        assets = {
            identity
            for track in timeline.document.get("tracks", [])
            for clip in track.get("clips", [])
            for identity in (clip.get("assetId"), clip.get("fontAssetId"))
            if identity
        }
        rows = (
            (
                await self.session.scalars(
                    select(VideoEditorAssetMetadata)
                    .where(
                        VideoEditorAssetMetadata.project_id == project_id,
                        VideoEditorAssetMetadata.asset_id.in_(assets),
                    )
                    .order_by(VideoEditorAssetMetadata.asset_id)
                )
            ).all()
            if assets
            else []
        )
        task_id = new_id()
        title = "".join(char for char in project.title.replace("\\", "/") if ord(char) >= 32)
        filename = Path(f"{title}-{task_id[:8]}.mp4").name
        try:
            frozen = VideoExportRequest(
                document=timeline.document,
                preset=body.preset,
                start_us=body.start_us,
                end_us=body.end_us or body.start_us + preview.duration_us,
                filename=filename,
                files=tuple(ExportInput(id=row.asset_id, sha256=row.fingerprint) for row in rows),
            )
            if len(frozen.model_dump_json().encode()) > MAX_EXPORT_REQUEST_BYTES:
                raise ValueError("render snapshot too large")
        except ValueError:
            raise VideoEditorValidationError(
                "素材摘要或成片范围不符合要求", code="render_not_ready"
            ) from None
        task = VideoEditorTask(
            id=task_id,
            owner_user_id=self.owner,
            project_id=project_id,
            request_id=body.request_id,
            kind="render",
            request_payload=body.model_dump(mode="json", by_alias=True),
            snapshot_document=timeline.document,
            result_detail={
                "durationUs": preview.duration_us,
                "frameCount": preview.frame_count,
                "preset": body.preset,
                "fingerprint": preview.fingerprint,
            },
        )
        self.session.add_all(
            (
                task,
                VideoRenderDispatch(
                    task_id=task_id,
                    owner_user_id=self.owner,
                    project_id=project_id,
                    frozen=frozen.model_dump(mode="json"),
                ),
            )
        )
        await self.session.commit()
        return task_out(task)

    async def cancel(self, project_id, task_id):
        await self.projects.row(project_id)
        row = await self.session.scalar(
            select(VideoEditorTask).where(
                VideoEditorTask.id == task_id,
                VideoEditorTask.project_id == project_id,
                VideoEditorTask.owner_user_id == self.owner,
            )
        )
        if row is None:
            raise VideoEditorNotFoundError("渲染任务不存在")
        if row.status in ("queued", "running"):
            await self.session.execute(
                update(VideoEditorTask)
                .where(
                    VideoEditorTask.id == task_id, VideoEditorTask.status.in_(("queued", "running"))
                )
                .values(
                    status=case(
                        (VideoEditorTask.status == "queued", "cancelled"),
                        else_=VideoEditorTask.status,
                    ),
                    progress=case(
                        (VideoEditorTask.status == "queued", 0), else_=VideoEditorTask.progress
                    ),
                    cancel_requested=True,
                    revision=VideoEditorTask.revision + 1,
                    updated_at=utc_now(),
                )
            )
            await self.session.commit()
            await self.session.refresh(row)
        return task_out(row)
