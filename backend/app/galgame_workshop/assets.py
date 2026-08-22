from __future__ import annotations

from pathlib import Path, PurePosixPath

from fastapi import UploadFile
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.concurrency.revisions import RevisionConflictError
from app.core.config import Settings
from app.files import AssetError, AssetLibrary
from app.files.policy import GALGAME_EXTENSIONS
from app.files.storage import AssetStorage
from app.galgame_workshop.asset_analysis import GalgameAssetAnalysisMixin
from app.galgame_workshop.asset_support import (
    CATEGORY_DIRECTORIES,
    _deduplicated_name,
    _default_category,
    _default_virtual_path,
    _file_metadata,
    galgame_asset_out,
    normalize_import_filename,
)
from app.galgame_workshop.errors import GalgameWorkshopProjectNotFoundError
from app.models import (
    GalgameAssetMetadata,
    GalgameProjectAssetReference,
    GalgameWorkshopProject,
    VisualAsset,
)
from app.schemas.galgame_workshop import (
    GalgameAssetBatchUploadOut,
    GalgameAssetImportPreviewItem,
    GalgameAssetImportPreviewOut,
    GalgameProjectAssetListOut,
    GalgameProjectAssetOut,
    GalgameProjectAssetPatchIn,
)


class GalgameProjectAssets(GalgameAssetAnalysisMixin):
    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings
        self.storage = AssetStorage(settings)
        self.library = AssetLibrary(session, settings)

    async def _project(self, project_id: str) -> GalgameWorkshopProject:
        row = await self.session.get(GalgameWorkshopProject, project_id)
        if row is None:
            raise GalgameWorkshopProjectNotFoundError("项目不存在")
        return row

    async def _metadata_for(self, asset_id: str) -> GalgameAssetMetadata | None:
        return await self.session.get(GalgameAssetMetadata, asset_id)

    async def _create_metadata(
        self, row: VisualAsset, *, category: str, virtual_path: str
    ) -> GalgameAssetMetadata:
        checksum, width, height, duration_ms = _file_metadata(
            self.storage.path_for(row), row.media_kind
        )
        metadata = GalgameAssetMetadata(
            asset_id=row.id,
            project_id=row.galgame_project_id,
            category=category,
            virtual_path=virtual_path,
            checksum_sha256=checksum,
            width=width,
            height=height,
            duration_ms=duration_ms,
            transcript_status="pending" if row.media_kind == "audio" else "ready",
        )
        self.session.add(metadata)
        await self.session.commit()
        await self.session.refresh(metadata)
        return metadata

    async def import_preview(
        self, project_id: str, filenames: list[str], category: str
    ) -> GalgameAssetImportPreviewOut:
        await self._project(project_id)
        directory = CATEGORY_DIRECTORIES[category]
        existing_paths = list(
            (
                await self.session.execute(
                    select(GalgameAssetMetadata.virtual_path).where(
                        GalgameAssetMetadata.project_id == project_id
                    )
                )
            )
            .scalars()
            .all()
        )
        used = {
            PurePosixPath(path).name.casefold()
            for path in existing_paths
            if PurePosixPath(path).parent.as_posix() == directory
        }
        items: list[GalgameAssetImportPreviewItem] = []
        for raw_name in filenames:
            normalized, reasons = normalize_import_filename(raw_name)
            final_name, renamed_for_duplicate = _deduplicated_name(normalized, used)
            if renamed_for_duplicate:
                reasons.append("同名文件已追加序号")
            items.append(
                GalgameAssetImportPreviewItem(
                    originalName=raw_name,
                    finalName=final_name,
                    virtualPath=f"{directory}/{final_name}",
                    reasons=reasons,
                )
            )
        return GalgameAssetImportPreviewOut(items=items)

    async def list(self, project_id: str, *, query: str = "") -> GalgameProjectAssetListOut:
        await self._project(project_id)
        conditions = [VisualAsset.galgame_project_id == project_id]
        if query:
            conditions.append(VisualAsset.display_name.ilike(f"%{query}%"))
        rows = (
            await self.session.execute(
                select(VisualAsset, GalgameAssetMetadata)
                .outerjoin(GalgameAssetMetadata, GalgameAssetMetadata.asset_id == VisualAsset.id)
                .where(*conditions)
                .order_by(VisualAsset.updated_at.desc(), VisualAsset.created_at.desc())
            )
        ).all()
        return GalgameProjectAssetListOut(
            items=[galgame_asset_out(row, metadata) for row, metadata in rows]
        )

    async def upload(
        self, project_id: str, upload: UploadFile, *, category: str | None = None
    ) -> GalgameProjectAssetOut:
        await self._project(project_id)
        selected_category = category or (
            "video"
            if Path(upload.filename or "").suffix.lower() in {".mp4", ".webm", ".mov"}
            else "font"
            if Path(upload.filename or "").suffix.lower() in {".ttf", ".otf", ".woff", ".woff2"}
            else "other"
        )
        preview = await self.import_preview(
            project_id, [upload.filename or "asset"], selected_category
        )
        planned = preview.items[0]
        upload.filename = planned.final_name
        row = await self.library.store_upload(
            upload,
            galgame_project_id=project_id,
            allowed_extensions=GALGAME_EXTENSIONS,
        )
        metadata = await self._create_metadata(
            row, category=selected_category, virtual_path=planned.virtual_path
        )
        return galgame_asset_out(row, metadata)

    async def batch_upload(
        self, project_id: str, uploads: list[UploadFile], category: str
    ) -> GalgameAssetBatchUploadOut:
        if not uploads:
            raise AssetError("至少选择一个文件", code="empty_upload")
        preview = await self.import_preview(
            project_id, [upload.filename or "asset" for upload in uploads], category
        )
        items: list[GalgameProjectAssetOut] = []
        for upload, planned in zip(uploads, preview.items, strict=True):
            upload.filename = planned.final_name
            row = await self.library.store_upload(
                upload,
                galgame_project_id=project_id,
                allowed_extensions=GALGAME_EXTENSIONS,
            )
            metadata = await self._create_metadata(
                row, category=category, virtual_path=planned.virtual_path
            )
            items.append(galgame_asset_out(row, metadata))
        return GalgameAssetBatchUploadOut(items=items, importItems=preview.items)

    async def patch(
        self, project_id: str, asset_id: str, body: GalgameProjectAssetPatchIn
    ) -> GalgameProjectAssetOut:
        await self._project(project_id)
        row = await self.session.get(VisualAsset, asset_id)
        if row is None or row.galgame_project_id != project_id:
            raise AssetError("工程素材不存在", code="not_found", status=404)
        metadata = await self._metadata_for(asset_id)
        if metadata is None:
            metadata = await self._create_metadata(
                row,
                category=_default_category(row),
                virtual_path=_default_virtual_path(row),
            )
        display_name = (body.display_name or row.display_name).strip()
        category = body.category or metadata.category
        if body.virtual_path is not None:
            virtual_path = body.virtual_path.replace("\\", "/").strip().strip("/")
        else:
            suffix = Path(row.original_filename).suffix.lower()
            filename = f"{display_name}{suffix}"
            directory = (
                CATEGORY_DIRECTORIES[category]
                if body.category is not None
                else PurePosixPath(metadata.virtual_path).parent.as_posix()
            )
            virtual_path = f"{directory}/{filename}"
        path = PurePosixPath(virtual_path)
        if path.is_absolute() or ".." in path.parts or len(path.parts) < 2:
            raise AssetError("虚拟路径必须是安全的项目相对路径", code="invalid_virtual_path")
        collision = await self.session.scalar(
            select(GalgameAssetMetadata.asset_id)
            .where(
                GalgameAssetMetadata.project_id == project_id,
                GalgameAssetMetadata.virtual_path == virtual_path,
                GalgameAssetMetadata.asset_id != asset_id,
            )
            .limit(1)
        )
        if collision:
            raise AssetError("虚拟路径已被其他文件使用", code="virtual_path_conflict", status=409)
        values: dict[str, object] = {
            "revision": body.expected_revision + 1,
        }
        if body.display_name is not None:
            values["display_name"] = display_name
        result = await self.session.execute(
            update(VisualAsset)
            .where(
                VisualAsset.id == asset_id,
                VisualAsset.galgame_project_id == project_id,
                VisualAsset.revision == body.expected_revision,
            )
            .values(**values)
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self.session.get(VisualAsset, asset_id)
            if current is None or current.galgame_project_id != project_id:
                raise AssetError("工程素材不存在", code="not_found", status=404)
            current_metadata = await self._metadata_for(asset_id)
            raise RevisionConflictError(
                body.expected_revision,
                current.revision,
                galgame_asset_out(current, current_metadata).model_dump(mode="json", by_alias=True),
            )
        metadata.category = category
        metadata.virtual_path = virtual_path
        if body.packaging_policy is not None:
            metadata.packaging_policy = body.packaging_policy
        await self.session.commit()
        await self.session.refresh(row)
        await self.session.refresh(metadata)
        return galgame_asset_out(row, metadata)

    async def scan_metadata(self, project_id: str) -> GalgameProjectAssetListOut:
        await self._project(project_id)
        rows = list(
            (
                await self.session.execute(
                    select(VisualAsset).where(VisualAsset.galgame_project_id == project_id)
                )
            )
            .scalars()
            .all()
        )
        items: list[GalgameProjectAssetOut] = []
        for row in rows:
            metadata = await self._metadata_for(row.id)
            if metadata is None:
                metadata = await self._create_metadata(
                    row,
                    category=_default_category(row),
                    virtual_path=_default_virtual_path(row),
                )
            path = self.storage.path_for(row)
            if path.is_file():
                checksum, width, height, duration_ms = _file_metadata(path, row.media_kind)
                metadata.checksum_sha256 = checksum
                metadata.width = width
                metadata.height = height
                metadata.duration_ms = duration_ms
            items.append(galgame_asset_out(row, metadata))
        await self.session.commit()
        return GalgameProjectAssetListOut(items=items)

    async def delete(self, project_id: str, asset_id: str, expected_revision: int) -> Path:
        await self._project(project_id)
        row = await self.session.get(VisualAsset, asset_id)
        if row is None or row.galgame_project_id != project_id:
            raise AssetError("工程素材不存在", code="not_found", status=404)
        reference = await self.session.scalar(
            select(GalgameProjectAssetReference.id)
            .where(GalgameProjectAssetReference.asset_id == asset_id)
            .limit(1)
        )
        if reference:
            references = await self._story_references(project_id, asset_id)
            raise AssetError(
                "素材仍被故事使用，请先移除相关引用",
                code="asset_in_use",
                status=409,
                detail={"references": references},
            )
        path = self.storage.path_for(row)
        result = await self.session.execute(
            delete(VisualAsset).where(
                VisualAsset.id == asset_id,
                VisualAsset.galgame_project_id == project_id,
                VisualAsset.revision == expected_revision,
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self.session.get(VisualAsset, asset_id)
            if current is None or current.galgame_project_id != project_id:
                raise AssetError("工程素材不存在", code="not_found", status=404)
            raise RevisionConflictError(
                expected_revision,
                current.revision,
                galgame_asset_out(current).model_dump(mode="json"),
            )
        await self.session.commit()
        path.unlink(missing_ok=True)
        return path
