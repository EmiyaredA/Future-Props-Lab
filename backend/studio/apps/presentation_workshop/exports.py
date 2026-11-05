"""Bounded request exports with private files and cancellation-safe cleanup."""

import asyncio
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from threading import BoundedSemaphore

from PIL import Image, ImageOps, UnidentifiedImageError

from studio.apps.presentation_workshop.asset_references import (
    document_references,
    rendered_asset_ids,
)
from studio.apps.presentation_workshop.pptx_export import write_pptx
from studio.apps.presentation_workshop.projects import PresentationError, Presentations
from studio.apps.presentation_workshop.schemas.document import PresentationProjectOut
from studio.apps.presentation_workshop.templates.resolver import resolve_document
from studio.runtime.files.svg import normalize_svg
from studio.runtime.revisions import RevisionConflictError

EXPORT_SLOTS = BoundedSemaphore(2)
MAX_EXPORT_BYTES = 100 * 1024 * 1024


@dataclass
class PresentationExport:
    root: Path
    path: Path
    filename: str

    def cleanup(self):
        shutil.rmtree(self.root, ignore_errors=True)


def build_export(
    snapshot: PresentationProjectOut, assets: dict[str, Path], media_types=None, directory=None
) -> PresentationExport:
    if not EXPORT_SLOTS.acquire(blocking=False):
        raise PresentationError("导出繁忙，请稍后重试", 429, "export_busy")
    try:
        root = Path(tempfile.mkdtemp(prefix="fpl-presentation-", dir=directory))
    except BaseException:
        EXPORT_SLOTS.release()
        raise
    result = PresentationExport(
        root,
        root / "presentation.pptx",
        snapshot.title.replace("/", "_").replace("\\", "_") + ".pptx",
    )
    try:
        expanded, issues = resolve_document(snapshot.document)
        if any(issue["code"] == "toc_overflow" for issue in issues):
            raise PresentationError("目录未完全展示，请先添加目录续页", 422, "toc_overflow")
        snapshot = snapshot.model_copy(update={"document": expanded})
        vectors = [
            e
            for s in snapshot.document.slides
            for e in s.elements
            if not e.hidden and e.kind in {"vector", "formula"}
        ]
        pixels = sum(
            e.width * e.height * min(2, 4096 / max(e.width, e.height)) ** 2 for e in vectors
        )
        if len(vectors) > 512 or pixels > 64_000_000:
            raise PresentationError("导出矢量兼容图总量过大，请拆分文稿", 413, "export_too_large")
        total = normalized_total = 0
        media_types = media_types or {}
        media_ids = {
            e.asset_id
            for s in snapshot.document.slides
            for e in s.elements
            if e.kind in {"audio", "video"}
        }
        images = {}
        rendered_ids = rendered_asset_ids(snapshot.document.model_copy(update={"template": None}))
        excluded_ids = set(document_references(snapshot.document)) - rendered_ids
        for asset_id, source in assets.items():
            if asset_id in excluded_ids:
                continue
            # Copy a bounded private snapshot, so concurrent library changes cannot
            # alter a file while Pillow or the PPTX writer is reading it.
            import mimetypes

            suffix = mimetypes.guess_extension(media_types.get(asset_id, "")) or ".source"
            private = root / f"{asset_id}{suffix}"
            with source.open("rb") as incoming, private.open("wb") as output:
                while chunk := incoming.read(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_EXPORT_BYTES:
                        raise PresentationError(
                            "导出图片总量不能超过 100 MiB", 413, "export_too_large"
                        )
                    output.write(chunk)
            if asset_id in media_ids:
                images[asset_id] = private
                continue
            with private.open("rb") as head:
                is_svg = head.read(128).lstrip().startswith(b"<")
            if is_svg:
                import resvg_py

                vector = normalize_svg(private.read_text())
                images[asset_id] = root / f"{asset_id}.png"
                images[asset_id].with_suffix(".svg").write_text(vector["svg"])
                factor = min(1, 512 / max(vector["width"], vector["height"]))
                images[asset_id].write_bytes(
                    resvg_py.svg_to_bytes(
                        svg_string=vector["svg"],
                        width=max(1, round(vector["width"] * factor)),
                        height=max(1, round(vector["height"] * factor)),
                    )
                )
            else:
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
                raise PresentationError("转换后的图片总量不能超过 100 MiB", 413, "export_too_large")
        write_pptx(snapshot.document, images, result.path, media_types=media_types)
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


async def snapshot_at(projects, project_id, revision):
    snapshot = await projects.get(project_id)
    if snapshot.revision != revision:
        raise RevisionConflictError(revision, snapshot.revision, snapshot.model_dump(mode="json"))
    await projects.session.rollback()
    return snapshot


async def render_in_thread(function, *args, cleanup=None):
    task = asyncio.create_task(asyncio.to_thread(function, *args))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        # The staged inputs belong to this request until the writer has stopped.
        try:
            result = await task
        except Exception:
            pass
        else:
            if cleanup is not None:
                cleanup(result)
        raise


async def export_project(
    projects: Presentations, project_id: str, revision: int
) -> PresentationExport:
    snapshot = await snapshot_at(projects, project_id, revision)
    rows = await projects.assets(snapshot.document)
    rendered_ids = rendered_asset_ids(snapshot.document)
    rows = [row for row in rows if row.id in rendered_ids]
    if sum(row.byte_size for row in rows) > MAX_EXPORT_BYTES:
        raise PresentationError("导出图片总量不能超过 100 MiB", 413, "export_too_large")
    async with projects.asset_access.export_sources(rows) as sources:
        paths = {row.id: path for row, path in sources}
        media_types = {row.id: row.mime_type for row, _ in sources}
        return await render_in_thread(
            build_export,
            snapshot,
            paths,
            media_types,
            projects.asset_access.export_output_root,
            cleanup=PresentationExport.cleanup,
        )
