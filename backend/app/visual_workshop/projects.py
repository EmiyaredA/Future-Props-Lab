from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concurrency.project_records import (
    delete_revisioned_project,
    load_workspace_project,
    patch_revisioned_project,
)
from app.core.config import get_settings
from app.core.time import iso_utc, utc_now
from app.files.project_transactions import creating_project_layout, deleting_project_layout
from app.files.storage import TARGET_STORAGE_VERSION, AssetStorage
from app.models import VisualAsset, VisualCanvasDocument, VisualWorkshopProject
from app.schemas.visual_workshop import (
    VisualWorkshopProjectCreateIn,
    VisualWorkshopProjectListOut,
    VisualWorkshopProjectOut,
    VisualWorkshopProjectPatchIn,
)


class VisualWorkshopProjectNotFoundError(Exception):
    pass


def project_out(row: VisualWorkshopProject) -> VisualWorkshopProjectOut:
    return VisualWorkshopProjectOut(
        id=row.id,
        title=row.title,
        kind=row.kind,
        status=row.status,
        revision=row.revision,
        created_at=iso_utc(row.created_at),
        updated_at=iso_utc(row.updated_at),
    )


class VisualWorkshopProjects:
    def __init__(self, session: AsyncSession, workspace_id: str) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.storage = AssetStorage(get_settings())

    async def list(self) -> VisualWorkshopProjectListOut:
        rows = (
            (
                await self.session.execute(
                    select(VisualWorkshopProject)
                    .where(VisualWorkshopProject.workspace_id == self.workspace_id)
                    .order_by(
                        VisualWorkshopProject.updated_at.desc(),
                        VisualWorkshopProject.created_at.desc(),
                    )
                )
            )
            .scalars()
            .all()
        )
        return VisualWorkshopProjectListOut(items=[project_out(row) for row in rows])

    async def _row(self, project_id: str) -> VisualWorkshopProject:
        return await load_workspace_project(
            self.session,
            VisualWorkshopProject,
            project_id,
            self.workspace_id,
            not_found=lambda: VisualWorkshopProjectNotFoundError("项目不存在"),
        )

    async def get(self, project_id: str) -> VisualWorkshopProjectOut:
        return project_out(await self._row(project_id))

    async def create(self, body: VisualWorkshopProjectCreateIn) -> VisualWorkshopProjectOut:
        row = VisualWorkshopProject(
            workspace_id=self.workspace_id, title=body.title, kind=body.kind, status="draft"
        )
        self.session.add(row)
        await self.session.flush()
        async with creating_project_layout(
            self.session,
            self.storage,
            "visual-workshop",
            row.id,
            workspace_id=self.workspace_id,
        ):
            self.session.add(VisualCanvasDocument(project_id=row.id, nodes=[]))
        await self.session.refresh(row)
        return project_out(row)

    async def patch(
        self,
        project_id: str,
        body: VisualWorkshopProjectPatchIn,
    ) -> VisualWorkshopProjectOut:
        await self._row(project_id)
        values: dict[str, object] = {
            "revision": body.expected_revision + 1,
            "updated_at": utc_now(),
        }
        if body.title is not None:
            values["title"] = body.title
        if body.kind is not None:
            values["kind"] = body.kind
        if body.status is not None:
            values["status"] = body.status
        await patch_revisioned_project(
            self.session,
            VisualWorkshopProject,
            project_id,
            self.workspace_id,
            expected_revision=body.expected_revision,
            values=values,
            load_current=lambda: self.get(project_id),
        )
        await self.session.commit()
        return await self.get(project_id)

    async def delete(self, project_id: str, expected_revision: int) -> None:
        await self._row(project_id)
        assets = (
            (
                await self.session.execute(
                    select(VisualAsset).where(VisualAsset.project_id == project_id)
                )
            )
            .scalars()
            .all()
        )
        legacy_paths = [
            self.storage.path_for(asset)
            for asset in assets
            if asset.storage_version < TARGET_STORAGE_VERSION
        ]
        async with deleting_project_layout(
            self.session,
            self.storage,
            "visual-workshop",
            project_id,
            workspace_id=self.workspace_id,
            legacy_paths=legacy_paths,
        ):
            await delete_revisioned_project(
                self.session,
                VisualWorkshopProject,
                project_id,
                self.workspace_id,
                expected_revision=expected_revision,
                load_current=lambda: self.get(project_id),
            )
