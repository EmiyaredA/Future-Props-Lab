"""All managed references, including decorations and non-rendered archives."""


def document_references(document):
    references = {}

    def add(identity, kind):
        if identity:
            references.setdefault(identity, set()).add(kind)

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
