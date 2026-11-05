from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.asset_library.storage.file_paths import TARGET_STORAGE_VERSION, AssetStorage
from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.galgame_workshop.errors import (
    GalgameStoryNotReadyError,
    GalgameWorkshopProjectNotFoundError,
)
from studio.apps.galgame_workshop.project_values import project_out as project_out
from studio.apps.galgame_workshop.readiness import GalgameReadiness
from studio.apps.galgame_workshop.schemas import (
    GalgameWorkshopProjectCreateIn,
    GalgameWorkshopProjectListOut,
    GalgameWorkshopProjectOut,
    GalgameWorkshopProjectPatchIn,
)
from studio.apps.galgame_workshop.storage.models import (
    GalgameProjectAssetReference,
    GalgameStoryDocument,
    GalgameWorkshopProject,
)
from studio.apps.galgame_workshop.story.story import default_story_document
from studio.config.settings import Settings
from studio.runtime.database.operation_receipts import forget
from studio.runtime.database.project_files import creating_project_layout, deleting_project_layout
from studio.runtime.database.project_records import (
    delete_revisioned_project,
    list_owned_projects,
    load_owned_project,
    patch_revisioned_project,
)
from studio.runtime.time import utc_now


class GalgameWorkshopProjects:
    def __init__(self, session: AsyncSession, owner_user_id: str, *, settings: Settings) -> None:
        self.session = session
        self.owner_user_id = owner_user_id
        self.settings = settings
        self.storage = AssetStorage(settings)

    async def list(self) -> GalgameWorkshopProjectListOut:
        rows = await list_owned_projects(self.session, GalgameWorkshopProject, self.owner_user_id)
        return GalgameWorkshopProjectListOut(items=[project_out(row) for row in rows])

    async def _row(self, project_id: str) -> GalgameWorkshopProject:
        return await load_owned_project(
            self.session,
            GalgameWorkshopProject,
            project_id,
            self.owner_user_id,
            not_found=lambda: GalgameWorkshopProjectNotFoundError("项目不存在"),
        )

    async def get(self, project_id: str) -> GalgameWorkshopProjectOut:
        return project_out(await self._row(project_id))

    async def create(self, body: GalgameWorkshopProjectCreateIn) -> GalgameWorkshopProjectOut:
        row = GalgameWorkshopProject(
            owner_user_id=self.owner_user_id, title=body.title, status="draft"
        )
        self.session.add(row)
        await self.session.flush()
        async with creating_project_layout(
            self.session,
            self.storage,
            "galgame-workshop",
            row.id,
            owner_user_id=self.owner_user_id,
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
            report = await GalgameReadiness(self.session, self.settings, self.owner_user_id).report(
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
            owner_user_id=self.owner_user_id,
            legacy_paths=legacy_paths,
        ):
            await self.session.execute(
                delete(GalgameProjectAssetReference).where(
                    GalgameProjectAssetReference.project_id == project_id
                )
            )
            await delete_revisioned_project(
                self.session,
                GalgameWorkshopProject,
                project_id,
                self.owner_user_id,
                expected_revision=expected_revision,
                load_current=lambda: self.get(project_id),
            )
            await forget(
                self.session,
                owner_user_id=self.owner_user_id,
                kind="galgame",
                resource_id=project_id,
            )
