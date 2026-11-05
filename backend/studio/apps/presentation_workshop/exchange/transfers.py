"""account-aware presentation transfer use cases and private file staging."""

import asyncio
import base64
import hashlib
import json
from pathlib import Path
from uuid import uuid4

from app.capabilities.asset_store.svg import normalize_svg
from studio.apps.presentation_workshop.exchange.archives import MAX_BYTES, read_package
from studio.apps.presentation_workshop.exchange.contracts import ImportPreview, ParsedPresentation
from studio.apps.presentation_workshop.exchange.pptx_import import read_pptx
from studio.apps.presentation_workshop.projects import PresentationError, Presentations
from studio.apps.presentation_workshop.scene_edits import remap
from studio.apps.presentation_workshop.schemas.document import PresentationProjectIn
from studio.contracts.asset_library.incoming import IncomingFile


async def parse_upload(upload: IncomingFile) -> ParsedPresentation:
    try:
        filename = Path(upload.filename or "").name
        content = bytearray()
        while chunk := await upload.read(1024 * 1024):
            content.extend(chunk)
            if len(content) > MAX_BYTES:
                raise PresentationError("导入文件不能超过 100 MiB", 413, "import_too_large")
        parsed = await asyncio.to_thread(parse_content, filename, bytes(content))
        parsed.source_sha256 = hashlib.sha256(content).hexdigest()
        return parsed
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


def import_document(parsed):
    document = parsed.document.model_dump()
    if document.get("template"):
        document["template"]["template_id"] = None
    for slide in document["slides"]:
        if slide.get("layout_source"):
            slide["layout_source"]["template_id"] = None
    return document


def remap_document(document, identities):
    def replace(value):
        if isinstance(value, dict):
            return {
                key: identities.get(item, item)
                if key in {"asset_id", "poster_asset_id", "image_asset_id", "background_asset_id"}
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
    return document


async def import_presentation(
    projects: Presentations, parsed: ParsedPresentation, allow_lossy: bool
):
    if parsed.issues and not allow_lossy:
        raise PresentationError("请先预览并确认转换差异", 422, "conversion_confirmation_required")
    document = import_document(parsed)
    used = asset_ids(document)
    files = {identity: file for identity, file in parsed.assets.items() if identity in used}
    run = projects.session.info["presentation_import"]
    return await run(projects, parsed.title, document, files, parsed.source_sha256)
