"""Files use only owned rows; project and reference validation use explicit ports."""

import os
import shutil
from pathlib import Path
from uuid import uuid4

from sqlalchemy import delete, select, text, update

from app.capabilities.asset_store.asset_outputs import asset_out, folder_out
from app.capabilities.asset_store.asset_scope import ensure_library_managed, is_visual_project_asset
from app.capabilities.asset_store.folders import AssetFolders
from app.capabilities.asset_store.incoming import IncomingFile
from app.capabilities.asset_store.library import AssetError
from app.capabilities.asset_store.models import VisualAsset, VisualAssetFolder
from app.capabilities.asset_store.policy import display_name_without_original_extension
from app.capabilities.asset_store.schemas.files import (
    LibraryAssetImportIn,
    VisualAssetListOut,
    VisualAssetOut,
    VisualAssetPatchIn,
)
from app.capabilities.asset_store.storage import TARGET_STORAGE_VERSION
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now

from .deletions import schedule
from .models import VisualProjectFileLink
from .references import protect_references


class Files(AssetFolders):
    def __init__(self, session, settings, owner, *, project_exists):
        if project_exists is None:
            raise ValueError("项目验证接口不可缺失")
        super().__init__(session, settings, owner, project_exists=project_exists)

    async def list_assets(
        self,
        *,
        project_id: str | None,
        folder_id: str | None,
        query: str,
        media_kind: str | None,
        sort: str,
        include_references: bool,
        include_svg: bool = False,
    ) -> VisualAssetListOut:
        if project_id:
            await self._project(project_id)
        await self._validate_folder_scope(folder_id, project_id)
        conditions = (
            [VisualAsset.project_id == project_id]
            if project_id is not None
            else [
                VisualAsset.project_id.is_(None),
                VisualAsset.galgame_project_id.is_(None),
                VisualAsset.video_editor_project_id.is_(None),
                VisualAsset.motion_compositor_project_id.is_(None),
            ]
        )
        conditions.append(
            VisualAsset.folder_id == folder_id
            if folder_id is not None
            else VisualAsset.folder_id.is_(None)
        )
        if not include_svg:
            conditions.append(VisualAsset.mime_type != "image/svg+xml")
        if query:
            conditions.append(VisualAsset.display_name.ilike(f"%{query}%"))
        if media_kind:
            conditions.append(VisualAsset.media_kind == media_kind)
        order = (
            VisualAsset.display_name.collate("NOCASE")
            if sort == "name"
            else VisualAsset.updated_at.desc()
        )
        rows = (
            (await self.session.execute(select(VisualAsset).where(*conditions).order_by(order)))
            .scalars()
            .all()
        )
        items = [asset_out(row) for row in rows]
        if include_references and project_id:
            links = [VisualProjectFileLink.project_id == project_id]
            links.append(
                VisualProjectFileLink.folder_id == folder_id
                if folder_id is not None
                else VisualProjectFileLink.folder_id.is_(None)
            )
            if query:
                links.append(VisualProjectFileLink.display_name.ilike(f"%{query}%"))
            if media_kind:
                links.append(VisualAsset.media_kind == media_kind)
            if not include_svg:
                links.append(VisualAsset.mime_type != "image/svg+xml")
            referenced = (
                await self.session.execute(
                    select(VisualProjectFileLink, VisualAsset)
                    .join(VisualAsset, VisualProjectFileLink.asset_id == VisualAsset.id)
                    .where(*links)
                )
            ).all()
            items.extend(asset_out(asset, reference=link) for link, asset in referenced)
            items.sort(
                key=(lambda item: item.display_name.lower())
                if sort == "name"
                else (lambda item: item.updated_at),
                reverse=sort != "name",
            )
        return VisualAssetListOut(items=items)

    async def upload(
        self,
        upload: IncomingFile,
        *,
        project_id: str | None,
        folder_id: str | None,
        display_name: str | None = None,
    ) -> VisualAssetOut:
        if project_id:
            await self._project(project_id)
        await self._validate_folder_scope(folder_id, project_id)
        row = await self.library.store_upload(
            upload,
            owner_user_id=self.owner_user_id,
            visual_project_id=project_id,
            folder_id=folder_id,
            display_name=display_name,
        )
        return asset_out(row)

    async def patch_asset(self, asset_id: str, body: VisualAssetPatchIn) -> VisualAssetOut:
        row = await self._asset(asset_id)
        ensure_library_managed(row)
        new_folder_id = None if body.move_to_root else body.folder_id
        if body.folder_id is not None or body.move_to_root:
            await self._validate_folder_scope(new_folder_id, row.project_id)
        values: dict[str, object] = {
            "revision": body.expected_revision + 1,
            "updated_at": utc_now(),
        }
        if body.display_name is not None:
            values["display_name"] = display_name_without_original_extension(
                body.display_name,
                row.original_filename,
            )
        if body.folder_id is not None or body.move_to_root:
            values["folder_id"] = new_folder_id
        result = await self.session.execute(
            update(VisualAsset)
            .where(VisualAsset.id == asset_id, VisualAsset.revision == body.expected_revision)
            .values(**values)
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = asset_out(await self._asset(asset_id))
            raise RevisionConflictError(
                body.expected_revision, current.revision, current.model_dump(mode="json")
            )
        await self.session.commit()
        return asset_out(await self._asset(asset_id))

    async def content(self, asset_id: str) -> tuple[VisualAsset, Path]:
        row = await self._asset(asset_id)
        path = self.storage.path_for(row)
        if not path.is_file():
            raise AssetError("文件内容不存在", code="file_missing", status=404)
        return row, path

    async def import_project_assets_to_library(
        self, body: LibraryAssetImportIn
    ) -> VisualAssetListOut:
        await self._project(body.source_project_id)
        await self._validate_folder_scope(body.folder_id, None)
        rows = (
            (
                await self.session.execute(
                    select(VisualAsset).where(VisualAsset.id.in_(body.asset_ids))
                )
            )
            .scalars()
            .all()
        )
        by_id = {row.id: row for row in rows}
        if len(by_id) != len(body.asset_ids):
            raise AssetError("部分来源素材不存在", code="not_found", status=404)
        ordered = [by_id[asset_id] for asset_id in body.asset_ids]
        if any(not is_visual_project_asset(row, body.source_project_id) for row in ordered):
            raise AssetError("素材不属于所选来源项目", code="scope_mismatch")

        return await self.copy_assets(
            ordered,
            project_id=None,
            folder_id=body.folder_id,
            display_names=body.display_names,
        )

    async def copy_assets(self, ordered, *, project_id, folder_id=None, display_names=None):
        copied_paths: list[Path] = []
        imported_rows: list[VisualAsset] = []
        commit_started = False
        try:
            for source in ordered:
                source_path = self.storage.path_for(source)
                if not source_path.is_file():
                    raise AssetError("来源素材文件不存在", code="file_missing", status=404)
                storage_key = uuid4().hex
                temp_path, final_path = self.storage.prepare_write(
                    storage_key,
                    visual_project_id=project_id,
                    galgame_project_id=None,
                    owner_user_id=self.owner_user_id,
                )
                try:
                    shutil.copyfile(source_path, temp_path)
                    os.replace(temp_path, final_path)
                finally:
                    temp_path.unlink(missing_ok=True)
                copied_paths.append(final_path)
                override = (display_names or {}).get(source.id)
                imported = VisualAsset(
                    owner_user_id=self.owner_user_id,
                    project_id=project_id,
                    galgame_project_id=None,
                    folder_id=folder_id,
                    original_filename=source.original_filename,
                    display_name=display_name_without_original_extension(
                        override or source.display_name,
                        source.original_filename,
                    ),
                    storage_key=storage_key,
                    storage_version=TARGET_STORAGE_VERSION,
                    media_kind=source.media_kind,
                    mime_type=source.mime_type,
                    byte_size=source.byte_size,
                )
                imported_rows.append(imported)
                self.session.add(imported)
            commit_started = True
            await self.session.commit()
            return VisualAssetListOut(items=[asset_out(row) for row in imported_rows])
        except BaseException as exc:
            try:
                await self.session.rollback()
            finally:
                if not commit_started:
                    for path in copied_paths:
                        path.unlink(missing_ok=True)
            if not isinstance(exc, Exception) or isinstance(exc, AssetError):
                raise
            raise AssetError(
                "素材提交结果未确认，请先核验文件列表" if commit_started else "素材复制失败",
                code="asset_commit_unknown" if commit_started else "asset_import_failed",
                status=503 if commit_started else 500,
            ) from exc

    async def delete_asset(self, asset_id, expected_revision):
        await self.session.execute(text("BEGIN IMMEDIATE"))
        row = await self._asset(asset_id)
        ensure_library_managed(row)
        if row.revision != expected_revision:
            current = asset_out(row)
            raise RevisionConflictError(
                expected_revision, row.revision, current.model_dump(mode="json")
            )
        await protect_references(self.session, [asset_id])
        schedule(self.session, [row])
        await self.session.execute(delete(VisualAsset).where(VisualAsset.id == asset_id))
        await self.session.commit()

    async def delete_folder(self, folder_id, expected_revision):
        await self.session.execute(text("BEGIN IMMEDIATE"))
        row = await self._folder(folder_id)
        if row.revision != expected_revision:
            current = folder_out(row)
            raise RevisionConflictError(
                expected_revision, row.revision, current.model_dump(mode="json")
            )
        folder_ids = await self._descendant_folder_ids(row)
        rows = list(
            (
                await self.session.scalars(
                    select(VisualAsset).where(
                        VisualAsset.folder_id.in_(folder_ids),
                    )
                )
            ).all()
        )
        await protect_references(self.session, [asset.id for asset in rows])
        schedule(self.session, rows)
        await self.session.execute(
            delete(VisualAssetFolder).where(VisualAssetFolder.id == folder_id)
        )
        await self.session.commit()
