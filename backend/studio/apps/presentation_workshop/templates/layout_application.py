"""Explicit geometry transfer. No content matching heuristics or body replacement."""

from studio.apps.presentation_workshop.projects import PresentationError
from studio.apps.presentation_workshop.templates.scenes import PresentationLayoutSource


def apply_layouts(document, target, mappings, apply_text_style):
    if target.definition.version < 2 or not mappings:
        raise PresentationError("请选择 v2 模板、目标页面及明确的对象映射")
    if len({m.slide_id for m in mappings}) != len(mappings):
        raise PresentationError("目标页面不能重复")
    pages = {s.id: s for s in document.slides}
    issues = []
    for mapping in mappings:
        slide = pages.get(mapping.slide_id)
        if not slide:
            raise PresentationError("指定页面不存在")
        source = {e.id: e for e in slide.elements}
        defaults = {e.id: e for e in target.definition.layouts[mapping.page_type].defaults.elements}
        links = PresentationLayoutSource(
            template_id=target.id,
            template_revision=target.revision,
            page_type=mapping.page_type,
            objects=mapping.objects,
        )
        for link in links.objects:
            if link.element_id not in source or link.default_id not in defaults:
                raise PresentationError("版式映射引用了不存在的正文或默认对象")
            e, prototype = source[link.element_id], defaults[link.default_id]
            if e.kind != prototype.kind:
                raise PresentationError("映射对象类型不同，请明确选择同类型对象")
            before = [e.x, e.y, e.width, e.height, e.rotation]
            for key in ("x", "y", "width", "height", "rotation", "flip_x", "flip_y"):
                setattr(e, key, getattr(prototype, key))
            if apply_text_style and e.paragraphs and prototype.paragraphs:
                style = prototype.paragraphs[0]
                if style.runs:
                    run = style.runs[0]
                    for paragraph in e.paragraphs:
                        paragraph.align, paragraph.line_height = style.align, style.line_height
                        for actual in paragraph.runs:
                            for key in ("font", "size", "color", "bold", "italic", "underline"):
                                setattr(actual, key, getattr(run, key))
            if before != [e.x, e.y, e.width, e.height, e.rotation]:
                issues.append(
                    {
                        "slide_id": slide.id,
                        "code": "object_moved",
                        "element_id": e.id,
                        "message": f"移动对象：{e.name or e.id}",
                        "before": before,
                        "after": [e.x, e.y, e.width, e.height, e.rotation],
                    }
                )
        slide.layout_source, slide.page_type = links, mapping.page_type
        mapped = {o.element_id for o in links.objects}
        unused = set(defaults) - {o.default_id for o in links.objects}
        if set(source) - mapped or unused:
            issues.append(
                {
                    "slide_id": slide.id,
                    "code": "unmatched_content",
                    "message": "未映射正文保持原样；未匹配默认内容不会插入",
                    "element_ids": sorted(set(source) - mapped),
                    "default_ids": sorted(unused),
                }
            )
        for e in slide.elements:
            if e.id in mapped and (
                e.x < 0
                or e.y < 0
                or e.x + e.width > document.width
                or e.y + e.height > document.height
            ):
                issues.append(
                    {
                        "slide_id": slide.id,
                        "code": "layout_overflow",
                        "element_id": e.id,
                        "message": "对象超出页面",
                    }
                )
            if e.id not in mapped or e.hidden:
                continue
            for other in slide.elements:
                if other.id == e.id or other.hidden or (other.id in mapped and other.id < e.id):
                    continue
                overlap = min(e.x + e.width, other.x + other.width) > max(e.x, other.x) and min(
                    e.y + e.height, other.y + other.height
                ) > max(e.y, other.y)
                if overlap:
                    issues.append(
                        {
                            "slide_id": slide.id,
                            "code": "layout_overlap",
                            "element_ids": [e.id, other.id],
                            "message": "对象边界重叠，请检查是否为预期叠放",
                        }
                    )
    document.version = 5
    return issues
