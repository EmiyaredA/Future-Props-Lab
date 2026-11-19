"""Freeze and identify disposable timeline previews without publishing user assets."""

from sqlalchemy import select, text

from studio.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from studio.apps.video_editor.render_preflight import VideoRenderPreflight
from studio.apps.video_editor.schemas import VideoEditorRenderPreviewIn
from studio.apps.video_editor.schemas.preview_render import (
    VideoEditorPreviewRenderListOut,
    VideoEditorPreviewRenderOut,
)
from studio.apps.video_editor.storage.models import VideoEditorAssetMetadata, VideoEditorTask
from studio.apps.video_editor.storage.service_models import VideoRenderDispatch
from studio.apps.video_editor.task_reads import task_out
from studio.contracts.motion_compositor.motion_preview import sha256
from studio.contracts.video_editor.video_exports import (
    MAX_EXPORT_REQUEST_BYTES,
    ExportInput,
    VideoExportRequest,
)
from studio.runtime.ids import new_id
from studio.runtime.time import utc_now

PREVIEW_RENDER_VERSION = 2
ACTIVE = {"queued", "running"}


def retire_preview(task):
    task.result_detail = {**task.result_detail, "retired": True}
    task.cancel_requested = True
    task.revision += 1
    task.updated_at = utc_now()


async def retire_previous_previews(session, task):
    for previous in await session.scalars(
        select(VideoEditorTask).where(
            VideoEditorTask.owner_user_id == task.owner_user_id,
            VideoEditorTask.project_id == task.project_id,
            VideoEditorTask.kind == "preview_render",
            VideoEditorTask.status == "completed",
            VideoEditorTask.id != task.id,
        )
    ):
        retire_preview(previous)


class PreviewRenders(VideoRenderPreflight):
    def __init__(self, session, owner, *, remote):
        super().__init__(session, owner)
        self.remote = remote

    async def identity(self, project):
        timeline = await self._timeline(project)
        preset = f"720p{timeline.document.get('settings', {}).get('fps', 30)}"
        preview = await self.preview(
            project, VideoEditorRenderPreviewIn(expectedRevision=timeline.revision, preset=preset)
        )
        fingerprint = sha256(
            f"{self.owner_user_id}:{project}:{PREVIEW_RENDER_VERSION}:{preview.fingerprint}".encode()
        )
        return timeline, preview, fingerprint

    def output(self, task, fingerprint):
        valid = (
            task.status == "completed"
            and not task.result_detail.get("retired")
            and task.result_detail.get("fingerprint") == fingerprint
        )
        return VideoEditorPreviewRenderOut(
            **task_out(task).model_dump(by_alias=True),
            valid=valid,
            timelineRevision=task.request_payload["expectedRevision"],
            mediaUrl=(
                f"/v1/video-editor/projects/{task.project_id}/preview/renders/{task.id}/media"
                if valid
                else None
            ),
        )

    async def rows(self, project):
        await self._timeline(project)
        return list(
            await self.session.scalars(
                select(VideoEditorTask)
                .where(
                    VideoEditorTask.project_id == project,
                    VideoEditorTask.owner_user_id == self.owner_user_id,
                    VideoEditorTask.kind == "preview_render",
                )
                .order_by(VideoEditorTask.created_at.desc(), VideoEditorTask.id)
            )
        )

    async def list(self, project):
        _timeline, preview, fingerprint = await self.identity(project)
        return VideoEditorPreviewRenderListOut(
            items=[
                self.output(row, fingerprint if preview.ready else "")
                for row in await self.rows(project)
                if not row.result_detail.get("retired")
            ]
        )

    async def get(self, project, task_id):
        row = next(
            (
                row
                for row in await self.rows(project)
                if row.id == task_id and not row.result_detail.get("retired")
            ),
            None,
        )
        if row is None:
            raise VideoEditorNotFoundError("预渲染任务不存在")
        return row

    async def create(self, project, body):
        from studio.runtime.revisions import RevisionConflictError

        await self.session.execute(text("BEGIN IMMEDIATE"))
        timeline, preview, fingerprint = await self.identity(project)
        if timeline.revision != body.expected_revision:
            raise RevisionConflictError(
                body.expected_revision, timeline.revision, {"revision": timeline.revision}
            )
        if not preview.ready:
            raise VideoEditorValidationError("时间线或素材尚未就绪", code="render_not_ready")
        rows = await self.rows(project)
        request = await self.session.scalar(
            select(VideoEditorTask).where(
                VideoEditorTask.project_id == project,
                VideoEditorTask.owner_user_id == self.owner_user_id,
                VideoEditorTask.request_id == body.request_id,
            )
        )
        if request is not None and (
            request.kind != "preview_render"
            or request.result_detail.get("retired")
            or request.result_detail.get("fingerprint") != fingerprint
        ):
            raise VideoEditorValidationError(
                "请求标识已用于其他快照或已清理任务", code="preview_request_changed"
            )
        for row in rows:
            if row.result_detail.get("retired"):
                continue
            if row.request_id == body.request_id or (
                row.result_detail.get("fingerprint") == fingerprint
                and row.status in ACTIVE | {"completed"}
                and not row.cancel_requested
            ):
                return self.output(row, fingerprint)
            if row.status in ACTIVE:
                raise VideoEditorValidationError("请先取消正在进行的预渲染", code="preview_active")
        for row in rows:
            if row.status in {"failed", "cancelled"}:
                retire_preview(row)
        task_id = new_id()
        task = VideoEditorTask(
            id=task_id,
            owner_user_id=self.owner_user_id,
            project_id=project,
            request_id=body.request_id,
            kind="preview_render",
            request_payload={**body.model_dump(by_alias=True), "preset": preview.preset},
            snapshot_document=timeline.document,
            result_detail={
                "fingerprint": fingerprint,
                "durationUs": preview.duration_us,
                "preset": preview.preset,
            },
        )
        self.session.add(task)
        if self.remote:
            ids = {
                value
                for track in timeline.document.get("tracks", [])
                for clip in track.get("clips", [])
                for value in (clip.get("assetId"), clip.get("fontAssetId"))
                if value
            }
            assets = await self.session.scalars(
                select(VideoEditorAssetMetadata)
                .where(
                    VideoEditorAssetMetadata.project_id == project,
                    VideoEditorAssetMetadata.asset_id.in_(ids),
                )
                .order_by(VideoEditorAssetMetadata.asset_id)
            )
            frozen = VideoExportRequest(
                document=timeline.document,
                preset=preview.preset,
                start_us=0,
                end_us=preview.duration_us,
                filename="preview.mp4",
                preview=True,
                files=tuple(ExportInput(id=row.asset_id, sha256=row.fingerprint) for row in assets),
            )
            if len(frozen.model_dump_json().encode()) > MAX_EXPORT_REQUEST_BYTES:
                raise VideoEditorValidationError("时间线快照过大", code="render_not_ready")
            self.session.add(
                VideoRenderDispatch(
                    task_id=task_id,
                    owner_user_id=self.owner_user_id,
                    project_id=project,
                    frozen=frozen.model_dump(mode="json"),
                )
            )
        await self.session.commit()
        return self.output(task, fingerprint)

    async def cancel(self, project, task_id):
        row = await self.get(project, task_id)
        if row.status in ACTIVE:
            row.cancel_requested = True
            row.revision += 1
            row.updated_at = utc_now()
            await self.session.commit()
        _timeline, _preview, fingerprint = await self.identity(project)
        return self.output(row, fingerprint)

    async def clear(self, project):
        for row in await self.rows(project):
            retire_preview(row)
        await self.session.commit()
