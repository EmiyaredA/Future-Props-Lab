"""Bounded request exports with private files and cancellation-safe cleanup."""

import asyncio
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from threading import BoundedSemaphore

from PIL import Image, ImageOps, UnidentifiedImageError

from app.concurrency.revisions import RevisionConflictError
from app.files import AssetStorage
from app.presentation_workshop.projects import PresentationError, Presentations
from app.schemas.presentation_workshop import PresentationProjectOut

EXPORT_SLOTS = BoundedSemaphore(2)
MAX_EXPORT_BYTES = 100 * 1024 * 1024


@dataclass
class PresentationExport:
    root: Path
    path: Path
    filename: str

    def cleanup(self):
        shutil.rmtree(self.root, ignore_errors=True)


def build_export(snapshot: PresentationProjectOut, assets: dict[str, Path]) -> PresentationExport:
    if not EXPORT_SLOTS.acquire(blocking=False):
        raise PresentationError("导出繁忙，请稍后重试", 429, "export_busy")
    try:
        root = Path(tempfile.mkdtemp(prefix="fpl-presentation-"))
    except BaseException:
        EXPORT_SLOTS.release()
        raise
    result = PresentationExport(
        root,
        root / "presentation.pptx",
        snapshot.title.replace("/", "_").replace("\\", "_") + ".pptx",
    )
    try:
        total = normalized_total = 0
        images = {}
        for asset_id, source in assets.items():
            # Copy a bounded private snapshot, so concurrent library changes cannot
            # alter a file while Pillow or the PPTX writer is reading it.
            private = root / f"{asset_id}.source"
            with source.open("rb") as incoming, private.open("wb") as output:
                while chunk := incoming.read(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_EXPORT_BYTES:
                        raise PresentationError(
                            "导出图片总量不能超过 100 MiB", 413, "export_too_large"
                        )
                    output.write(chunk)
            with Image.open(private) as image:
                if image.width * image.height > 25_000_000:
                    raise PresentationError(
                        "导出图片单张不能超过 2500 万像素", 413, "export_too_large"
                    )
                image.seek(0)
                normalized = ImageOps.exif_transpose(image)
                images[asset_id] = root / f"{asset_id}.png"
                with normalized.convert("RGBA") as rgba:
                    rgba.save(images[asset_id], "PNG")
                normalized.close()
                normalized_total += images[asset_id].stat().st_size
                if normalized_total > MAX_EXPORT_BYTES:
                    raise PresentationError(
                        "转换后的图片总量不能超过 100 MiB", 413, "export_too_large"
                    )
        # Load the exporter only when an export is requested.
        from app.presentation_workshop.pptx_export import write_pptx

        write_pptx(snapshot.document, images, result.path)
        return result
    except PresentationError:
        result.cleanup()
        raise
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
        result.cleanup()
        raise PresentationError(
            "导出失败：图片缺失、损坏或尺寸过大", 422, "export_asset_unavailable"
        ) from exc
    except BaseException:
        result.cleanup()
        raise
    finally:
        EXPORT_SLOTS.release()


async def export_project(
    projects: Presentations, storage: AssetStorage, project_id: str, revision: int
) -> PresentationExport:
    snapshot = await projects.get(project_id)
    if snapshot.revision != revision:
        raise RevisionConflictError(revision, snapshot.revision, snapshot.model_dump(mode="json"))
    rows = await projects.assets(snapshot.document)
    if sum(row.byte_size for row in rows) > MAX_EXPORT_BYTES:
        raise PresentationError("导出图片总量不能超过 100 MiB", 413, "export_too_large")
    paths = {row.id: storage.path_for(row) for row in rows}
    await projects.session.rollback()
    work = asyncio.create_task(asyncio.to_thread(build_export, snapshot, paths))
    try:
        return await asyncio.shield(work)
    except asyncio.CancelledError:

        def cleanup(finished):
            if not finished.cancelled() and finished.exception() is None:
                finished.result().cleanup()

        work.add_done_callback(cleanup)
        raise
