from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.galgame_workshop.errors import (
    GalgameStoryNotReadyError,
    GalgameWorkshopProjectNotFoundError,
)
from app.apps.galgame_workshop.models import GalgameStoryDocument, GalgameWorkshopProject
from app.apps.galgame_workshop.readiness import GalgameReadiness
from app.apps.galgame_workshop.schemas import (
    GalgameWorkshopProjectCreateIn,
    GalgameWorkshopProjectListOut,
    GalgameWorkshopProjectOut,
    GalgameWorkshopProjectPatchIn,
)
from app.apps.galgame_workshop.story.story import default_story_document
from app.capabilities.asset_store.project_transactions import (
    creating_project_layout,
    deleting_project_layout,
)
from app.capabilities.asset_store.storage import TARGET_STORAGE_VERSION, AssetStorage
from app.capabilities.asset_store.models import VisualAsset
from app.runtime.config import get_settings
from app.runtime.operation_receipts import forget
from app.runtime.project_records import (
    delete_revisioned_project,
    load_workspace_project,
    patch_revisioned_project,
)
from app.runtime.time import iso_utc, utc_now


def project_out(row: GalgameWorkshopProject) -> GalgameWorkshopProjectOut:
    return GalgameWorkshopProjectOut(
        id=row.id,
        title=row.title,
        is_official=row.is_official,
        status=row.status,  # type: ignore[arg-type]
        revision=row.revision,
        created_at=iso_utc(row.created_at),
        updated_at=iso_utc(row.updated_at),
    )


class GalgameWorkshopProjects:
    def __init__(self, session: AsyncSession, workspace_id: str) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.storage = AssetStorage(get_settings())

    async def list(self) -> GalgameWorkshopProjectListOut:
        rows = (
            (
                await self.session.execute(
                    select(GalgameWorkshopProject)
                    .where(GalgameWorkshopProject.workspace_id == self.workspace_id)
                    .order_by(
                        GalgameWorkshopProject.updated_at.desc(),
                        GalgameWorkshopProject.created_at.desc(),
                    )
                )
            )
            .scalars()
            .all()
        )
        return GalgameWorkshopProjectListOut(items=[project_out(row) for row in rows])

    async def _row(self, project_id: str) -> GalgameWorkshopProject:
        return await load_workspace_project(
            self.session,
            GalgameWorkshopProject,
            project_id,
            self.workspace_id,
            not_found=lambda: GalgameWorkshopProjectNotFoundError("项目不存在"),
        )

    async def get(self, project_id: str) -> GalgameWorkshopProjectOut:
        return project_out(await self._row(project_id))

    async def create(self, body: GalgameWorkshopProjectCreateIn) -> GalgameWorkshopProjectOut:
        row = GalgameWorkshopProject(
            workspace_id=self.workspace_id, title=body.title, status="draft"
        )
        self.session.add(row)
        await self.session.flush()
        async with creating_project_layout(
            self.session,
            self.storage,
            "galgame-workshop",
            row.id,
            workspace_id=self.workspace_id,
        ):
            self.session.add(
                GalgameStoryDocument(
                    project_id=row.id,
                    document=default_story_document().model_dump(mode="json", by_alias=True),
                )
            )
        await self.session.refresh(row)
        return project_out(row)

    async def patch(
        self,
        project_id: str,
        body: GalgameWorkshopProjectPatchIn,
    ) -> GalgameWorkshopProjectOut:
        await self._row(project_id)
        if body.status == "completed":
            report = await GalgameReadiness(self.session, get_settings(), self.workspace_id).report(
                project_id
            )
            if not report.ready:
                raise GalgameStoryNotReadyError(report)
        values: dict[str, object] = {
            "revision": body.expected_revision + 1,
            "updated_at": utc_now(),
        }
        if body.title is not None:
            values["title"] = body.title
        if body.status is not None:
            values["status"] = body.status
        await patch_revisioned_project(
            self.session,
            GalgameWorkshopProject,
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
                    select(VisualAsset).where(VisualAsset.galgame_project_id == project_id)
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
            "galgame-workshop",
            project_id,
            workspace_id=self.workspace_id,
            legacy_paths=legacy_paths,
        ):
            await delete_revisioned_project(
                self.session,
                GalgameWorkshopProject,
                project_id,
                self.workspace_id,
                expected_revision=expected_revision,
                load_current=lambda: self.get(project_id),
            )
            await forget(
                self.session, workspace_id=self.workspace_id, kind="galgame", resource_id=project_id
            )
