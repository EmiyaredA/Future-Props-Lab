"""Existing read/derive operations use only a verified input and owned output paths."""

import asyncio
import contextlib
import io
import os
import shutil
import tempfile
import zipfile
from pathlib import Path
from uuid import uuid4

from PIL import Image, ImageOps, UnidentifiedImageError

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.media_rendering.image_grid import render_image_grid
from app.capabilities.media_rendering.media_info import inspect_video_info
from app.capabilities.media_rendering.preview_metadata import describe_preview, media_thumbnail
from app.capabilities.media_rendering.video_frames import extract_frame
from studio.runtime.files.raster import RasterPreviewError, RasterPreviews


class MediaPreviews:
    def __init__(self, settings):
        self.settings = settings
        self.raster = RasterPreviews(capacity=2)
        self.capacity = asyncio.Semaphore(2)

    async def thumbnail(self, info, source, size, page):
        if info.media_kind != "image":
            return await media_thumbnail(self.settings, info, source, size, page), "image/webp"
        if page != 1:
            raise AssetError("只有 PDF 支持分页预览", code="preview_page_out_of_range")
        target = (
            self.settings.account_path(info.owner_user_id)
            / "previews"
            / info.id
            / f"{info.revision}-{size}.webp"
        )
        if info.mime_type == "image/svg+xml":
            from app.capabilities.asset_store.svg import MAX_SVG_BYTES, normalize_svg

            if source.stat().st_size > MAX_SVG_BYTES:
                raise AssetError("SVG 超过预览限制", code="invalid_svg")
            target = target.with_suffix(".svg")
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                normalized = normalize_svg(source.read_text(encoding="utf-8-sig"))["svg"]
            except ValueError as exc:
                raise AssetError("SVG 无法预览", code="invalid_svg") from exc
            staged = target.with_name(uuid4().hex + ".tmp")
            try:
                staged.write_text(normalized, encoding="utf-8")
                os.replace(staged, target)
            finally:
                staged.unlink(missing_ok=True)
            return target, "image/svg+xml"
        try:
            return await self.raster.render(source, target, size), "image/webp"
        except RasterPreviewError as exc:
            raise AssetError(str(exc), code=exc.code) from exc

    async def metadata(self, info, source):
        return await describe_preview(self.settings, info, source)

    async def video_info(self, info, source):
        if info.media_kind != "video":
            raise AssetError("格式检查只支持视频文件")
        try:
            return await inspect_video_info(source)
        except (OSError, ValueError, TimeoutError) as exc:
            raise AssetError("视频格式信息暂时无法读取", code="media_info_unavailable") from exc

    async def crop(self, info, source, body):
        if info.media_kind != "image" or info.mime_type == "image/svg+xml":
            raise AssetError("裁剪需要栅格图片；SVG 请先通过预览接口转换")

        def render():
            with Image.open(source) as original:
                if original.width * original.height > 40_000_000:
                    raise AssetError("图片超过裁剪解码限制")
                image = ImageOps.exif_transpose(original)
                if body.x + body.width > image.width or body.y + body.height > image.height:
                    raise AssetError("裁剪范围超出图片边界")
                with image.crop(
                    (body.x, body.y, body.x + body.width, body.y + body.height)
                ) as cropped:
                    output = io.BytesIO()
                    cropped.convert("RGBA").save(output, format="PNG")
                    return output.getvalue()

        try:
            task = asyncio.create_task(asyncio.to_thread(render))
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            with contextlib.suppress(Exception):
                await task
            raise
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
            raise AssetError("图片无法解码或超过安全解码上限") from exc

    async def frames(self, info, source, body):
        if info.media_kind != "video":
            raise AssetError("逐帧提取只支持视频文件")
        root = self.settings.account_path(info.owner_user_id) / ".tmp" / "outputs"
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        directory = Path(tempfile.mkdtemp(prefix="frames-", dir=root))
        paths = []
        try:
            for index, position in enumerate(body.positions_ms):
                target = directory / f"frame-{index + 1:02}-{position}ms.png"
                await extract_frame(source, target, position, body.max_width)
                paths.append(target)
            if body.output == "grid":
                target = directory / "frames.png"

                def render():
                    return render_image_grid(
                        paths, [str(ms) + " ms" for ms in body.positions_ms], target, len(paths)
                    )
            else:
                target = directory / "frames.zip"

                def render():
                    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
                        for path in paths:
                            archive.write(path, path.name)

            task = asyncio.create_task(asyncio.to_thread(render))
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                with contextlib.suppress(Exception):
                    await task
                raise
            return target
        except (ValueError, FileNotFoundError, TimeoutError) as exc:
            shutil.rmtree(directory, ignore_errors=True)
            raise AssetError("视频帧提取失败") from exc
        except BaseException:
            shutil.rmtree(directory, ignore_errors=True)
            raise
