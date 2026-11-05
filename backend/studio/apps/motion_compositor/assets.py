from __future__ import annotations

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store.incoming import IncomingFile
from app.capabilities.asset_store.library import AssetLibrary
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from studio.apps.motion_compositor.projects import MotionInvalid, MotionNotFound, MotionProjects
from studio.apps.motion_compositor.schemas import (
    AssetImportIn,
    AssetListOut,
    AssetOut,
    ImportSourceListOut,
    ImportSourceOut,
)
from studio.config.settings import get_settings
from studio.contracts.motion_compositor.motion_assets import MOTION_EXTENSIONS


class MotionAssets:
    def __init__(self, session: AsyncSession, owner_user_id: str) -> None:
        self.session = session
        self.owner_user_id = owner_user_id
        self.settings = get_settings()
        self.storage = AssetStorage(self.settings)
        self.library = AssetLibrary(session, self.settings)
        self.projects = MotionProjects(session, owner_user_id)

    @staticmethod
    def _out(project_id: str, row: VisualAsset) -> AssetOut:
        return AssetOut(
            id=row.id,
            displayName=row.display_name,
            mediaKind=row.media_kind,
            mimeType=row.mime_type,
            url=f"/v1/motion-compositor/projects/{project_id}/assets/{row.id}/file",
        )

    async def sources(self) -> ImportSourceListOut:
        rows = list(
            (
                await self.session.execute(
                    select(VisualAsset)
                    .where(
                        VisualAsset.owner_user_id == self.owner_user_id,
                        VisualAsset.media_kind.in_(("image", "video")),
                    )
                    .order_by(VisualAsset.updated_at.desc())
                    .limit(500)
                )
            ).scalars()
        )
        return ImportSourceListOut(
            items=[
                ImportSourceOut(
                    id=row.id,
                    displayName=row.display_name,
                    mediaKind=row.media_kind,
                    sourceApplication=(
                        "visual-workshop"
                        if row.project_id
                        else "video-editor"
                        if row.video_editor_project_id
                        else "galgame-workshop"
                        if row.galgame_project_id
                        else "motion-compositor"
                        if row.motion_compositor_project_id
                        else "file-library"
                    ),
                )
                for row in rows
                if Path(row.original_filename).suffix.lower() in MOTION_EXTENSIONS
            ]
        )

    async def list(self, project_id: str) -> AssetListOut:
        await self.projects.row(project_id)
        rows = list(
            (
                await self.session.execute(
                    select(VisualAsset)
                    .where(
                        VisualAsset.motion_compositor_project_id == project_id,
                        VisualAsset.owner_user_id == self.owner_user_id,
                    )
                    .order_by(VisualAsset.created_at.desc())
                )
            ).scalars()
        )
        return AssetListOut(items=[self._out(project_id, row) for row in rows])

    async def upload(self, project_id: str, upload: IncomingFile) -> AssetOut:
        await self.projects.row(project_id)
        row = await self.library.store_upload(
            upload,
            owner_user_id=self.owner_user_id,
            motion_compositor_project_id=project_id,
            allowed_extensions=MOTION_EXTENSIONS,
        )
        return self._out(project_id, row)

    async def import_assets(self, project_id: str, body: AssetImportIn) -> AssetListOut:
        await self.projects.row(project_id)
        sources = list(
            (
                await self.session.execute(
                    select(VisualAsset).where(
                        VisualAsset.id.in_(body.asset_ids),
                        VisualAsset.owner_user_id == self.owner_user_id,
                    )
                )
            ).scalars()
        )
        if {row.id for row in sources} != set(body.asset_ids):
            raise MotionInvalid("有素材不存在或不属于当前工作空间")
        staged: list[Path] = []
        created: list[VisualAsset] = []
        try:
            for source in sources:
                row, path = await self.library.stage_local_copy(
                    self.storage.path_for(source),
                    owner_user_id=self.owner_user_id,
                    filename=source.original_filename,
                    content_type=source.mime_type,
                    motion_compositor_project_id=project_id,
                    allowed_extensions=MOTION_EXTENSIONS,
                )
                staged.append(path)
                created.append(row)
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            for path in staged:
                path.unlink(missing_ok=True)
            raise
        return AssetListOut(items=[self._out(project_id, row) for row in created])

    async def asset(self, project_id: str, asset_id: str) -> VisualAsset:
        await self.projects.row(project_id)
        row = (
            await self.session.execute(
                select(VisualAsset).where(
                    VisualAsset.id == asset_id,
                    VisualAsset.motion_compositor_project_id == project_id,
                    VisualAsset.owner_user_id == self.owner_user_id,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise MotionNotFound("素材不存在")
        return row

    async def paths(self, project_id: str) -> dict[str, Path]:
        await self.projects.row(project_id)
        rows = list(
            (
                await self.session.execute(
                    select(VisualAsset).where(
                        VisualAsset.motion_compositor_project_id == project_id,
                        VisualAsset.owner_user_id == self.owner_user_id,
                    )
                )
            ).scalars()
        )
        return {row.id: self.storage.path_for(row) for row in rows}
