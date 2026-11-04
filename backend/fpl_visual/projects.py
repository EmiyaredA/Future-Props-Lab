"""Visual's own project and canvas rows, separate from file-library storage."""

from app.apps.visual_workshop.canvas_values import canvas_out
from app.apps.visual_workshop.models import VisualCanvasDocument, VisualWorkshopProject
from app.apps.visual_workshop.project_values import project_out
from app.apps.visual_workshop.schemas.workshop import VisualWorkshopProjectListOut
from app.runtime.project_records import (
    list_owned_projects,
    load_owned_project,
    patch_revisioned_project,
)
from app.runtime.time import utc_now
from fpl_runtime.project_errors import ProjectResourceError


class Projects:
    def __init__(self, session, owner):
        self.session, self.owner = session, owner

    async def list(self):
        rows = await list_owned_projects(self.session, VisualWorkshopProject, self.owner)
        return VisualWorkshopProjectListOut(items=[project_out(row) for row in rows])

    async def row(self, project_id):
        return await load_owned_project(
            self.session,
            VisualWorkshopProject,
            project_id,
            self.owner,
            not_found=lambda: ProjectResourceError("项目不存在"),
        )

    async def get(self, project_id):
        return project_out(await self.row(project_id))

    async def create(self, body):
        row = VisualWorkshopProject(owner_user_id=self.owner, title=body.title, kind=body.kind)
        self.session.add(row)
        await self.session.flush()
        self.session.add(VisualCanvasDocument(project_id=row.id))
        result = project_out(row)
        await self.session.commit()
        return result

    async def patch(self, project_id, body):
        await self.row(project_id)
        await patch_revisioned_project(
            self.session,
            VisualWorkshopProject,
            project_id,
            self.owner,
            expected_revision=body.expected_revision,
            values={
                **body.model_dump(exclude={"expected_revision"}, exclude_none=True),
                "revision": body.expected_revision + 1,
                "updated_at": utc_now(),
            },
            load_current=lambda: self.get(project_id),
        )
        result = await self.get(project_id)
        await self.session.commit()
        return result

    async def canvas(self, project_id):
        await self.row(project_id)
        canvas = await self.session.get(VisualCanvasDocument, project_id)
        if canvas is None:
            raise ProjectResourceError("项目画布不存在", "canvas_not_found")
        return canvas_out(canvas)
