"""All managed references, including decorations and non-rendered archives."""

from studio.apps.presentation_workshop.project_errors import PresentationError
from studio.apps.presentation_workshop.templates.resolver import resolve_document
from studio.apps.presentation_workshop.templates.schema import effective_template


def document_references(document):
    references = {}

    def add(identity, kind):
        if identity:
            references.setdefault(identity, set()).add(kind)

    if document.template:
        for definition in (
            document.template.snapshot,
            effective_template(document.template, document.template_overrides),
        ):
            for layout in definition.layouts.values():
                add(layout.background_asset_id, "image")
            for item in definition.fixed:
                add(item.asset_id, "image")
            scenes = [
                definition.global_scene,
                *[
                    scene
                    for layout in definition.layouts.values()
                    for scene in (layout.scene, layout.defaults)
                ],
            ]
            for scene in scenes:
                for element in scene.elements:
                    add(
                        element.asset_id,
                        element.kind if element.kind in {"audio", "video"} else "image",
                    )
                    add(element.media.poster_asset_id if element.media else None, "image")
                    add(element.paint.asset_id if element.paint else None, "image")
    for slide in document.slides:
        add(slide.reference.asset_id if slide.reference else None, "image")
        add(slide.image_asset_id, "image")
        add(slide.background_style.asset_id if slide.background_style else None, "image")
        for element in slide.elements:
            add(element.asset_id, element.kind if element.kind in {"audio", "video"} else "image")
            add(element.media.poster_asset_id if element.media else None, "image")
            add(element.paint.asset_id if element.paint else None, "image")
    return references


def rendered_asset_ids(document):
    """Static output needs visible content, while storage protects every reference."""

    document, _ = resolve_document(document)
    result = set()
    for slide in document.slides:
        if slide.background_style and slide.background_style.asset_id:
            result.add(slide.background_style.asset_id)
        for element in slide.elements:
            if element.hidden:
                continue
            result.update(
                identity
                for identity in (
                    element.asset_id,
                    element.media.poster_asset_id if element.media else None,
                    element.paint.asset_id if element.paint else None,
                )
                if identity
            )
    return result


async def validate_assets(document, rows, *, monochrome):
    references = document_references(document)
    by_id = {row.id: row for row in rows}
    if set(by_id) != set(references):
        raise PresentationError("图片不存在或不属于当前账号的公共文件库", 404, "not_found")
    if any(references[row.id] != {row.media_kind} for row in rows):
        raise PresentationError("素材类型与引用用途不匹配", 422, "invalid_asset_type")
    for slide in document.slides:
        for element in slide.elements:
            if not element.asset_id:
                continue
            row = by_id[element.asset_id]
            expected_kind = element.kind if element.kind in {"audio", "video"} else "image"
            if row.media_kind != expected_kind or (
                expected_kind == "image"
                and (element.kind in {"vector", "formula"}) != (row.mime_type == "image/svg+xml")
            ):
                raise PresentationError("素材类型与图片／矢量元素不匹配", 422, "invalid_asset_type")
            if element.vector_color and not await monochrome(row):
                raise PresentationError("多色 SVG 不支持统一改色", 422, "invalid_vector_color")
    return rows
