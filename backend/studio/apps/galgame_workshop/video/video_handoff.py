from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store import AssetError
from app.capabilities.media_rendering.galgame.compiler import COMPILER_VERSION
from studio.apps.galgame_workshop.schemas import (
    GalgameVideoEditorHandoffCreateIn,
    GalgameVideoEditorHandoffTaskListOut,
    GalgameVideoEditorHandoffTaskOut,
    GalgameVideoExportPreviewIn,
)
from studio.apps.galgame_workshop.storage.models import (
    GalgameStorySnapshot,
    GalgameVideoEditorHandoffTask,
    GalgameWorkshopProject,
)
from studio.apps.galgame_workshop.story.story import GalgameStoryDocuments
from studio.apps.galgame_workshop.task_views import handoff_out
from studio.apps.galgame_workshop.video.video_export import GalgameVideoExports
from studio.runtime.time import utc_now


class GalgameVideoEditorHandoffs:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _project(self, project_id: str) -> GalgameWorkshopProject:
        project = await self.session.get(GalgameWorkshopProject, project_id)
        if project is None:
            raise AssetError("Galgame 项目不存在", code="not_found", status=404)
        return project

    async def create(
        self, project_id: str, body: GalgameVideoEditorHandoffCreateIn
    ) -> GalgameVideoEditorHandoffTaskOut:
        await self._project(project_id)
        submitted = body.model_dump(mode="json", by_alias=True)
        existing = await self.session.scalar(
            select(GalgameVideoEditorHandoffTask).where(
                GalgameVideoEditorHandoffTask.project_id == project_id,
                GalgameVideoEditorHandoffTask.request_id == body.request_id,
            )
        )
        if existing is not None:
            if any(existing.request_payload.get(key) != value for key, value in submitted.items()):
                raise AssetError(
                    "同一 requestId 已用于不同剪辑交接请求",
                    code="idempotency_conflict",
                    status=409,
                )
            return handoff_out(existing)
        preview_body = GalgameVideoExportPreviewIn.model_validate(submitted)
        preview = await GalgameVideoExports(self.session).preview(project_id, preview_body)
        if preview.preview_fingerprint != body.preview_fingerprint:
            raise AssetError(
                "导出预览已失效，请重新检查后再发送到剪辑工坊",
                code="preview_conflict",
                status=409,
                detail={"preview": preview.model_dump(mode="json", by_alias=True)},
            )
        if not preview.ready:
            raise AssetError(
                "当前 Story 尚不能生成剪辑工程",
                code="video_handoff_not_ready",
                detail={"preview": preview.model_dump(mode="json", by_alias=True)},
            )
        story = await GalgameStoryDocuments(self.session).get(project_id)
        snapshot = GalgameStorySnapshot(
            project_id=project_id,
            story_revision=story.revision,
            reason="video-editor-handoff",
            document=story.document.model_dump(mode="json", by_alias=True),
        )
        self.session.add(snapshot)
        await self.session.flush()
        payload = dict(submitted)
        payload["resolvedFragmentIds"] = preview.route.fragment_ids
        payload["compilerVersion"] = COMPILER_VERSION
        task = GalgameVideoEditorHandoffTask(
            owner_user_id=(await self._project(project_id)).owner_user_id,
            project_id=project_id,
            snapshot_id=snapshot.id,
            request_id=body.request_id,
            story_revision=story.revision,
            request_payload=payload,
            result_detail={
                "totalMs": preview.route.estimated_duration_ms,
                "endingLabel": preview.route.ending_label,
                "fragmentDurationsMs": preview.route.fragment_durations_ms,
            },
        )
        self.session.add(task)
        await self.session.commit()
        await self.session.refresh(task)
        return handoff_out(task)

    async def list(self, project_id: str) -> GalgameVideoEditorHandoffTaskListOut:
        await self._project(project_id)
        rows = list(
            (
                await self.session.execute(
                    select(GalgameVideoEditorHandoffTask)
                    .where(GalgameVideoEditorHandoffTask.project_id == project_id)
                    .order_by(GalgameVideoEditorHandoffTask.created_at.desc())
                    .limit(50)
                )
            ).scalars()
        )
        return GalgameVideoEditorHandoffTaskListOut(items=[handoff_out(row) for row in rows])

    async def get(self, project_id: str, task_id: str) -> GalgameVideoEditorHandoffTaskOut:
        await self._project(project_id)
        row = await self.session.get(GalgameVideoEditorHandoffTask, task_id)
        if row is None or row.project_id != project_id:
            raise AssetError("剪辑交接任务不存在", code="not_found", status=404)
        return handoff_out(row)

    async def cancel(self, project_id: str, task_id: str) -> GalgameVideoEditorHandoffTaskOut:
        await self._project(project_id)
        row = await self.session.get(GalgameVideoEditorHandoffTask, task_id)
        if row is None or row.project_id != project_id:
            raise AssetError("剪辑交接任务不存在", code="not_found", status=404)
        if row.status in {"completed", "failed", "cancelled"}:
            return handoff_out(row)
        row.cancel_requested = True
        row.revision += 1
        row.updated_at = utc_now()
        if row.status == "queued":
            row.status = "cancelled"
            row.finished_at = utc_now()
        await self.session.commit()
        await self.session.refresh(row)
        return handoff_out(row)
