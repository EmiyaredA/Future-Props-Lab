from __future__ import annotations

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.director_desk.models import DirectorDeskProject
from app.apps.director_desk.schemas import (
    DirectorDocument,
    DirectorProjectCreate,
    DirectorProjectList,
    DirectorProjectOut,
    DirectorProjectPatch,
    DirectorProjectSummary,
)
from app.capabilities.asset_store.project_transactions import deleting_project_layout
from app.capabilities.asset_store.storage import AssetStorage
from app.runtime.config import get_settings
from app.runtime.project_records import (
    delete_revisioned_project,
    load_owned_project,
    patch_revisioned_project,
)
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now


class DirectorDeskError(Exception):
    def __init__(self, message: str, status: int = 404, code: str = "not_found"):
        super().__init__(message)
        self.status, self.code = status, code


def project_out(row: DirectorDeskProject) -> DirectorProjectOut:
    return DirectorProjectOut.model_validate(row, from_attributes=True)


class DirectorDeskProjects:
    def __init__(self, session: AsyncSession, owner_user_id: str):
        self.session, self.owner_user_id = session, owner_user_id

    async def row(self, project_id: str) -> DirectorDeskProject:
        return await load_owned_project(
            self.session,
            DirectorDeskProject,
            project_id,
            self.owner_user_id,
            not_found=lambda: DirectorDeskError("预演工程不存在"),
        )

    async def get(self, project_id: str) -> DirectorProjectOut:
        row = await self.row(project_id)
        await self.session.refresh(row)
        return project_out(row)

    async def list(self, query: str, offset: int, limit: int) -> DirectorProjectList:
        filters = [DirectorDeskProject.owner_user_id == self.owner_user_id]
        if query.strip():
            filters.append(DirectorDeskProject.title.contains(query.strip(), autoescape=True))
        total = await self.session.scalar(
            select(func.count()).select_from(DirectorDeskProject).where(*filters)
        )
        rows = (
            await self.session.execute(
                select(
                    DirectorDeskProject.id,
                    DirectorDeskProject.title,
                    DirectorDeskProject.revision,
                    DirectorDeskProject.updated_at,
                )
                .where(*filters)
                .order_by(DirectorDeskProject.updated_at.desc(), DirectorDeskProject.id)
                .offset(offset)
                .limit(limit)
            )
        ).all()
        items = [DirectorProjectSummary.model_validate(row, from_attributes=True) for row in rows]
        return DirectorProjectList(total=int(total or 0), items=items)

    async def create(self, body: DirectorProjectCreate) -> DirectorProjectOut:
        row = DirectorDeskProject(
            owner_user_id=self.owner_user_id,
            title=body.title,
            document=DirectorDocument(name=body.title).model_dump(),
        )
        self.session.add(row)
        await self.session.commit()
        return await self.get(row.id)

    async def patch(self, project_id: str, body: DirectorProjectPatch) -> DirectorProjectOut:
        row = await self.row(project_id)
        current = DirectorDocument.model_validate(row.document)
        if body.document is None:
            stored = current.model_copy(update={"name": body.title})
        elif body.document.name != body.title:
            raise DirectorDeskError("标题与文档名称不一致", 422, "invalid_document")
        else:
            stored = body.document
        await patch_revisioned_project(
            self.session,
            DirectorDeskProject,
            project_id,
            self.owner_user_id,
            expected_revision=body.expected_revision,
            values={
                "title": body.title,
                "document": stored.model_dump(mode="json"),
                "revision": body.expected_revision + 1,
                "updated_at": utc_now(),
            },
            load_current=lambda: self.get(project_id),
        )
        await self.session.commit()
        return await self.get(project_id)

    async def delete(
        self, project_id: str, revision: int, *, storage: AssetStorage | None = None
    ) -> None:
        await self.session.rollback()
        await self.session.execute(text("BEGIN IMMEDIATE"))
        row = await self.row(project_id)
        if row.revision != revision:
            raise RevisionConflictError(
                revision, row.revision, project_out(row).model_dump(mode="json")
            )
        async with deleting_project_layout(
            self.session,
            storage if storage is not None else AssetStorage(get_settings()),
            "director-desk",
            project_id,
            owner_user_id=self.owner_user_id,
        ):
            await delete_revisioned_project(
                self.session,
                DirectorDeskProject,
                project_id,
                self.owner_user_id,
                expected_revision=revision,
                load_current=lambda: self.get(project_id),
            )
