from __future__ import annotations

import asyncio
import os
from pathlib import Path
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.files.incoming import IncomingFile
from app.files.policy import (
    ALLOWED_FILES,
    display_name_without_original_extension,
    looks_like,
    validate_json_file,
)
from app.files.storage import TARGET_STORAGE_VERSION, AssetStorage
from app.models import VisualAsset


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
        workspace_id: str,
        filename_override: str | None = None,
        visual_project_id: str | None = None,
        galgame_project_id: str | None = None,
        video_editor_project_id: str | None = None,
        folder_id: str | None = None,
        allowed_extensions: set[str] | None = None,
    ) -> VisualAsset:
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
        content_type = (upload.content_type or "application/octet-stream").lower()
        if content_type not in mime_types and content_type != "application/octet-stream":
            raise AssetError("文件扩展名与 MIME 类型不匹配", code="file_type_mismatch")

        storage_key = uuid4().hex
        temp_path, final_path = self.storage.prepare_write(
            storage_key,
            visual_project_id=visual_project_id,
            galgame_project_id=galgame_project_id,
            video_editor_project_id=video_editor_project_id,
            workspace_id=workspace_id,
        )
        size = 0
        head = bytearray()
        try:
            with temp_path.open("xb") as target:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > self.settings.fpl_visual_asset_max_bytes:
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
            if extension == ".json" and not validate_json_file(temp_path):
                raise AssetError("JSON 文件内容无效", code="invalid_file_content")
            os.replace(temp_path, final_path)
            row = VisualAsset(
                workspace_id=workspace_id,
                project_id=visual_project_id,
                galgame_project_id=galgame_project_id,
                video_editor_project_id=video_editor_project_id,
                folder_id=folder_id,
                original_filename=filename,
                display_name=display_name_without_original_extension(filename, filename),
                storage_key=storage_key,
                storage_version=TARGET_STORAGE_VERSION,
                media_kind=media_kind,
                mime_type=(content_type if content_type in mime_types else sorted(mime_types)[0]),
                byte_size=size,
            )
            self.session.add(row)
            await self.session.commit()
            await self.session.refresh(row)
            return row
        except Exception:
            temp_path.unlink(missing_ok=True)
            final_path.unlink(missing_ok=True)
            raise
        finally:
            await upload.close()

    async def stage_local_copy(
        self,
        source_path: Path,
        *,
        workspace_id: str,
        filename: str,
        content_type: str,
        folder_id: str | None = None,
        galgame_project_id: str | None = None,
        video_editor_project_id: str | None = None,
        allowed_extensions: set[str] | None = None,
        max_bytes: int | None = None,
    ) -> tuple[VisualAsset, Path]:
        """Stage an existing local file for an enclosing atomic use case.

        The caller owns the surrounding transaction and must remove the returned
        path if a later database operation fails.
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
        normalized_type = content_type.lower().strip() or "application/octet-stream"
        if normalized_type not in mime_types and normalized_type != "application/octet-stream":
            raise AssetError("文件扩展名与 MIME 类型不匹配", code="file_type_mismatch")
        if not source_path.is_file():
            raise AssetError("源文件内容不存在", code="not_found", status=404)

        storage_key = uuid4().hex
        temp_path, final_path = self.storage.prepare_write(
            storage_key,
            visual_project_id=None,
            galgame_project_id=galgame_project_id,
            video_editor_project_id=video_editor_project_id,
            workspace_id=workspace_id,
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
            if extension == ".json" and not validate_json_file(temp_path):
                raise AssetError("JSON 文件内容无效", code="invalid_file_content")
            os.replace(temp_path, final_path)
            row = VisualAsset(
                workspace_id=workspace_id,
                project_id=None,
                galgame_project_id=galgame_project_id,
                video_editor_project_id=video_editor_project_id,
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
            self.session.add(row)
            await self.session.flush()
            return row, final_path
        except Exception:
            temp_path.unlink(missing_ok=True)
            final_path.unlink(missing_ok=True)
            raise
