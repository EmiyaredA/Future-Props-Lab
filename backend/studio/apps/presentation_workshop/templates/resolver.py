"""Pure master expansion used by every server-side presentation renderer."""

from studio.apps.presentation_workshop.schemas.document import (
    PresentationDocument,
    PresentationElement,
)
from studio.apps.presentation_workshop.templates.native_scene import expand_page
from studio.apps.presentation_workshop.templates.schema import (
    TemplateOverrides,
    TemplateTextStyle,
    effective_template,
)


def resolved_style(style, definition, snapshot):
    return style.model_copy(
        update={
            "font": definition.font if style.font == snapshot.font else style.font,
            "color": definition.foreground
            if style.color == snapshot.foreground
            else definition.accent
            if style.color == snapshot.accent
            else style.color,
        }
    )


def element(identity, kind, box, text="", style=None, asset_id=None, fill="#FFFFFF", opacity=1):
    style = style or TemplateTextStyle()
    return PresentationElement.model_validate(
        {
            "id": identity,
            "name": "模板 · " + identity.rsplit("-", 1)[-1],
            "kind": kind,
            "x": box.x,
            "y": box.y,
            "width": box.width,
            "height": box.height,
            "rotation": 0,
            "locked": True,
            "fill": fill,
            "fill_opacity": 1 if kind == "rect" else 0,
            "stroke": fill,
            "stroke_width": 0,
            "opacity": opacity,
            "paragraphs": [
                {
                    "runs": [
                        {
                            "text": text,
                            "font": style.font,
                            "size": style.size,
                            "color": style.color,
                            "bold": style.bold,
                            "italic": False,
                            "underline": False,
                        }
                    ],
                    "align": style.align,
                    "line_height": 1.2,
                    "bullet": False,
                }
            ]
            if kind == "text"
            else [],
            "asset_id": asset_id,
            "crop": {"left": 0, "right": 0, "top": 0, "bottom": 0},
        }
    )


def chapter_entries(document):
    names = {c.id: c.title for c in document.chapters}
    seen, entries = set(), []
    start = (
        effective_template(document.template, document.template_overrides).number_start
        if document.template
        else 1
    )
    for index, slide in enumerate(document.slides):
        if slide.chapter_id and slide.chapter_id not in seen:
            seen.add(slide.chapter_id)
            entries.append(
                {"id": slide.chapter_id, "title": names[slide.chapter_id], "page": start + index}
            )
    return entries


def resolve_document(document: PresentationDocument):
    """Return expanded copy and diagnostics; never mutate saved body or template."""
    if not document.template:
        return document.model_copy(deep=True), []
    definition = effective_template(document.template, document.template_overrides)
    chapters = {c.id: c.title for c in document.chapters}
    entries = chapter_entries(document)
    pages, issues = [], []
    for index, source in enumerate(document.slides):
        if definition.version == 2:
            slide = expand_page(document, source, index, definition, entries, chapters)
            pages.append(slide)
            layout = definition.layouts[source.page_type]
            titles = [
                e
                for e in slide.elements
                if e.id.startswith(f"master-{index}-page-title-") and not e.hidden
            ]
            if any(
                not e.hidden
                and any(
                    e.x < t.x + t.width
                    and e.x + e.width > t.x
                    and e.y < t.y + t.height
                    and e.y + e.height > t.y
                    for t in titles
                )
                for e in source.elements
            ):
                issues.append(
                    {
                        "slide_id": source.id,
                        "code": "body_overlap",
                        "message": "正文与模板标题区域可能重叠；正文位置未自动调整",
                    }
                )
            if (
                source.page_type == "toc"
                and any(
                    e.id.startswith(f"master-{index}-page-toc-") and not e.hidden
                    for e in slide.elements
                )
                and len(entries) > source.toc_offset + layout.toc_capacity
                and not any(
                    s.page_type == "toc" and s.toc_offset == source.toc_offset + layout.toc_capacity
                    for s in document.slides
                )
            ):
                issues.append(
                    {
                        "slide_id": source.id,
                        "code": "toc_overflow",
                        "message": "目录未完全展示，请添加目录续页",
                        "next_offset": source.toc_offset + layout.toc_capacity,
                    }
                )
            continue
        slide = source.model_copy(deep=True)
        layout = definition.layouts[slide.page_type]
        hidden = set(slide.template_hidden)
        # Hash avoids length overflow and collisions with canonical page/object IDs.
        prefix = "master-" + str(index)
        behind, front = [], []

        def text_slot(role, text, slot, hidden=hidden, front=front, prefix=prefix):
            if text and slot.visible and role not in hidden:
                style = resolved_style(slot.style, definition, document.template.snapshot)
                front.append(element(prefix + "-" + role, "text", slot, text, style))

        slide.background = layout.background
        slide.background_style = None
        if layout.background_asset_id and "background" not in hidden:
            from types import SimpleNamespace

            behind.append(
                element(
                    prefix + "-background",
                    "image",
                    SimpleNamespace(x=0, y=0, width=document.width, height=document.height),
                    asset_id=layout.background_asset_id,
                )
            )
        text_slot("chapter", chapters.get(slide.chapter_id, ""), layout.chapter)
        text_slot("title", slide.title, layout.title)
        if slide.page_type not in definition.number_hidden_types:
            number = str(definition.number_start + index)
            if definition.number_total:
                number += " / " + str(len(document.slides))
            text_slot("number", number, layout.number)
        if slide.page_type == "toc" and "toc" not in hidden and layout.toc.visible:
            remaining = entries[slide.toc_offset :]
            continuation = any(
                s.page_type == "toc" and s.toc_offset == slide.toc_offset + layout.toc_capacity
                for s in document.slides
            )
            if len(remaining) > layout.toc_capacity and not continuation:
                issues.append(
                    {
                        "slide_id": slide.id,
                        "code": "toc_overflow",
                        "message": "目录未完全展示，请添加目录续页",
                        "next_offset": slide.toc_offset + layout.toc_capacity,
                    }
                )
            for row, entry in enumerate(remaining[: layout.toc_capacity]):
                box = layout.toc.model_copy(
                    update={
                        "y": layout.toc.y + row * layout.toc.height / layout.toc_capacity,
                        "height": layout.toc.height / layout.toc_capacity,
                    }
                )
                text_slot("toc-" + str(row), entry["title"] + "    " + str(entry["page"]), box)
        for item in definition.fixed:
            if slide.page_type in item.page_types and item.id not in hidden:
                (behind if item.layer == "behind" else front).append(
                    element(
                        prefix + "-fixed-" + str(definition.fixed.index(item)),
                        item.kind,
                        item,
                        item.text,
                        resolved_style(item.style, definition, document.template.snapshot),
                        item.asset_id,
                        item.fill,
                        item.opacity,
                    )
                )
        if any(
            not e.hidden and e.y < layout.body_top and e.y + e.height > layout.title.y
            for e in source.elements
        ):
            issues.append(
                {
                    "slide_id": slide.id,
                    "code": "body_overlap",
                    "message": "正文与模板标题区域可能重叠；正文位置未自动调整",
                }
            )
        slide.connections = [
            edge.model_copy(update={"layer": edge.layer + len(behind)})
            for edge in slide.connections
        ]
        slide.elements = behind + slide.elements + front
        pages.append(slide)
    # Rendering-only model copy: canonical v4 metadata stays in the saved source.
    return document.model_copy(update={"slides": pages, "template": None}), issues


def materialize(document):
    expanded, _ = resolve_document(document)
    for slide in expanded.slides:
        ids = {
            item.id: "native-" + item.id
            for collection in (slide.elements, slide.groups, slide.connections, slide.infographics)
            for item in collection
            if item.id.startswith("master-")
        }
        for item in slide.elements:
            if item.id.startswith("master-"):
                item.locked = False
                item.id = "native-" + item.id
        for group in slide.groups:
            group.id = ids.get(group.id, group.id)
            group.parent_id = ids.get(group.parent_id, group.parent_id)
            group.element_ids = [ids.get(i, i) for i in group.element_ids]
        for edge in slide.connections:
            edge.id = ids.get(edge.id, edge.id)
            edge.source_id = ids.get(edge.source_id, edge.source_id)
            edge.target_id = ids.get(edge.target_id, edge.target_id)
        for info in slide.infographics:
            info.id = ids.get(info.id, info.id)
            info.group_id = ids.get(info.group_id, info.group_id)
        slide.layout_source = None
    expanded.template = None

    expanded.template_overrides = TemplateOverrides()
    return PresentationDocument.model_validate(expanded.model_dump())
