from __future__ import annotations

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.concurrency.revisions import RevisionConflictError
from app.core.config import get_settings
from app.core.time import iso_utc, utc_now
from app.files.storage import TARGET_STORAGE_VERSION, AssetStorage
from app.galgame_workshop.errors import (
    GalgameStoryNotReadyError,
    GalgameWorkshopProjectNotFoundError,
)
from app.galgame_workshop.readiness import GalgameReadiness
from app.galgame_workshop.story import default_story_document
from app.models import GalgameStoryDocument, GalgameWorkshopProject, VisualAsset
from app.schemas.galgame_workshop import (
    GalgameWorkshopProjectCreateIn,
    GalgameWorkshopProjectListOut,
    GalgameWorkshopProjectOut,
    GalgameWorkshopProjectPatchIn,
)


def project_out(row: GalgameWorkshopProject) -> GalgameWorkshopProjectOut:
    return GalgameWorkshopProjectOut(
        id=row.id,
        title=row.title,
        status=row.status,  # type: ignore[arg-type]
        revision=row.revision,
        created_at=iso_utc(row.created_at),
        updated_at=iso_utc(row.updated_at),
    )


class GalgameWorkshopProjects:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.storage = AssetStorage(get_settings())

    async def list(self) -> GalgameWorkshopProjectListOut:
        rows = (
            (
                await self.session.execute(
                    select(GalgameWorkshopProject).order_by(
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
        row = await self.session.get(GalgameWorkshopProject, project_id)
        if row is None:
            raise GalgameWorkshopProjectNotFoundError("项目不存在")
        return row

    async def get(self, project_id: str) -> GalgameWorkshopProjectOut:
        return project_out(await self._row(project_id))

    async def create(self, body: GalgameWorkshopProjectCreateIn) -> GalgameWorkshopProjectOut:
        row = GalgameWorkshopProject(title=body.title, status="draft")
        self.session.add(row)
        await self.session.flush()
        created_root = self.storage.ensure_project_layout("galgame-workshop", row.id)
        try:
            self.session.add(
                GalgameStoryDocument(
                    project_id=row.id,
                    document=default_story_document().model_dump(mode="json", by_alias=True),
                )
            )
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            if created_root:
                self.storage.remove_project_root("galgame-workshop", row.id)
            raise
        await self.session.refresh(row)
        return project_out(row)

    async def _raise_conflict(self, project_id: str, expected_revision: int) -> None:
        await self.session.rollback()
        current = await self.get(project_id)
        raise RevisionConflictError(
            expected_revision,
            current.revision,
            current.model_dump(mode="json"),
        )

    async def patch(
        self,
        project_id: str,
        body: GalgameWorkshopProjectPatchIn,
    ) -> GalgameWorkshopProjectOut:
        await self._row(project_id)
        if body.status == "completed":
            report = await GalgameReadiness(self.session, get_settings()).report(project_id)
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
        result = await self.session.execute(
            update(GalgameWorkshopProject)
            .where(
                GalgameWorkshopProject.id == project_id,
                GalgameWorkshopProject.revision == body.expected_revision,
            )
            .values(**values)
        )
        if result.rowcount != 1:
            await self._raise_conflict(project_id, body.expected_revision)
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
        staged = self.storage.stage_project_root("galgame-workshop", project_id)
        try:
            result = await self.session.execute(
                delete(GalgameWorkshopProject).where(
                    GalgameWorkshopProject.id == project_id,
                    GalgameWorkshopProject.revision == expected_revision,
                )
            )
            if result.rowcount != 1:
                await self._raise_conflict(project_id, expected_revision)
            await self.session.commit()
        except Exception:
            self.storage.restore_staged_root(staged)
            raise
        for path in legacy_paths:
            path.unlink(missing_ok=True)
        self.storage.purge_staged_root(staged)
