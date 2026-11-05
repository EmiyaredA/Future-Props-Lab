from __future__ import annotations

from sqlalchemy import delete, select

from app.capabilities.asset_store.library import AssetError
from app.capabilities.media_rendering.presets import RENDER_PRESETS
from studio.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from studio.apps.video_editor.media import VideoEditorMedia
from studio.apps.video_editor.projects import VideoEditorProjects
from studio.apps.video_editor.render_preflight import VideoRenderPreflight
from studio.apps.video_editor.schemas import (
    VideoEditorRenderCreateIn,
    VideoEditorRenderPreviewIn,
    VideoEditorTaskListOut,
    VideoEditorTaskOut,
)
from studio.apps.video_editor.storage.models import VideoEditorTask
from studio.apps.video_editor.task_reads import task_out
from studio.runtime.revisions import require_revision_write
from studio.runtime.time import utc_now

PRESETS = RENDER_PRESETS


class VideoEditorRenders(VideoRenderPreflight):
    async def create(self, project_id: str, body: VideoEditorRenderCreateIn) -> VideoEditorTaskOut:
        existing = (
            await self.session.execute(
                select(VideoEditorTask).where(
                    VideoEditorTask.project_id == project_id,
                    VideoEditorTask.owner_user_id == self.owner_user_id,
                    VideoEditorTask.request_id == body.request_id,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return task_out(existing)
        preview_body = VideoEditorRenderPreviewIn(
            expectedRevision=body.expected_revision,
            preset=body.preset,
            startUs=body.start_us,
            endUs=body.end_us,
        )
        preview = await self.preview(project_id, preview_body)
        if not preview.ready:
            raise VideoEditorValidationError("渲染预检未通过", code="render_not_ready")
        if preview.fingerprint != body.preview_fingerprint:
            raise VideoEditorValidationError("预检结果已过期", code="preview_stale")
        timeline = await self._timeline(project_id)
        task = VideoEditorTask(
            owner_user_id=self.owner_user_id,
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
        self.session.add(task)
        await self.session.commit()
        await self.session.refresh(task)
        return task_out(task)

    async def list(self, project_id: str) -> VideoEditorTaskListOut:
        await VideoEditorProjects(self.session, self.owner_user_id).row(project_id)
        rows = list(
            (
                await self.session.execute(
                    select(VideoEditorTask)
                    .where(
                        VideoEditorTask.project_id == project_id,
                        VideoEditorTask.owner_user_id == self.owner_user_id,
                        VideoEditorTask.kind == "render",
                    )
                    .order_by(VideoEditorTask.created_at.desc())
                )
            ).scalars()
        )
        return VideoEditorTaskListOut(items=[task_out(row) for row in rows])

    async def get(self, project_id: str, task_id: str) -> VideoEditorTaskOut:
        await VideoEditorProjects(self.session, self.owner_user_id).row(project_id)
        row = (
            await self.session.execute(
                select(VideoEditorTask).where(
                    VideoEditorTask.id == task_id,
                    VideoEditorTask.project_id == project_id,
                    VideoEditorTask.owner_user_id == self.owner_user_id,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise VideoEditorNotFoundError("渲染任务不存在")
        return task_out(row)

    async def cancel(self, project_id: str, task_id: str) -> VideoEditorTaskOut:
        await VideoEditorProjects(self.session, self.owner_user_id).row(project_id)
        row = (
            await self.session.execute(
                select(VideoEditorTask).where(
                    VideoEditorTask.id == task_id,
                    VideoEditorTask.project_id == project_id,
                    VideoEditorTask.owner_user_id == self.owner_user_id,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise VideoEditorNotFoundError("渲染任务不存在")
        if row.status in {"queued", "running"}:
            row.cancel_requested = True
            if row.status == "queued":
                row.status = "cancelled"
                row.progress = 0
            row.revision += 1
            row.updated_at = utc_now()
            await self.session.commit()
        return task_out(row)

    async def delete(self, project_id: str, task_id: str, expected_revision: int) -> None:
        task = await self.get(project_id, task_id)
        if task.kind != "render":
            raise VideoEditorNotFoundError("成片导出任务不存在")
        if task.status not in {"completed", "failed", "cancelled"}:
            raise AssetError("进行中的导出任务不能删除", code="task_active", status=409)
        # Take the SQLite write lock with a CAS before checking mutable references.
        result = await self.session.execute(
            delete(VideoEditorTask).where(
                VideoEditorTask.id == task_id,
                VideoEditorTask.project_id == project_id,
                VideoEditorTask.owner_user_id == self.owner_user_id,
                VideoEditorTask.kind == "render",
                VideoEditorTask.status.in_({"completed", "failed", "cancelled"}),
                VideoEditorTask.revision == expected_revision,
            )
        )
        await require_revision_write(
            self.session,
            result,
            expected=expected_revision,
            load_current=lambda: self.get(project_id, task_id),
        )
        media = VideoEditorMedia(self.session, self.owner_user_id)
        derived_paths = []
        try:
            if task.output_asset_id:
                active_tasks = await self.session.scalars(
                    select(VideoEditorTask).where(
                        VideoEditorTask.project_id == project_id,
                        VideoEditorTask.owner_user_id == self.owner_user_id,
                        VideoEditorTask.status.in_({"queued", "running"}),
                    )
                )
                for active in active_tasks:
                    if active.request_payload.get("assetId") == task.output_asset_id or any(
                        clip.get(key) == task.output_asset_id
                        for track in active.snapshot_document.get("tracks", [])
                        for clip in track.get("clips", [])
                        for key in ("assetId", "fontAssetId")
                    ):
                        raise VideoEditorValidationError(
                            "成片仍被进行中的任务引用", code="asset_in_use"
                        )
                _asset, metadata = await media.asset(project_id, task.output_asset_id)
                derived_paths = [
                    media.derived_path(project_id, filename)
                    for filename in (
                        metadata.proxy_filename,
                        metadata.thumbnail_filename,
                        metadata.waveform_filename,
                    )
                    if filename
                ]
                # The media use case validates timeline references, updates asset
                # organization and commits the asset and task removal together.
                await media.delete(project_id, task.output_asset_id)
            else:
                await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        for path in derived_paths:
            path.unlink(missing_ok=True)
