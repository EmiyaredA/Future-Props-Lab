"""Access owned job records without loading execution dependencies."""

from sqlalchemy import select, text

from app.apps.galgame_workshop.models import (
    GalgameAnnotationImportTask,
    GalgameVideoEditorHandoffTask,
    GalgameVideoExportTask,
    GalgameWorkshopProject,
)
from app.apps.galgame_workshop.schemas import (
    GalgameVideoEditorHandoffTaskListOut,
    GalgameVideoExportTaskListOut,
)
from app.apps.galgame_workshop.task_views import annotation_task_out, export_task_out, handoff_out
from app.runtime.project_records import load_owned_project
from app.runtime.time import utc_now
from fpl_runtime.project_errors import ProjectResourceError

TERMINAL = {"completed", "failed", "cancelled"}
NOT_FOUND = {
    GalgameAnnotationImportTask: "导入任务不存在",
    GalgameVideoExportTask: "视频导出任务不存在",
    GalgameVideoEditorHandoffTask: "剪辑交接任务不存在",
}


class TaskRecords:
    def __init__(self, session, owner):
        self.session, self.owner = session, owner

    async def _project(self, project_id):
        await load_owned_project(
            self.session,
            GalgameWorkshopProject,
            project_id,
            self.owner,
            not_found=lambda: ProjectResourceError("Galgame 项目不存在"),
        )

    async def list(self, model, project_id):
        await self._project(project_id)
        return list(
            await self.session.scalars(
                select(model)
                .where(model.project_id == project_id, model.owner_user_id == self.owner)
                .order_by(model.created_at.desc())
                .limit(50)
            )
        )

    async def get(self, model, project_id, identity):
        await self._project(project_id)
        row = await self.session.scalar(
            select(model).where(
                model.id == identity,
                model.project_id == project_id,
                model.owner_user_id == self.owner,
            )
        )
        if row is None:
            raise ProjectResourceError(NOT_FOUND[model])
        return row

    async def cancel(self, model, project_id, identity):
        await self.session.execute(text("BEGIN IMMEDIATE"))
        row = await self.get(model, project_id, identity)
        if row.status not in TERMINAL:
            now = utc_now()
            row.cancel_requested = True
            row.revision += 1
            row.updated_at = now
            if row.status == "queued":
                row.status = "cancelled"
                row.finished_at = now
                if model is GalgameVideoExportTask:
                    row.progress = 0
                    row.result_detail = {**(row.result_detail or {}), "phase": "cancelled"}
        await self.session.commit()
        return row

    async def annotation_import(self, project_id, identity):
        return annotation_task_out(
            await self.get(GalgameAnnotationImportTask, project_id, identity)
        )

    async def list_exports(self, project_id):
        rows = await self.list(GalgameVideoExportTask, project_id)
        return GalgameVideoExportTaskListOut(items=[export_task_out(row) for row in rows])

    async def export(self, project_id, identity):
        return export_task_out(await self.get(GalgameVideoExportTask, project_id, identity))

    async def cancel_export(self, project_id, identity):
        return export_task_out(await self.cancel(GalgameVideoExportTask, project_id, identity))

    async def list_handoffs(self, project_id):
        rows = await self.list(GalgameVideoEditorHandoffTask, project_id)
        return GalgameVideoEditorHandoffTaskListOut(items=[handoff_out(row) for row in rows])

    async def handoff(self, project_id, identity):
        return handoff_out(await self.get(GalgameVideoEditorHandoffTask, project_id, identity))

    async def cancel_handoff(self, project_id, identity):
        return handoff_out(await self.cancel(GalgameVideoEditorHandoffTask, project_id, identity))
