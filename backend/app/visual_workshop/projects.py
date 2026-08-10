from __future__ import annotations

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.concurrency.revisions import RevisionConflictError
from app.core.config import get_settings
from app.core.time import iso_utc, utc_now
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
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.storage = AssetStorage(get_settings())

    async def list(self) -> VisualWorkshopProjectListOut:
        rows = (
            (
                await self.session.execute(
                    select(VisualWorkshopProject).order_by(
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
        row = await self.session.get(VisualWorkshopProject, project_id)
        if row is None:
            raise VisualWorkshopProjectNotFoundError("项目不存在")
        return row

    async def get(self, project_id: str) -> VisualWorkshopProjectOut:
        return project_out(await self._row(project_id))

    async def create(self, body: VisualWorkshopProjectCreateIn) -> VisualWorkshopProjectOut:
        row = VisualWorkshopProject(title=body.title, kind=body.kind, status="draft")
        self.session.add(row)
        await self.session.flush()
        created_root = self.storage.ensure_project_layout("visual-workshop", row.id)
        try:
            self.session.add(VisualCanvasDocument(project_id=row.id, nodes=[]))
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            if created_root:
                self.storage.remove_project_root("visual-workshop", row.id)
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
        result = await self.session.execute(
            update(VisualWorkshopProject)
            .where(
                VisualWorkshopProject.id == project_id,
                VisualWorkshopProject.revision == body.expected_revision,
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
        staged = self.storage.stage_project_root("visual-workshop", project_id)
        try:
            result = await self.session.execute(
                delete(VisualWorkshopProject).where(
                    VisualWorkshopProject.id == project_id,
                    VisualWorkshopProject.revision == expected_revision,
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
