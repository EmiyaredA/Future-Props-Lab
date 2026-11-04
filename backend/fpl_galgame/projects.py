"""Galgame project and story reads from the owning account database."""

from sqlalchemy import text

from app.apps.galgame_workshop.errors import (
    GalgameStoryDocumentInvalidError,
    GalgameStoryNotReadyError,
)
from app.apps.galgame_workshop.models import GalgameStoryDocument, GalgameWorkshopProject
from app.apps.galgame_workshop.project_values import project_out
from app.apps.galgame_workshop.schemas.base import GalgameWorkshopProjectListOut
from app.apps.galgame_workshop.story.document_values import (
    default_story_document,
    normalize_story_document,
    story_out,
)
from app.apps.galgame_workshop.story.snapshots import list_snapshots
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

    async def patch(self, project_id, body, *, readiness):
        await self.row(project_id)
        if body.status == "completed":
            report = await readiness(project_id)
            if not report.ready:
                raise GalgameStoryNotReadyError(report)
            await self.session.rollback()
            await self.session.execute(text("BEGIN IMMEDIATE"))
            story = await self.story(project_id)
            if story.revision != report.story_revision:
                raise ProjectResourceError(
                    "故事版本已变化，请重新检查后保存", "story_revision_changed", 409
                )
        values = {
            **body.model_dump(exclude={"expected_revision"}, exclude_none=True),
            "revision": body.expected_revision + 1,
            "updated_at": utc_now(),
        }
        await patch_revisioned_project(
            self.session,
            GalgameWorkshopProject,
            project_id,
            self.owner,
            expected_revision=body.expected_revision,
            values=values,
            load_current=lambda: self.get(project_id),
        )
        updated = await self.get(project_id)
        await self.session.commit()
        return updated

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

    async def snapshots(self, project_id):
        await self.story(project_id)
        return await list_snapshots(self.session, project_id)
