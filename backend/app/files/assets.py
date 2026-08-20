from __future__ import annotations

import os
import shutil
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.concurrency.revisions import RevisionConflictError
from app.core.config import Settings
from app.core.time import iso_utc, utc_now
from app.files.library import AssetError, AssetLibrary
from app.files.policy import display_name_without_original_extension
from app.files.storage import TARGET_STORAGE_VERSION, AssetStorage
from app.models import (
    GalgameProjectAssetReference,
    VisualAsset,
    VisualAssetFolder,
    VisualAssistantMessageAsset,
    VisualProjectAssetReference,
    VisualWorkshopProject,
)
from app.schemas.files import (
    VisualAssetFolderCreateIn,
    VisualAssetFolderListOut,
    VisualAssetFolderOut,
    VisualAssetFolderPatchIn,
    VisualAssetImportIn,
    VisualAssetListOut,
    VisualAssetOut,
    VisualAssetPatchIn,
    VisualAssetReferenceCreateIn,
    VisualAssetReferencePatchIn,
)

MAX_FOLDER_DEPTH = 5


def folder_out(row: VisualAssetFolder) -> VisualAssetFolderOut:
    return VisualAssetFolderOut(
        id=row.id,
        project_id=row.project_id,
        parent_id=row.parent_id,
        name=row.name,
        revision=row.revision,
        created_at=iso_utc(row.created_at),
        updated_at=iso_utc(row.updated_at),
    )


def asset_out(
    row: VisualAsset,
    *,
    reference: VisualProjectAssetReference | None = None,
) -> VisualAssetOut:
    display_name = reference.display_name if reference else row.display_name
    return VisualAssetOut(
        id=row.id,
        project_id=reference.project_id if reference else row.project_id,
        folder_id=reference.folder_id if reference else row.folder_id,
        original_filename=row.original_filename,
        display_name=display_name_without_original_extension(
            display_name,
            row.original_filename,
        ),
        media_kind=row.media_kind,
        mime_type=row.mime_type,
        byte_size=row.byte_size,
        revision=reference.revision if reference else row.revision,
        created_at=iso_utc(reference.created_at if reference else row.created_at),
        updated_at=iso_utc(reference.updated_at if reference else row.updated_at),
        source="library" if row.project_id is None else "project",
        is_reference=reference is not None,
        reference_id=reference.id if reference else None,
    )


class VisualAssets:
    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings
        self.storage = AssetStorage(settings)
        self.library = AssetLibrary(session, settings)

    async def _project(self, project_id: str) -> None:
        if await self.session.get(VisualWorkshopProject, project_id) is None:
            raise AssetError("项目不存在", code="not_found", status=404)

    async def _folder(self, folder_id: str) -> VisualAssetFolder:
        row = await self.session.get(VisualAssetFolder, folder_id)
        if row is None:
            raise AssetError("文件夹不存在", code="not_found", status=404)
        return row

    async def _asset(self, asset_id: str) -> VisualAsset:
        row = await self.session.get(VisualAsset, asset_id)
        if row is None:
            raise AssetError("文件不存在", code="not_found", status=404)
        return row

    async def _validate_folder_scope(
        self, folder_id: str | None, project_id: str | None
    ) -> VisualAssetFolder | None:
        if folder_id is None:
            return None
        folder = await self._folder(folder_id)
        if folder.project_id != project_id:
            raise AssetError("文件夹不属于当前文件域", code="scope_mismatch")
        return folder

    async def list_folders(self, project_id: str | None) -> VisualAssetFolderListOut:
        if project_id:
            await self._project(project_id)
        condition = (
            VisualAssetFolder.project_id == project_id
            if project_id is not None
            else VisualAssetFolder.project_id.is_(None)
        )
        rows = (
            (
                await self.session.execute(
                    select(VisualAssetFolder)
                    .where(condition)
                    .order_by(VisualAssetFolder.name.collate("NOCASE"))
                )
            )
            .scalars()
            .all()
        )
        return VisualAssetFolderListOut(items=[folder_out(row) for row in rows])

    async def create_folder(self, body: VisualAssetFolderCreateIn) -> VisualAssetFolderOut:
        project_id = body.project_id if body.scope == "project" else None
        if body.scope == "project":
            if not project_id:
                raise AssetError("项目文件夹必须指定 project_id")
            await self._project(project_id)
        elif body.project_id is not None:
            raise AssetError("文件管理文件夹不能指定 project_id")
        parent = await self._validate_folder_scope(body.parent_id, project_id)
        if parent and await self._depth(parent) >= MAX_FOLDER_DEPTH:
            raise AssetError("文件夹最多支持五层", code="folder_depth_exceeded")
        row = VisualAssetFolder(project_id=project_id, parent_id=body.parent_id, name=body.name)
        self.session.add(row)
        try:
            await self.session.commit()
        except IntegrityError:
            await self.session.rollback()
            raise AssetError(
                "同一目录下已存在同名文件夹", code="name_conflict", status=409
            ) from None
        await self.session.refresh(row)
        return folder_out(row)

    async def _depth(self, folder: VisualAssetFolder) -> int:
        depth = 1
        parent_id = folder.parent_id
        while parent_id:
            parent = await self._folder(parent_id)
            depth += 1
            parent_id = parent.parent_id
        return depth

    async def _subtree_height(self, folder: VisualAssetFolder) -> int:
        condition = (
            VisualAssetFolder.project_id == folder.project_id
            if folder.project_id is not None
            else VisualAssetFolder.project_id.is_(None)
        )
        rows = (
            (await self.session.execute(select(VisualAssetFolder).where(condition))).scalars().all()
        )
        children: dict[str, list[str]] = {}
        for row in rows:
            if row.parent_id:
                children.setdefault(row.parent_id, []).append(row.id)

        def height(folder_id: str) -> int:
            return 1 + max(
                (height(child_id) for child_id in children.get(folder_id, [])),
                default=0,
            )

        return height(folder.id)

    async def patch_folder(
        self, folder_id: str, body: VisualAssetFolderPatchIn
    ) -> VisualAssetFolderOut:
        row = await self._folder(folder_id)
        new_parent_id = None if body.move_to_root else body.parent_id
        if body.parent_id is not None or body.move_to_root:
            parent = await self._validate_folder_scope(new_parent_id, row.project_id)
            cursor = parent
            while cursor:
                if cursor.id == row.id:
                    raise AssetError("文件夹不能移动到自身或后代中", code="folder_cycle")
                cursor = await self._folder(cursor.parent_id) if cursor.parent_id else None
            parent_depth = await self._depth(parent) if parent else 0
            if parent_depth + await self._subtree_height(row) > MAX_FOLDER_DEPTH:
                raise AssetError("文件夹最多支持五层", code="folder_depth_exceeded")
        values: dict[str, object] = {
            "revision": body.expected_revision + 1,
            "updated_at": utc_now(),
        }
        if body.name is not None:
            values["name"] = body.name
        if body.parent_id is not None or body.move_to_root:
            values["parent_id"] = new_parent_id
        try:
            result = await self.session.execute(
                update(VisualAssetFolder)
                .where(
                    VisualAssetFolder.id == folder_id,
                    VisualAssetFolder.revision == body.expected_revision,
                )
                .values(**values)
            )
            if result.rowcount != 1:
                await self.session.rollback()
                current = folder_out(await self._folder(folder_id))
                raise RevisionConflictError(
                    body.expected_revision, current.revision, current.model_dump(mode="json")
                )
            await self.session.commit()
        except IntegrityError:
            await self.session.rollback()
            raise AssetError(
                "同一目录下已存在同名文件夹", code="name_conflict", status=409
            ) from None
        return folder_out(await self._folder(folder_id))

    async def _descendant_folder_ids(self, root: VisualAssetFolder) -> set[str]:
        rows = (
            (
                await self.session.execute(
                    select(VisualAssetFolder).where(
                        VisualAssetFolder.project_id == root.project_id
                        if root.project_id is not None
                        else VisualAssetFolder.project_id.is_(None)
                    )
                )
            )
            .scalars()
            .all()
        )
        ids = {root.id}
        changed = True
        while changed:
            changed = False
            for row in rows:
                if row.parent_id in ids and row.id not in ids:
                    ids.add(row.id)
                    changed = True
        return ids

    async def delete_folder(self, folder_id: str, expected_revision: int) -> list[Path]:
        row = await self._folder(folder_id)
        folder_ids = await self._descendant_folder_ids(row)
        assets = (
            (
                await self.session.execute(
                    select(VisualAsset).where(VisualAsset.folder_id.in_(folder_ids))
                )
            )
            .scalars()
            .all()
        )
        asset_ids = [item.id for item in assets]
        if asset_ids:
            conversation_reference = await self.session.scalar(
                select(VisualAssistantMessageAsset.id)
                .where(VisualAssistantMessageAsset.asset_id.in_(asset_ids))
                .limit(1)
            )
            if conversation_reference:
                raise AssetError(
                    "文件夹内有文件正在被项目对话使用，请先删除相关对话",
                    code="asset_in_use",
                    status=409,
                )
        global_ids = [item.id for item in assets if item.project_id is None]
        if global_ids:
            referenced = await self.session.scalar(
                select(VisualProjectAssetReference.id)
                .where(VisualProjectAssetReference.asset_id.in_(global_ids))
                .limit(1)
            )
            if referenced:
                raise AssetError(
                    "文件夹内有文件正在被项目使用，请先移除项目引用",
                    code="asset_in_use",
                    status=409,
                )
            galgame_reference = await self.session.scalar(
                select(GalgameProjectAssetReference.id)
                .where(GalgameProjectAssetReference.asset_id.in_(global_ids))
                .limit(1)
            )
            if galgame_reference:
                raise AssetError(
                    "文件夹内有文件正在被 Galgame 工程使用，请先移除立绘引用",
                    code="asset_in_use",
                    status=409,
                )
        paths = [self.storage.path_for(item) for item in assets]
        result = await self.session.execute(
            delete(VisualAssetFolder).where(
                VisualAssetFolder.id == folder_id,
                VisualAssetFolder.revision == expected_revision,
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = folder_out(await self._folder(folder_id))
            raise RevisionConflictError(
                expected_revision, current.revision, current.model_dump(mode="json")
            )
        await self.session.commit()
        for path in paths:
            path.unlink(missing_ok=True)
        return paths

    async def list_assets(
        self,
        *,
        project_id: str | None,
        folder_id: str | None,
        query: str,
        media_kind: str | None,
        sort: str,
        include_references: bool,
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
            ]
        )
        conditions.append(
            VisualAsset.folder_id == folder_id
            if folder_id is not None
            else VisualAsset.folder_id.is_(None)
        )
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
            ref_conditions = [VisualProjectAssetReference.project_id == project_id]
            ref_conditions.append(
                VisualProjectAssetReference.folder_id == folder_id
                if folder_id is not None
                else VisualProjectAssetReference.folder_id.is_(None)
            )
            refs = (
                await self.session.execute(
                    select(VisualProjectAssetReference, VisualAsset)
                    .join(VisualAsset, VisualAsset.id == VisualProjectAssetReference.asset_id)
                    .where(*ref_conditions)
                )
            ).all()
            for ref, asset in refs:
                if query and query.lower() not in ref.display_name.lower():
                    continue
                if media_kind and asset.media_kind != media_kind:
                    continue
                items.append(asset_out(asset, reference=ref))
            items.sort(
                key=(
                    (lambda item: item.display_name.lower())
                    if sort == "name"
                    else (lambda item: item.updated_at)
                ),
                reverse=sort != "name",
            )
        return VisualAssetListOut(items=items)

    async def upload(
        self,
        upload: UploadFile,
        *,
        project_id: str | None,
        folder_id: str | None,
    ) -> VisualAssetOut:
        if project_id:
            await self._project(project_id)
        await self._validate_folder_scope(folder_id, project_id)
        row = await self.library.store_upload(
            upload,
            visual_project_id=project_id,
            folder_id=folder_id,
        )
        return asset_out(row)

    async def patch_asset(self, asset_id: str, body: VisualAssetPatchIn) -> VisualAssetOut:
        row = await self._asset(asset_id)
        if row.galgame_project_id is not None:
            raise AssetError(
                "Galgame 工程素材必须在所属工程中管理",
                code="scope_mismatch",
                status=409,
            )
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

    async def delete_asset(self, asset_id: str, expected_revision: int) -> None:
        row = await self._asset(asset_id)
        if row.galgame_project_id is not None:
            raise AssetError(
                "Galgame 工程素材必须在所属工程中管理",
                code="scope_mismatch",
                status=409,
            )
        conversation_reference = await self.session.scalar(
            select(VisualAssistantMessageAsset.id)
            .where(VisualAssistantMessageAsset.asset_id == asset_id)
            .limit(1)
        )
        if conversation_reference:
            raise AssetError(
                "文件正在被项目对话使用，请先删除相关对话",
                code="asset_in_use",
                status=409,
            )
        if row.project_id is None:
            reference = await self.session.scalar(
                select(VisualProjectAssetReference.id)
                .where(VisualProjectAssetReference.asset_id == asset_id)
                .limit(1)
            )
            if reference:
                raise AssetError(
                    "文件正在被项目使用，请先移除项目引用",
                    code="asset_in_use",
                    status=409,
                )
        path = self.storage.path_for(row)
        try:
            result = await self.session.execute(
                delete(VisualAsset).where(
                    VisualAsset.id == asset_id,
                    VisualAsset.revision == expected_revision,
                )
            )
            if result.rowcount != 1:
                await self.session.rollback()
                current = asset_out(await self._asset(asset_id))
                raise RevisionConflictError(
                    expected_revision, current.revision, current.model_dump(mode="json")
                )
            await self.session.commit()
        except IntegrityError:
            await self.session.rollback()
            raise AssetError(
                "文件正在被项目使用，请先移除项目引用",
                code="asset_in_use",
                status=409,
            ) from None
        path.unlink(missing_ok=True)

    async def content(self, asset_id: str) -> tuple[VisualAsset, Path]:
        row = await self._asset(asset_id)
        path = self.storage.path_for(row)
        if not path.is_file():
            raise AssetError("文件内容不存在", code="file_missing", status=404)
        return row, path

    async def create_reference(
        self, project_id: str, body: VisualAssetReferenceCreateIn
    ) -> VisualAssetOut:
        await self._project(project_id)
        asset = await self._asset(body.asset_id)
        if asset.project_id is not None or asset.galgame_project_id is not None:
            raise AssetError("只能从文件管理导入文件", code="scope_mismatch")
        await self._validate_folder_scope(body.folder_id, project_id)
        existing = await self.session.scalar(
            select(VisualProjectAssetReference).where(
                VisualProjectAssetReference.project_id == project_id,
                VisualProjectAssetReference.asset_id == body.asset_id,
            )
        )
        if existing:
            return asset_out(asset, reference=existing)
        row = VisualProjectAssetReference(
            project_id=project_id,
            asset_id=body.asset_id,
            folder_id=body.folder_id,
            display_name=display_name_without_original_extension(
                asset.display_name,
                asset.original_filename,
            ),
        )
        self.session.add(row)
        await self.session.commit()
        await self.session.refresh(row)
        return asset_out(asset, reference=row)

    async def import_assets(self, project_id: str, body: VisualAssetImportIn) -> VisualAssetListOut:
        await self._project(project_id)
        if body.source_scope == "project":
            assert body.source_project_id is not None
            if body.source_project_id == project_id:
                raise AssetError(
                    "不能从当前项目重复导入素材",
                    code="scope_mismatch",
                )
            await self._project(body.source_project_id)

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

        if body.source_scope == "library":
            if any(
                row.project_id is not None or row.galgame_project_id is not None for row in ordered
            ):
                raise AssetError("素材不属于公共文件库", code="scope_mismatch")
            existing_rows = (
                (
                    await self.session.execute(
                        select(VisualProjectAssetReference).where(
                            VisualProjectAssetReference.project_id == project_id,
                            VisualProjectAssetReference.asset_id.in_(body.asset_ids),
                        )
                    )
                )
                .scalars()
                .all()
            )
            references = {row.asset_id: row for row in existing_rows}
            for asset in ordered:
                if asset.id in references:
                    continue
                reference = VisualProjectAssetReference(
                    project_id=project_id,
                    asset_id=asset.id,
                    folder_id=None,
                    display_name=display_name_without_original_extension(
                        asset.display_name,
                        asset.original_filename,
                    ),
                )
                self.session.add(reference)
                references[asset.id] = reference
            await self.session.commit()
            for reference in references.values():
                if reference.id is None:
                    await self.session.refresh(reference)
            return VisualAssetListOut(
                items=[asset_out(asset, reference=references[asset.id]) for asset in ordered]
            )

        assert body.source_project_id is not None
        if any(
            row.project_id != body.source_project_id or row.galgame_project_id is not None
            for row in ordered
        ):
            raise AssetError("素材不属于所选来源项目", code="scope_mismatch")

        copied_paths: list[Path] = []
        imported_rows: list[VisualAsset] = []
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
                )
                try:
                    shutil.copyfile(source_path, temp_path)
                    os.replace(temp_path, final_path)
                finally:
                    temp_path.unlink(missing_ok=True)
                copied_paths.append(final_path)
                imported = VisualAsset(
                    project_id=project_id,
                    galgame_project_id=None,
                    folder_id=None,
                    original_filename=source.original_filename,
                    display_name=display_name_without_original_extension(
                        source.display_name,
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
            await self.session.commit()
            for imported in imported_rows:
                await self.session.refresh(imported)
            return VisualAssetListOut(items=[asset_out(row) for row in imported_rows])
        except AssetError:
            await self.session.rollback()
            for path in copied_paths:
                path.unlink(missing_ok=True)
            raise
        except Exception as exc:
            await self.session.rollback()
            for path in copied_paths:
                path.unlink(missing_ok=True)
            raise AssetError(
                "跨项目素材复制失败",
                code="asset_import_failed",
                status=500,
            ) from exc

    async def patch_reference(
        self, project_id: str, reference_id: str, body: VisualAssetReferencePatchIn
    ) -> VisualAssetOut:
        row = await self.session.get(VisualProjectAssetReference, reference_id)
        if row is None or row.project_id != project_id:
            raise AssetError("项目素材引用不存在", code="not_found", status=404)
        new_folder_id = None if body.move_to_root else body.folder_id
        if body.folder_id is not None or body.move_to_root:
            await self._validate_folder_scope(new_folder_id, project_id)
        values: dict[str, object] = {
            "revision": body.expected_revision + 1,
            "updated_at": utc_now(),
        }
        if body.display_name is not None:
            values["display_name"] = display_name_without_original_extension(
                body.display_name,
                (await self._asset(row.asset_id)).original_filename,
            )
        if body.folder_id is not None or body.move_to_root:
            values["folder_id"] = new_folder_id
        result = await self.session.execute(
            update(VisualProjectAssetReference)
            .where(
                VisualProjectAssetReference.id == reference_id,
                VisualProjectAssetReference.revision == body.expected_revision,
            )
            .values(**values)
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current_row = await self.session.get(VisualProjectAssetReference, reference_id)
            if current_row is None:
                raise AssetError("项目素材引用不存在", code="not_found", status=404)
            current_asset = await self._asset(current_row.asset_id)
            current = asset_out(current_asset, reference=current_row)
            raise RevisionConflictError(
                body.expected_revision, current.revision, current.model_dump(mode="json")
            )
        await self.session.commit()
        current_row = await self.session.get(VisualProjectAssetReference, reference_id)
        assert current_row is not None
        return asset_out(await self._asset(current_row.asset_id), reference=current_row)

    async def delete_reference(
        self, project_id: str, reference_id: str, expected_revision: int
    ) -> None:
        result = await self.session.execute(
            delete(VisualProjectAssetReference).where(
                VisualProjectAssetReference.id == reference_id,
                VisualProjectAssetReference.project_id == project_id,
                VisualProjectAssetReference.revision == expected_revision,
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            row = await self.session.get(VisualProjectAssetReference, reference_id)
            if row is None or row.project_id != project_id:
                raise AssetError("项目素材引用不存在", code="not_found", status=404)
            asset = await self._asset(row.asset_id)
            current = asset_out(asset, reference=row)
            raise RevisionConflictError(
                expected_revision, current.revision, current.model_dump(mode="json")
            )
        await self.session.commit()
