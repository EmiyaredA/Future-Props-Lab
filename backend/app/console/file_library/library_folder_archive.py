from __future__ import annotations

import asyncio
import shutil
import stat
import zipfile
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store.assets import MAX_FOLDER_DEPTH
from app.capabilities.asset_store.incoming import IncomingFile
from app.capabilities.asset_store.library import AssetError, AssetLibrary
from app.capabilities.asset_store.models import (
    VisualAsset,
    VisualAssetFolder,
)
from app.capabilities.asset_store.policy import ALLOWED_FILES, download_filename
from app.capabilities.asset_store.schemas.files import (
    LibraryFolderImportOut,
    LibraryFolderImportSkippedOut,
)
from app.capabilities.asset_store.storage import AssetStorage
from app.runtime.config import Settings

STAGING_DIRNAME = "library-folder-archives"


class LibraryFolderArchiveError(Exception):
    def __init__(self, message: str, *, code: str, status: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class ExportedLibraryFolderArchive:
    path: Path
    filename: str


@dataclass
class _ImportAccumulator:
    created_folders: int = 0
    created_files: int = 0
    skipped: list[LibraryFolderImportSkippedOut] = field(default_factory=list)

    def skip(self, path: str, code: str, message: str) -> None:
        self.skipped.append(LibraryFolderImportSkippedOut(path=path, code=code, message=message))

    def to_out(self) -> LibraryFolderImportOut:
        return LibraryFolderImportOut(
            created_folders=self.created_folders,
            created_files=self.created_files,
            skipped=self.skipped,
        )


def cleanup_library_folder_archive_staging(settings: Settings) -> None:
    shutil.rmtree(settings.runtime_path / ".tmp" / STAGING_DIRNAME, ignore_errors=True)


def _staging_root(settings: Settings) -> Path:
    root = settings.runtime_path / ".tmp" / STAGING_DIRNAME
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe_archive_filename(title: str) -> str:
    cleaned = "".join("_" if char in '\\/:*?"<>|' or ord(char) < 32 else char for char in title)
    cleaned = cleaned.strip(" .") or "library"
    return f"{cleaned[:80]}-library-folder.zip"


def _validate_zip_member(item: zipfile.ZipInfo) -> None:
    path = PurePosixPath(item.filename)
    mode = item.external_attr >> 16
    if (
        path.is_absolute()
        or ".." in path.parts
        or "\\" in item.filename
        or (path.parts and path.parts[0].endswith(":"))
        or "\x00" in item.filename
        or (mode and stat.S_ISLNK(mode))
    ):
        raise LibraryFolderArchiveError(
            "归档包含不安全路径", code="unsafe_archive_path", status=422
        )


def _validate_relative_path(relative_path: str) -> PurePosixPath:
    cleaned = relative_path.strip().replace("\\", "/")
    path = PurePosixPath(cleaned)
    if (
        not cleaned
        or path.is_absolute()
        or ".." in path.parts
        or any(part.endswith(":") for part in path.parts)
        or "\x00" in cleaned
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        raise LibraryFolderArchiveError(
            "相对路径不安全或无效", code="unsafe_relative_path", status=422
        )
    return path


def _unique_member_name(filename: str, used: set[str]) -> str:
    if filename.casefold() not in used:
        used.add(filename.casefold())
        return filename
    stem = Path(filename).stem
    suffix = Path(filename).suffix
    index = 2
    while True:
        candidate = f"{stem}-{index}{suffix}"
        if candidate.casefold() not in used:
            used.add(candidate.casefold())
            return candidate
        index += 1


def _folder_segment(name: str) -> str | None:
    cleaned = name.strip()
    if not cleaned or cleaned in {".", ".."} or len(cleaned) > 120:
        return None
    if any(char in '\\/:*?"<>|\x00' for char in cleaned):
        return None
    return cleaned


class LibraryFolderArchive:
    def __init__(self, session: AsyncSession, settings: Settings, owner_user_id: str) -> None:
        self.session = session
        self.settings = settings
        self.owner_user_id = owner_user_id
        self.storage = AssetStorage(settings)
        self.library = AssetLibrary(session, settings)

    async def _library_folder(self, folder_id: str) -> VisualAssetFolder:
        row = await self.session.get(VisualAssetFolder, folder_id)
        if row is None or row.owner_user_id != self.owner_user_id or row.project_id is not None:
            raise LibraryFolderArchiveError("文件夹不存在", code="not_found", status=404)
        return row

    async def _folder_depth(self, folder: VisualAssetFolder | None) -> int:
        if folder is None:
            return 0
        depth = 1
        parent_id = folder.parent_id
        while parent_id:
            parent = await self.session.get(VisualAssetFolder, parent_id)
            if parent is None:
                break
            depth += 1
            parent_id = parent.parent_id
        return depth

    async def _load_library_folders(self) -> list[VisualAssetFolder]:
        return list(
            (
                await self.session.execute(
                    select(VisualAssetFolder).where(
                        VisualAssetFolder.owner_user_id == self.owner_user_id,
                        VisualAssetFolder.project_id.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )

    async def _load_library_assets(self, folder_ids: set[str | None]) -> list[VisualAsset]:
        rows = (
            (
                await self.session.execute(
                    select(VisualAsset).where(
                        VisualAsset.owner_user_id == self.owner_user_id,
                        VisualAsset.project_id.is_(None),
                        VisualAsset.galgame_project_id.is_(None),
                        VisualAsset.video_editor_project_id.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        return [row for row in rows if row.folder_id in folder_ids]

    def _subtree_folder_ids(
        self, folders: list[VisualAssetFolder], root_id: str | None
    ) -> set[str | None]:
        children: dict[str | None, list[VisualAssetFolder]] = {}
        for folder in folders:
            children.setdefault(folder.parent_id, []).append(folder)
        if root_id is None:
            selected: set[str | None] = {None}
            stack = [folder.id for folder in children.get(None, [])]
        else:
            selected = set()
            stack = [root_id]
        while stack:
            current = stack.pop()
            selected.add(current)
            stack.extend(child.id for child in children.get(current, []))
        return selected

    async def export_subtree(self, folder_id: str | None) -> ExportedLibraryFolderArchive:
        root_folder = await self._library_folder(folder_id) if folder_id else None
        folders = await self._load_library_folders()
        folder_ids = self._subtree_folder_ids(folders, folder_id)
        assets = await self._load_library_assets(folder_ids)
        folder_by_id = {folder.id: folder for folder in folders}

        member_count = len(assets) + sum(1 for folder_key in folder_ids if folder_key is not None)
        if member_count > self.settings.fpl_project_snapshot_max_files:
            raise LibraryFolderArchiveError(
                "文件夹归档文件数量超过限制",
                code="archive_too_many_files",
                status=413,
            )

        declared_bytes = 0
        asset_paths: list[tuple[VisualAsset, Path]] = []
        for asset in assets:
            path = self.storage.path_for(asset)
            if not path.is_file():
                raise LibraryFolderArchiveError(
                    "素材文件不存在，无法导出完整归档",
                    code="archive_source_missing",
                    status=409,
                )
            declared_bytes += path.stat().st_size
            asset_paths.append((asset, path))
        if declared_bytes > self.settings.fpl_project_snapshot_max_bytes:
            raise LibraryFolderArchiveError(
                "文件夹归档超过大小限制", code="archive_too_large", status=413
            )

        staging = _staging_root(self.settings) / f"export-{uuid4().hex}"
        staging.mkdir(parents=True, exist_ok=True)
        destination = staging / "archive.zip"
        free = shutil.disk_usage(staging).free
        if free < declared_bytes:
            raise LibraryFolderArchiveError(
                "磁盘空间不足，无法生成文件夹归档",
                code="archive_disk_full",
                status=507,
            )

        def write_zip() -> None:
            names_by_dir: dict[str, set[str]] = {}
            with zipfile.ZipFile(destination, "x", allowZip64=True) as archive:
                for folder_key in sorted(
                    (key for key in folder_ids if key is not None),
                    key=lambda key: folder_by_id[key].name.casefold(),
                ):
                    relative = self._export_folder_relative(folder_by_id, folder_key, root_folder)
                    if relative is None:
                        continue
                    archive.writestr(f"{relative}/", b"")
                for asset, path in asset_paths:
                    relative_dir = self._export_asset_dir(
                        folder_by_id, asset.folder_id, root_folder
                    )
                    if relative_dir is None and asset.folder_id not in folder_ids:
                        continue
                    directory_key = relative_dir or ""
                    used = names_by_dir.setdefault(directory_key, set())
                    filename = _unique_member_name(
                        download_filename(asset.display_name, asset.original_filename),
                        used,
                    )
                    member = f"{relative_dir}/{filename}" if relative_dir else filename
                    archive.write(path, arcname=member, compress_type=zipfile.ZIP_DEFLATED)

        try:
            await asyncio.to_thread(write_zip)
        except Exception:
            shutil.rmtree(staging, ignore_errors=True)
            raise

        title = root_folder.name if root_folder else "library"
        return ExportedLibraryFolderArchive(
            path=destination, filename=_safe_archive_filename(title)
        )

    def _export_folder_relative(
        self,
        folder_by_id: dict[str, VisualAssetFolder],
        folder_id: str,
        root_folder: VisualAssetFolder | None,
    ) -> str | None:
        parts: list[str] = []
        current: VisualAssetFolder | None = folder_by_id.get(folder_id)
        while current is not None:
            parts.append(current.name)
            if root_folder is not None and current.id == root_folder.id:
                break
            if current.parent_id is None:
                if root_folder is not None:
                    return None
                break
            current = folder_by_id.get(current.parent_id)
        parts.reverse()
        if root_folder is None:
            return "/".join(parts)
        return "/".join(parts)

    def _export_asset_dir(
        self,
        folder_by_id: dict[str, VisualAssetFolder],
        folder_id: str | None,
        root_folder: VisualAssetFolder | None,
    ) -> str | None:
        if folder_id is None:
            return None if root_folder is None else root_folder.name
        relative = self._export_folder_relative(folder_by_id, folder_id, root_folder)
        return relative

    async def ensure_folder_path(
        self,
        parent: VisualAssetFolder | None,
        segments: Iterable[str],
        *,
        acc: _ImportAccumulator,
        report_path: str,
    ) -> VisualAssetFolder | None:
        current = parent
        built: list[str] = []
        for raw in segments:
            segment = _folder_segment(raw)
            built.append(raw)
            path_label = "/".join(built)
            if segment is None:
                acc.skip(path_label or report_path, "invalid_folder_name", "文件夹名称无效")
                return None
            depth = await self._folder_depth(current)
            if depth >= MAX_FOLDER_DEPTH:
                acc.skip(path_label, "folder_depth_exceeded", "文件夹最多支持五层")
                return None
            parent_id = current.id if current else None
            existing = await self._find_child_folder(parent_id, segment)
            if existing is not None:
                current = existing
                continue
            row = VisualAssetFolder(
                owner_user_id=self.owner_user_id,
                project_id=None,
                parent_id=parent_id,
                name=segment,
            )
            self.session.add(row)
            try:
                await self.session.commit()
            except IntegrityError:
                await self.session.rollback()
                existing = await self._find_child_folder(parent_id, segment)
                if existing is None:
                    acc.skip(path_label, "name_conflict", "无法创建同名文件夹")
                    return None
                current = existing
                continue
            await self.session.refresh(row)
            acc.created_folders += 1
            current = row
        return current

    async def _find_child_folder(
        self, parent_id: str | None, name: str
    ) -> VisualAssetFolder | None:
        return (
            await self.session.execute(
                select(VisualAssetFolder).where(
                    VisualAssetFolder.owner_user_id == self.owner_user_id,
                    VisualAssetFolder.project_id.is_(None),
                    VisualAssetFolder.parent_id == parent_id
                    if parent_id is not None
                    else VisualAssetFolder.parent_id.is_(None),
                    func.lower(VisualAssetFolder.name) == name.lower(),
                )
            )
        ).scalar_one_or_none()

    async def import_archive(
        self, archive: IncomingFile, *, parent_folder_id: str | None
    ) -> LibraryFolderImportOut:
        parent = await self._library_folder(parent_folder_id) if parent_folder_id else None
        staging = _staging_root(self.settings) / f"import-{uuid4().hex}"
        staging.mkdir(parents=True, exist_ok=True)
        archive_path = staging / "upload.zip"
        acc = _ImportAccumulator()
        try:
            size = 0
            with archive_path.open("xb") as target:
                while chunk := await archive.read(1024 * 1024):
                    size += len(chunk)
                    if size > self.settings.fpl_project_snapshot_max_bytes:
                        raise LibraryFolderArchiveError(
                            "文件夹归档超过上传大小限制",
                            code="archive_too_large",
                            status=413,
                        )
                    target.write(chunk)
            if size == 0:
                raise LibraryFolderArchiveError("归档文件为空", code="empty_archive")
            await self._import_zip_path(archive_path, parent=parent, acc=acc)
            return acc.to_out()
        finally:
            await archive.close()
            shutil.rmtree(staging, ignore_errors=True)

    async def _import_zip_path(
        self,
        archive_path: Path,
        *,
        parent: VisualAssetFolder | None,
        acc: _ImportAccumulator,
    ) -> None:
        try:
            archive = zipfile.ZipFile(archive_path)
        except (zipfile.BadZipFile, OSError) as exc:
            raise LibraryFolderArchiveError("无法读取 ZIP 归档", code="invalid_archive") from exc
        with archive:
            infos = archive.infolist()
            if len(infos) > self.settings.fpl_project_snapshot_max_files:
                raise LibraryFolderArchiveError(
                    "文件夹归档文件数量超过限制",
                    code="archive_too_many_files",
                    status=413,
                )
            expanded = 0
            for item in infos:
                _validate_zip_member(item)
                expanded += item.file_size
                if expanded > self.settings.fpl_project_snapshot_max_bytes:
                    raise LibraryFolderArchiveError(
                        "文件夹归档展开后超过大小限制",
                        code="archive_too_large",
                        status=413,
                    )
            extract_root = archive_path.parent / "extracted"
            extract_root.mkdir(parents=True, exist_ok=True)
            for item in infos:
                path = PurePosixPath(item.filename)
                is_dir = item.is_dir() or item.filename.endswith("/")
                if is_dir:
                    segments = [part for part in path.parts if part not in {"", "."}]
                    if not segments:
                        continue
                    await self.ensure_folder_path(
                        parent, segments, acc=acc, report_path=item.filename
                    )
                    continue
                if not path.name:
                    continue
                try:
                    relative = _validate_relative_path(item.filename)
                except LibraryFolderArchiveError as exc:
                    acc.skip(item.filename, exc.code, str(exc))
                    continue
                folder_segments = list(relative.parts[:-1])
                filename = relative.name
                target_folder = parent
                if folder_segments:
                    target_folder = await self.ensure_folder_path(
                        parent, folder_segments, acc=acc, report_path=item.filename
                    )
                    if target_folder is None and folder_segments:
                        continue
                extension = Path(filename).suffix.lower()
                if extension not in ALLOWED_FILES:
                    acc.skip(item.filename, "unsupported_file_type", "不支持此文件类型")
                    continue
                destination = extract_root.joinpath(*relative.parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                try:
                    with archive.open(item, "r") as source, destination.open("xb") as target:
                        copied = 0
                        while chunk := source.read(1024 * 1024):
                            copied += len(chunk)
                            if copied > self.settings.fpl_visual_asset_max_bytes:
                                raise AssetError(
                                    "文件超过上传大小限制",
                                    code="file_too_large",
                                    status=413,
                                )
                            target.write(chunk)
                    _media_kind, mime_types = ALLOWED_FILES[extension]
                    row, _path = await self.library.stage_local_copy(
                        destination,
                        owner_user_id=self.owner_user_id,
                        filename=filename,
                        content_type=sorted(mime_types)[0],
                        folder_id=target_folder.id if target_folder else None,
                    )
                    await self.session.commit()
                    await self.session.refresh(row)
                    acc.created_files += 1
                except AssetError as exc:
                    acc.skip(item.filename, exc.code, str(exc))
                    destination.unlink(missing_ok=True)
                except OSError as exc:
                    acc.skip(item.filename, "copy_failed", f"无法写入文件：{exc}")
                    destination.unlink(missing_ok=True)

    async def import_entries(
        self,
        files: list[IncomingFile],
        relative_paths: list[str],
        *,
        parent_folder_id: str | None,
    ) -> LibraryFolderImportOut:
        if len(files) != len(relative_paths):
            raise LibraryFolderArchiveError(
                "files 与 relative_paths 数量必须一致",
                code="entry_path_mismatch",
            )
        if len(files) > self.settings.fpl_project_snapshot_max_files:
            raise LibraryFolderArchiveError(
                "文件夹归档文件数量超过限制",
                code="archive_too_many_files",
                status=413,
            )
        parent = await self._library_folder(parent_folder_id) if parent_folder_id else None
        acc = _ImportAccumulator()
        for upload, relative_path in zip(files, relative_paths, strict=True):
            try:
                relative = _validate_relative_path(relative_path)
            except LibraryFolderArchiveError as exc:
                acc.skip(relative_path, exc.code, str(exc))
                await upload.close()
                continue
            folder_segments = list(relative.parts[:-1])
            filename = relative.name
            target_folder = parent
            if folder_segments:
                target_folder = await self.ensure_folder_path(
                    parent, folder_segments, acc=acc, report_path=relative_path
                )
                if target_folder is None and folder_segments:
                    await upload.close()
                    continue
            extension = Path(filename).suffix.lower()
            if extension not in ALLOWED_FILES:
                acc.skip(relative_path, "unsupported_file_type", "不支持此文件类型")
                await upload.close()
                continue
            try:
                row = await self.library.store_upload(
                    upload,
                    owner_user_id=self.owner_user_id,
                    filename_override=filename,
                    folder_id=target_folder.id if target_folder else None,
                )
                await self.session.refresh(row)
                acc.created_files += 1
            except AssetError as exc:
                acc.skip(relative_path, exc.code, str(exc))
            except Exception:
                await upload.close()
                raise
        return acc.to_out()
