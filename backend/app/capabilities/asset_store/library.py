from __future__ import annotations

import asyncio
import os
from pathlib import Path
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store.incoming import IncomingFile
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.policy import (
    ALLOWED_FILES,
    display_name_without_original_extension,
    looks_like,
    normalize_content_type,
    validate_file_structure,
)
from app.capabilities.asset_store.storage import TARGET_STORAGE_VERSION, AssetStorage
from app.runtime.config import Settings


class AssetError(Exception):
    def __init__(
        self,
        message: str,
        *,
        code: str = "asset_error",
        status: int = 422,
        detail: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.detail = detail or {}


class AssetLibrary:
    """Business-neutral validation and persistence for managed files."""

    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings
        self.storage = AssetStorage(settings)

    async def store_upload(
        self,
        upload: IncomingFile,
        *,
        owner_user_id: str,
        filename_override: str | None = None,
        display_name: str | None = None,
        visual_project_id: str | None = None,
        galgame_project_id: str | None = None,
        video_editor_project_id: str | None = None,
        motion_compositor_project_id: str | None = None,
        folder_id: str | None = None,
        allowed_extensions: set[str] | None = None,
        commit: bool = True,
        defer_persistence: bool = False,
    ) -> VisualAsset:
        """Validate and stage a managed upload.

        With defer_persistence, the caller owns adding the row, committing and
        removing its file on failure after staging all related uploads.
        """
        filename = Path(filename_override or upload.filename or "").name
        extension = Path(filename).suffix.lower()
        config = ALLOWED_FILES.get(extension)
        if (
            not filename
            or config is None
            or (allowed_extensions is not None and extension not in allowed_extensions)
        ):
            raise AssetError("不支持此文件类型", code="unsupported_file_type")
        media_kind, mime_types = config
        # Declared MIME is advisory: browsers mislabel Matroska and other containers.
        # Magic-byte checks below remain authoritative for content acceptance.
        content_type = normalize_content_type(upload.content_type)
        resolved_display = display_name_without_original_extension(
            (display_name or "").strip() or filename,
            filename,
        )
        if not resolved_display:
            raise AssetError("显示名称不能为空", code="invalid_display_name")

        storage_key = uuid4().hex
        temp_path, final_path = self.storage.prepare_write(
            storage_key,
            visual_project_id=visual_project_id,
            galgame_project_id=galgame_project_id,
            video_editor_project_id=video_editor_project_id,
            motion_compositor_project_id=motion_compositor_project_id,
            owner_user_id=owner_user_id,
        )
        size = 0
        head = bytearray()
        commit_started = False
        try:
            with temp_path.open("xb") as target:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > (
                        min(self.settings.fpl_visual_asset_max_bytes, 2 * 1024 * 1024)
                        if extension == ".svg"
                        else self.settings.fpl_visual_asset_max_bytes
                    ):
                        raise AssetError(
                            "文件超过上传大小限制",
                            code="file_too_large",
                            status=413,
                        )
                    if len(head) < 512:
                        head.extend(chunk[: 512 - len(head)])
                    target.write(chunk)
            if size == 0 or not looks_like(extension, bytes(head)):
                raise AssetError("文件内容与声明的类型不匹配", code="invalid_file_content")
            if not await asyncio.to_thread(validate_file_structure, temp_path, extension):
                raise AssetError("文件内容或内部结构无效", code="invalid_file_content")
            if extension == ".svg":
                from app.capabilities.asset_store.svg import normalize_svg

                try:
                    normalized = normalize_svg(temp_path.read_text(encoding="utf-8-sig"))
                except ValueError as exc:
                    raise AssetError(str(exc), code="invalid_svg") from exc
                temp_path.write_text(normalized["svg"], encoding="utf-8")
                size = temp_path.stat().st_size
            os.replace(temp_path, final_path)
            row = VisualAsset(
                owner_user_id=owner_user_id,
                project_id=visual_project_id,
                galgame_project_id=galgame_project_id,
                video_editor_project_id=video_editor_project_id,
                motion_compositor_project_id=motion_compositor_project_id,
                folder_id=folder_id,
                original_filename=filename,
                display_name=resolved_display,
                storage_key=storage_key,
                storage_version=TARGET_STORAGE_VERSION,
                media_kind=media_kind,
                mime_type=(content_type if content_type in mime_types else sorted(mime_types)[0]),
                byte_size=size,
            )
            if not defer_persistence:
                self.session.add(row)
                if commit:
                    commit_started = True
                    await self.session.commit()
                    await self.session.refresh(row)
                else:
                    await self.session.flush()
            return row
        except BaseException:
            temp_path.unlink(missing_ok=True)
            # A failed commit/refresh may have lost its acknowledgement after
            # SQLite committed. Keep the file until that outcome is known.
            if not commit_started:
                final_path.unlink(missing_ok=True)
            raise
        finally:
            await upload.close()

    async def stage_local_copy(
        self,
        source_path: Path,
        *,
        owner_user_id: str,
        filename: str,
        content_type: str,
        folder_id: str | None = None,
        galgame_project_id: str | None = None,
        video_editor_project_id: str | None = None,
        motion_compositor_project_id: str | None = None,
        allowed_extensions: set[str] | None = None,
        max_bytes: int | None = None,
        defer_persistence: bool = False,
    ) -> tuple[VisualAsset, Path]:
        """Stage an existing local file for an enclosing atomic use case.

        The caller owns the surrounding transaction and must remove the returned
        path if a later database operation fails. With defer_persistence, the caller
        must also add the returned row after all file staging has completed.
        """
        safe_name = Path(filename).name
        extension = Path(safe_name).suffix.lower()
        config = ALLOWED_FILES.get(extension)
        if (
            not safe_name
            or config is None
            or (allowed_extensions is not None and extension not in allowed_extensions)
        ):
            raise AssetError("不支持此文件类型", code="unsupported_file_type")
        media_kind, mime_types = config
        normalized_type = normalize_content_type(content_type)
        if not source_path.is_file():
            raise AssetError("源文件内容不存在", code="not_found", status=404)

        storage_key = uuid4().hex
        temp_path, final_path = self.storage.prepare_write(
            storage_key,
            visual_project_id=None,
            galgame_project_id=galgame_project_id,
            video_editor_project_id=video_editor_project_id,
            motion_compositor_project_id=motion_compositor_project_id,
            owner_user_id=owner_user_id,
        )

        def copy_file() -> tuple[int, bytes]:
            size = 0
            head = bytearray()
            with source_path.open("rb") as source, temp_path.open("xb") as target:
                while chunk := source.read(1024 * 1024):
                    size += len(chunk)
                    if size > (max_bytes or self.settings.fpl_visual_asset_max_bytes):
                        raise AssetError(
                            "文件超过上传大小限制",
                            code="file_too_large",
                            status=413,
                        )
                    if len(head) < 512:
                        head.extend(chunk[: 512 - len(head)])
                    target.write(chunk)
            return size, bytes(head)

        try:
            size, head = await asyncio.to_thread(copy_file)
            if size == 0 or not looks_like(extension, head):
                raise AssetError("文件内容与声明的类型不匹配", code="invalid_file_content")
            if not await asyncio.to_thread(validate_file_structure, temp_path, extension):
                raise AssetError("文件内容或内部结构无效", code="invalid_file_content")
            os.replace(temp_path, final_path)
            row = VisualAsset(
                owner_user_id=owner_user_id,
                project_id=None,
                galgame_project_id=galgame_project_id,
                video_editor_project_id=video_editor_project_id,
                motion_compositor_project_id=motion_compositor_project_id,
                folder_id=folder_id,
                original_filename=safe_name,
                display_name=display_name_without_original_extension(safe_name, safe_name),
                storage_key=storage_key,
                storage_version=TARGET_STORAGE_VERSION,
                media_kind=media_kind,
                mime_type=(
                    normalized_type if normalized_type in mime_types else sorted(mime_types)[0]
                ),
                byte_size=size,
            )
            if not defer_persistence:
                self.session.add(row)
                await self.session.flush()
            return row, final_path
        except Exception:
            temp_path.unlink(missing_ok=True)
            final_path.unlink(missing_ok=True)
            raise
