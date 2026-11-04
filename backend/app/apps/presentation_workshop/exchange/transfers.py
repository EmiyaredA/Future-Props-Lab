"""account-aware presentation transfer use cases and private file staging."""

import asyncio
import base64
import json
import tempfile
from pathlib import Path
from uuid import uuid4

from app.apps.presentation_workshop.exchange.archives import MAX_BYTES, read_package
from app.apps.presentation_workshop.exchange.contracts import (
    ImportPreview,
    ParsedPresentation,
)
from app.apps.presentation_workshop.exchange.pptx_import import read_pptx
from app.apps.presentation_workshop.projects import PresentationError, Presentations
from app.apps.presentation_workshop.scene_edits import remap
from app.apps.presentation_workshop.schemas.document import PresentationProjectIn
from app.capabilities.asset_store.incoming import IncomingFile
from app.capabilities.asset_store.library import AssetLibrary
from app.capabilities.asset_store.svg import normalize_svg
from app.runtime.config import get_settings
from app.runtime.ids import new_id


async def parse_upload(upload: IncomingFile) -> ParsedPresentation:
    try:
        filename = Path(upload.filename or "").name
        content = bytearray()
        while chunk := await upload.read(1024 * 1024):
            content.extend(chunk)
            if len(content) > MAX_BYTES:
                raise PresentationError("导入文件不能超过 100 MiB", 413, "import_too_large")
        return await asyncio.to_thread(parse_content, filename, bytes(content))
    finally:
        await upload.close()


def parse_content(filename, content):
    try:
        suffix = Path(filename).suffix.lower()
        if suffix == ".fplppt":
            return normalize_assets(read_package(content))
        if suffix == ".pptx":
            return normalize_assets(read_pptx(content, Path(filename).stem[:120] or "导入文稿"))
        if suffix == ".json":
            if len(content) > 8 * 1024 * 1024:
                raise PresentationError("JSON 文稿不能超过 8 MiB", 413, "import_too_large")
            project = PresentationProjectIn.model_validate(json.loads(content))
            return ParsedPresentation(project.title, project.document)
        raise PresentationError(
            "请选择 PPTX、JSON 或 .fplppt 文稿", 422, "unsupported_presentation"
        )
    except PresentationError:
        raise
    except Exception as exc:
        raise PresentationError(
            "文稿文件损坏或结构不受支持", 422, "invalid_presentation_file"
        ) from exc


def normalize_assets(parsed):
    for identity, file in list(parsed.assets.items()):
        if file.mime_type == "image/svg+xml":
            normalized = normalize_svg(file.content.decode())
            parsed.assets[identity] = type(file)(
                file.filename, file.mime_type, normalized["svg"].encode()
            )
    return parsed


def preview(parsed: ParsedPresentation) -> ImportPreview:
    previews = {
        identity: f"data:{file.mime_type};base64,{base64.b64encode(file.content).decode()}"
        for identity, file in parsed.assets.items()
        if file.mime_type in {"image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"}
    }
    return ImportPreview(
        title=parsed.title, document=parsed.document, issues=parsed.issues, preview_assets=previews
    )


def asset_ids(document):
    result = set()

    def visit(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if (
                    key in {"asset_id", "poster_asset_id", "image_asset_id", "background_asset_id"}
                    and item
                ):
                    result.add(item)
                else:
                    visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)

    visit(document)
    return result


async def import_presentation(
    projects: Presentations, parsed: ParsedPresentation, allow_lossy: bool
):
    if parsed.issues and not allow_lossy:
        raise PresentationError("请先预览并确认转换差异", 422, "conversion_confirmation_required")
    library = AssetLibrary(projects.session, get_settings())
    staged = []
    paths = []
    document = parsed.document.model_dump()
    if document.get("template"):
        document["template"]["template_id"] = None
    for slide in document["slides"]:
        if slide.get("layout_source"):
            slide["layout_source"]["template_id"] = None
    used = asset_ids(document)
    identities = {}
    await projects.session.rollback()
    try:
        with tempfile.TemporaryDirectory(prefix="fpl-presentation-import-") as directory:
            for identity, file in parsed.assets.items():
                if identity not in used:
                    continue
                source = Path(directory) / uuid4().hex
                await asyncio.to_thread(source.write_bytes, file.content)
                if file.mime_type == "image/svg+xml":
                    normalized = normalize_svg(file.content.decode())
                    await asyncio.to_thread(source.write_text, normalized["svg"])
                work = asyncio.create_task(
                    library.stage_local_copy(
                        source,
                        owner_user_id=projects.owner_user_id,
                        filename=file.filename,
                        content_type=file.mime_type,
                        max_bytes=MAX_BYTES,
                        defer_persistence=True,
                    )
                )
                try:
                    row, path = await asyncio.shield(work)
                except asyncio.CancelledError:
                    try:
                        _, cancelled_path = await work
                        cancelled_path.unlink(missing_ok=True)
                    finally:
                        raise
                staged.append(row)
                paths.append(path)
                row.id = new_id()
                identities[identity] = row.id

            def replace(value):
                if isinstance(value, dict):
                    return {
                        key: identities.get(item, item)
                        if key
                        in {"asset_id", "poster_asset_id", "image_asset_id", "background_asset_id"}
                        and item
                        else replace(item)
                        for key, item in value.items()
                    }
                if isinstance(value, list):
                    return [replace(item) for item in value]
                return value

            document = replace(document)
            pages = []
            page_ids = {slide["id"]: uuid4().hex for slide in document["slides"]}
            for slide in document["slides"]:
                identity = page_ids[slide["id"]]
                mapped = remap(slide, identity)
                mapped["id"] = identity
                for element in mapped["elements"]:
                    if element.get("link") and element["link"]["type"] == "slide":
                        element["link"]["target"] = page_ids[element["link"]["target"]]
                pages.append(mapped)
            document["slides"] = pages
            projects.session.add_all(staged)
            return await projects.create(
                PresentationProjectIn(title=parsed.title, document=document)
            )
    except BaseException:
        await projects.session.rollback()
        for path in paths:
            path.unlink(missing_ok=True)
        raise
