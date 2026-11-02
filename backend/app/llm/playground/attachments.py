from __future__ import annotations

import asyncio
import base64
import os
from pathlib import Path
from uuid import uuid4

from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store.incoming import IncomingFile
from app.capabilities.asset_store.library import AssetError
from app.capabilities.asset_store.thumbnails import ThumbnailSize, derived_thumbnail
from app.llm.models import ModelTestAttachment, ModelTestConversation
from app.llm.schemas.model_test import ModelTestAttachmentListOut, ModelTestAttachmentOut
from app.runtime.config import Settings
from app.runtime.time import iso_utc

MAX_ATTACHMENTS_PER_MESSAGE = 5
MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
MAX_IMAGE_DIMENSION = 8000
FORMAT_MIME_TYPES = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
    "GIF": "image/gif",
}


class AttachmentError(Exception):
    def __init__(
        self,
        message: str,
        *,
        code: str = "attachment_error",
        status: int = 422,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def attachment_out(row: ModelTestAttachment) -> ModelTestAttachmentOut:
    return ModelTestAttachmentOut(
        id=row.id,
        original_filename=row.original_filename,
        mime_type=row.mime_type,
        byte_size=row.byte_size,
        width=row.width,
        height=row.height,
        created_at=iso_utc(row.created_at),
    )


def _inspect_image(path: Path) -> tuple[str, int, int]:
    try:
        with Image.open(path) as image:
            mime_type = FORMAT_MIME_TYPES.get(str(image.format or "").upper())
            if mime_type is None:
                raise AttachmentError(
                    "仅支持 JPEG、PNG、WebP 和静态 GIF 图片",
                    code="unsupported_attachment_type",
                )
            width, height = image.size
            if width < 1 or height < 1:
                raise AttachmentError("图片尺寸无效", code="invalid_image_dimensions")
            if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION:
                raise AttachmentError(
                    "图片宽高不能超过 8000 像素",
                    code="image_dimensions_exceeded",
                    status=413,
                )
            if mime_type == "image/gif" and getattr(image, "n_frames", 1) > 1:
                raise AttachmentError(
                    "暂不支持动画 GIF，请上传静态图片",
                    code="animated_gif_unsupported",
                )
            image.verify()
            return mime_type, width, height
    except AttachmentError:
        raise
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError):
        raise AttachmentError("图片内容无效或已经损坏", code="invalid_image_content") from None


def _read_base64(path: Path) -> str:
    try:
        return base64.b64encode(path.read_bytes()).decode("ascii")
    except OSError:
        raise AttachmentError("图片文件不存在", code="attachment_missing", status=404) from None


class ModelTestAttachments:
    def __init__(self, session: AsyncSession, settings: Settings, owner_user_id: str) -> None:
        self.session = session
        self.settings = settings
        self.owner_user_id = owner_user_id

    def _root(self) -> Path:
        return self.settings.account_model_test_path(self.owner_user_id, "attachments")

    async def _conversation(self, conversation_id: str) -> ModelTestConversation:
        row = await self.session.get(ModelTestConversation, conversation_id)
        if row is None:
            raise AttachmentError("对话不存在", code="not_found", status=404)
        return row

    async def upload(
        self, conversation_id: str, uploads: list[IncomingFile]
    ) -> ModelTestAttachmentListOut:
        await self._conversation(conversation_id)
        if not uploads:
            raise AttachmentError("请至少选择一张图片", code="attachment_required")
        existing_count = int(
            (
                await self.session.execute(
                    select(func.count(ModelTestAttachment.id)).where(
                        ModelTestAttachment.conversation_id == conversation_id,
                        ModelTestAttachment.message_id.is_(None),
                    )
                )
            ).scalar_one()
        )
        if existing_count + len(uploads) > MAX_ATTACHMENTS_PER_MESSAGE:
            raise AttachmentError(
                "每条消息最多上传 5 张图片",
                code="attachment_count_exceeded",
            )

        current_position = (
            await self.session.execute(
                select(func.max(ModelTestAttachment.position)).where(
                    ModelTestAttachment.conversation_id == conversation_id,
                    ModelTestAttachment.message_id.is_(None),
                )
            )
        ).scalar_one()
        next_position = int(current_position if current_position is not None else -1) + 1
        root = self._root()
        temp_root = root / ".tmp"
        temp_root.mkdir(parents=True, exist_ok=True)
        staged: list[tuple[Path, Path, ModelTestAttachment]] = []
        temp_paths: list[Path] = []
        moved: list[Path] = []
        try:
            for offset, upload in enumerate(uploads):
                filename = Path(upload.filename or "").name.strip()
                if not filename:
                    filename = f"image-{offset + 1}"
                if len(filename) > 255:
                    raise AttachmentError("图片文件名不能超过 255 个字符")
                storage_key = uuid4().hex
                temp_path = temp_root / storage_key
                final_path = root / storage_key
                temp_paths.append(temp_path)
                size = 0
                with temp_path.open("xb") as target:
                    while chunk := await upload.read(1024 * 1024):
                        size += len(chunk)
                        if size > MAX_ATTACHMENT_BYTES:
                            raise AttachmentError(
                                "单张图片不能超过 8 MiB",
                                code="attachment_too_large",
                                status=413,
                            )
                        target.write(chunk)
                if size == 0:
                    raise AttachmentError("图片内容不能为空", code="invalid_image_content")
                mime_type, width, height = await asyncio.to_thread(_inspect_image, temp_path)
                declared_type = (upload.content_type or "").lower()
                if declared_type not in {"", "application/octet-stream", mime_type}:
                    raise AttachmentError(
                        "图片 MIME 类型与文件内容不匹配",
                        code="attachment_type_mismatch",
                    )
                row = ModelTestAttachment(
                    conversation_id=conversation_id,
                    position=next_position + offset,
                    original_filename=filename,
                    storage_key=storage_key,
                    mime_type=mime_type,
                    byte_size=size,
                    width=width,
                    height=height,
                )
                staged.append((temp_path, final_path, row))

            root.mkdir(parents=True, exist_ok=True)
            for temp_path, final_path, row in staged:
                os.replace(temp_path, final_path)
                moved.append(final_path)
                self.session.add(row)
            await self.session.commit()
            for _, _, row in staged:
                await self.session.refresh(row)
            return ModelTestAttachmentListOut(items=[attachment_out(row) for _, _, row in staged])
        except Exception:
            await self.session.rollback()
            for path in temp_paths:
                path.unlink(missing_ok=True)
            for path in moved:
                path.unlink(missing_ok=True)
            raise
        finally:
            for upload in uploads:
                await upload.close()

    async def _attachment(self, conversation_id: str, attachment_id: str) -> ModelTestAttachment:
        row = await self.session.get(ModelTestAttachment, attachment_id)
        if row is None or row.conversation_id != conversation_id:
            raise AttachmentError("图片附件不存在", code="not_found", status=404)
        return row

    async def delete_draft(self, conversation_id: str, attachment_id: str) -> None:
        row = await self._attachment(conversation_id, attachment_id)
        if row.message_id is not None:
            raise AttachmentError(
                "已发送的图片附件不能单独删除",
                code="attachment_already_sent",
                status=409,
            )
        path = self._root() / row.storage_key
        await self.session.delete(row)
        await self.session.commit()
        path.unlink(missing_ok=True)

    async def content(
        self, conversation_id: str, attachment_id: str, size: ThumbnailSize | None = None
    ) -> tuple[ModelTestAttachment, Path]:
        row = await self._attachment(conversation_id, attachment_id)
        path = self._root() / row.storage_key
        if not path.is_file():
            raise AttachmentError("图片文件不存在", code="attachment_missing", status=404)
        if size is not None:
            target = (
                self.settings.account_path(self.owner_user_id)
                / "previews"
                / "model-attachments"
                / row.id
                / f"{path.stat().st_mtime_ns}-{size}.webp"
            )
            try:
                path = await derived_thumbnail(path, target, size)
            except AssetError as exc:
                raise AttachmentError(str(exc), code=exc.code, status=exc.status) from exc
        return row, path

    async def encoded(self, row: ModelTestAttachment) -> str:
        path = self._root() / row.storage_key
        return await asyncio.to_thread(_read_base64, path)

    async def paths_for_conversation(self, conversation_id: str) -> list[Path]:
        rows = (
            (
                await self.session.execute(
                    select(ModelTestAttachment).where(
                        ModelTestAttachment.conversation_id == conversation_id
                    )
                )
            )
            .scalars()
            .all()
        )
        return [self._root() / row.storage_key for row in rows]
