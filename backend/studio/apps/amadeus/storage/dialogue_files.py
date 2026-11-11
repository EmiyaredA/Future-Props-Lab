"""Bounded file reads for one owned dialogue."""

import base64
from functools import partial
from io import BytesIO
from pathlib import Path

from anyio.to_thread import run_sync
from PIL import Image, ImageOps, UnidentifiedImageError

from studio.contracts.amadeus.conversations import IMAGE_ATTACHMENT_EXTENSIONS
from studio.runtime.database.operation_receipts import OperationError

from .files import list_files, open_work_file
from .skill_files import read_skill_file

TOOL_FILE_BYTES = 1024 * 1024
IMAGE_FORMATS = ("AVIF", "BMP", "GIF", "JPEG", "PNG", "TIFF", "WEBP")
INLINE_IMAGE_TYPES = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


def _image_part(file, size):
    try:
        with Image.open(file, formats=IMAGE_FORMATS) as image:
            if image.width * image.height > 40_000_000:
                raise OperationError("图片超过解码尺寸限制", "image_too_large", 422)
            mime = INLINE_IMAGE_TYPES.get(image.format)
            if mime and size <= TOOL_FILE_BYTES:
                image.load()
                file.seek(0)
                data = file.read(TOOL_FILE_BYTES + 1)
            else:
                image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
                frame = ImageOps.exif_transpose(image).convert("RGBA")
                background = Image.new("RGB", frame.size, "white")
                background.paste(frame, mask=frame.getchannel("A"))
                output = BytesIO()
                background.save(output, format="JPEG", quality=85)
                data, mime = output.getvalue(), "image/jpeg"
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        SyntaxError,
        Image.DecompressionBombError,
    ) as exc:
        raise OperationError("图片无法解码", "unsupported_file", 422) from exc
    if len(data) > TOOL_FILE_BYTES:
        raise OperationError("图片预览超过读取限制", "image_too_large", 422)
    return {"type": "image", "data": base64.b64encode(data).decode("ascii"), "mimeType": mime}


def read_file(owner, conversation, root, kind, name):
    file, size = open_work_file(owner, conversation, kind, name, files_root=root)
    with file:
        if Path(name).suffix.lower() in IMAGE_ATTACHMENT_EXTENSIONS:
            return [_image_part(file, size)]
        if size > TOOL_FILE_BYTES:
            raise OperationError("文件过大，请使用文件下载接口", "file_too_large", 422)
        data = file.read(TOOL_FILE_BYTES + 1)
    if len(data) > TOOL_FILE_BYTES:
        raise OperationError("文件过大，请使用文件下载接口", "file_too_large", 422)
    try:
        return {"content": data.decode("utf-8")}
    except UnicodeDecodeError as exc:
        raise OperationError("文件不是 UTF-8 文本", "unsupported_file", 422) from exc


class DialogueFiles:
    def __init__(self, owner, conversation, root):
        self.owner, self.conversation, self.root = owner, conversation, root

    async def list(self):
        return await run_sync(
            partial(list_files, self.owner, self.conversation, files_root=self.root)
        )

    async def read(self, kind, name):
        return await run_sync(read_file, self.owner, self.conversation, self.root, kind, name)

    async def read_skill(self, identity, version, path):
        return await run_sync(
            partial(
                read_skill_file,
                self.owner,
                self.conversation,
                identity,
                version,
                path,
                files_root=self.root,
            )
        )
