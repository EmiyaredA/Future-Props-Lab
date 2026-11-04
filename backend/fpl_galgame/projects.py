"""Galgame project and story reads from the owning account database."""

from app.apps.galgame_workshop.errors import GalgameStoryDocumentInvalidError
from app.apps.galgame_workshop.models import GalgameStoryDocument, GalgameWorkshopProject
from app.apps.galgame_workshop.project_values import project_out
from app.apps.galgame_workshop.schemas.base import GalgameWorkshopProjectListOut
from app.apps.galgame_workshop.story.document_values import (
    default_story_document,
    normalize_story_document,
    story_out,
)
from app.runtime.project_records import list_owned_projects, load_owned_project
from fpl_runtime.project_errors import ProjectResourceError


class Projects:
    def __init__(self, session, owner):
        self.session, self.owner = session, owner

    async def list(self):
        rows = await list_owned_projects(self.session, GalgameWorkshopProject, self.owner)
        return GalgameWorkshopProjectListOut(items=[project_out(row) for row in rows])

    async def row(self, project_id):
        return await load_owned_project(
            self.session,
            GalgameWorkshopProject,
            project_id,
            self.owner,
            not_found=lambda: ProjectResourceError("项目不存在"),
        )

    async def get(self, project_id):
        return project_out(await self.row(project_id))

    async def create(self, body, *, project_id):
        row = GalgameWorkshopProject(id=project_id, owner_user_id=self.owner, title=body.title)
        self.session.add(row)
        await self.session.flush()
        self.session.add(
            GalgameStoryDocument(
                project_id=row.id,
                document=default_story_document().model_dump(mode="json", by_alias=True),
            )
        )
        return project_out(row)

    async def story(self, project_id):
        await self.row(project_id)
        story = await self.session.get(GalgameStoryDocument, project_id)
        if story is None:
            raise ProjectResourceError("故事文档不存在")
        try:
            return story_out(story, normalize_story_document(story.document))
        except GalgameStoryDocumentInvalidError as exc:
            raise ProjectResourceError(str(exc), "invalid_story_document", 422) from exc
