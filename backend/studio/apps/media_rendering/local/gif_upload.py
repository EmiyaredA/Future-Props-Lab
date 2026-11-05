"""Normalize animated uploads before starting the output persistence transaction."""

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from tempfile import TemporaryDirectory

from studio.apps.media_rendering.local.animated_image import gif_to_mp4, gif_to_webm
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.asset_library.incoming import IncomingFile
from studio.runtime.files.content_types import looks_like


class ConvertedVideo:
    content_type = "video/mp4"

    def __init__(self, path: Path, filename: str, content_type: str = "video/mp4"):
        self.content_type = content_type
        self.filename = filename
        self.file = path.open("rb")

    async def read(self, size: int = -1) -> bytes:
        return await asyncio.to_thread(self.file.read, size)

    async def close(self) -> None:
        self.file.close()


@asynccontextmanager
async def prepare_output_upload(
    upload: IncomingFile, kind: str, *, max_bytes: int, work_root: Path | None = None
):
    filename = Path(upload.filename or "").name
    if kind != "video" or Path(filename).suffix.lower() != ".gif":
        yield upload, None
        return
    try:
        with TemporaryDirectory(prefix="visual-gif-upload-", dir=work_root) as temporary:
            source, target = Path(temporary) / "source.gif", Path(temporary) / "result.mp4"
            size = 0
            head = bytearray()
            with source.open("xb") as output:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > max_bytes:
                        raise AssetError("文件超过上传大小限制", code="file_too_large", status=413)
                    if len(head) < 10:
                        head.extend(chunk[: 10 - len(head)])
                    await asyncio.to_thread(output.write, chunk)
            if len(head) < 10 or not looks_like(".gif", bytes(head)):
                raise AssetError("文件内容与声明的类型不匹配", code="invalid_file_content")
            width = int.from_bytes(head[6:8], "little")
            height = int.from_bytes(head[8:10], "little")
            if not width or not height or max(width, height) > 8192 or width * height > 16_777_216:
                raise AssetError("GIF 画布尺寸超过转换限制", code="invalid_gif_dimensions")
            inspection = Path(temporary) / "inspection.webm"
            try:
                async with asyncio.timeout(120):
                    await gif_to_mp4(source, target, max_bytes=max_bytes)
                    await gif_to_webm(source, inspection, max_bytes=max_bytes)
            except FileNotFoundError:
                raise AssetError(
                    "GIF 转换工具不可用，请检查 FFmpeg",
                    code="gif_conversion_unavailable",
                    status=503,
                ) from None
            except TimeoutError:
                raise AssetError(
                    "GIF 转换超时，请缩短动画后重新上传", code="gif_conversion_timeout", status=422
                ) from None
            except OverflowError as exc:
                raise AssetError(str(exc), code="file_too_large", status=413) from None
            except ValueError as exc:
                raise AssetError(str(exc), code="invalid_file_content") from None
            converted = ConvertedVideo(target, str(Path(filename).with_suffix(".mp4")))
            transparent = ConvertedVideo(
                inspection, str(Path(filename).with_suffix(".webm")), "video/webm"
            )
            try:
                yield converted, transparent
            finally:
                await converted.close()
                await transparent.close()
    finally:
        await upload.close()
