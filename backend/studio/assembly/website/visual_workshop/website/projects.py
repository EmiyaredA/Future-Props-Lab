from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.asset_library.storage.file_paths import TARGET_STORAGE_VERSION, AssetStorage
from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.visual_workshop.acceptance.standards import delete_acceptance
from studio.apps.visual_workshop.asset_references.models import VisualProjectAssetReference
from studio.apps.visual_workshop.outputs.models import VisualNodeOutput
from studio.apps.visual_workshop.project_values import project_out as project_out
from studio.apps.visual_workshop.schemas.workshop import (
    VisualWorkshopProjectCreateIn,
    VisualWorkshopProjectListOut,
    VisualWorkshopProjectOut,
    VisualWorkshopProjectPatchIn,
)
from studio.apps.visual_workshop.storage.models import (
    VisualCanvasDocument,
    VisualWorkshopProject,
)
from studio.runtime.database.operation_receipts import forget
from studio.runtime.database.project_files import creating_project_layout, deleting_project_layout
from studio.runtime.database.project_records import (
    delete_revisioned_project,
    list_owned_projects,
    load_owned_project,
    patch_revisioned_project,
)
from studio.runtime.time import utc_now


class VisualWorkshopProjectNotFoundError(Exception):
    pass


class VisualWorkshopProjects:
    def __init__(self, session: AsyncSession, owner_user_id: str, *, storage: AssetStorage) -> None:
        self.session = session
        self.owner_user_id = owner_user_id
        self.storage = storage

    async def list(self) -> VisualWorkshopProjectListOut:
        rows = await list_owned_projects(self.session, VisualWorkshopProject, self.owner_user_id)
        return VisualWorkshopProjectListOut(items=[project_out(row) for row in rows])

    async def _row(self, project_id: str) -> VisualWorkshopProject:
        return await load_owned_project(
            self.session,
            VisualWorkshopProject,
            project_id,
            self.owner_user_id,
            not_found=lambda: VisualWorkshopProjectNotFoundError("项目不存在"),
        )

    async def get(self, project_id: str) -> VisualWorkshopProjectOut:
        return project_out(await self._row(project_id))

    async def create(self, body: VisualWorkshopProjectCreateIn) -> VisualWorkshopProjectOut:
        row = VisualWorkshopProject(
            owner_user_id=self.owner_user_id, title=body.title, kind=body.kind, status="draft"
        )
        self.session.add(row)
        await self.session.flush()
        async with creating_project_layout(
            self.session,
            self.storage,
            "visual-workshop",
            row.id,
            owner_user_id=self.owner_user_id,
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
            self.owner_user_id,
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
            owner_user_id=self.owner_user_id,
            legacy_paths=legacy_paths,
        ):
            await self.session.execute(
                delete(VisualProjectAssetReference).where(
                    VisualProjectAssetReference.project_id == project_id
                )
            )
            await delete_acceptance(self.session, project_id)
            await self.session.execute(
                delete(VisualNodeOutput).where(VisualNodeOutput.project_id == project_id)
            )
            await delete_revisioned_project(
                self.session,
                VisualWorkshopProject,
                project_id,
                self.owner_user_id,
                expected_revision=expected_revision,
                load_current=lambda: self.get(project_id),
            )
            await forget(
                self.session,
                owner_user_id=self.owner_user_id,
                kind="visual",
                resource_id=project_id,
            )
