"""Convert supported PresentationML objects into the native document contract."""

import io
import json
import mimetypes
from uuid import uuid4

from defusedxml.ElementTree import fromstring
from pptx import Presentation
from pptx.enum.chart import XL_CHART_TYPE
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.enum.text import PP_ALIGN
from pptx.oxml.ns import qn

from studio.apps.presentation_workshop.exchange.archives import checked_archive
from studio.apps.presentation_workshop.exchange.contracts import (
    ConversionIssue,
    ImportedFile,
    ParsedPresentation,
)
from studio.apps.presentation_workshop.exchange.pptx_appearance import (
    paint,
    report_appearance,
    text_layout,
    text_marks,
)
from studio.apps.presentation_workshop.pptx_export import SHAPES
from studio.apps.presentation_workshop.schemas.document import (
    PresentationDocument,
    PresentationElement,
)


def color(value, fallback):
    try:
        return "#" + str(value.rgb) if value.rgb is not None else fallback
    except (AttributeError, TypeError):
        return fallback


def fill(value, fallback="#FFFFFF"):
    try:
        return color(value.fore_color, fallback)
    except (AttributeError, TypeError):
        return fallback


def native_element(kind, **values):
    return PresentationElement.model_validate(
        {
            "id": uuid4().hex,
            "kind": kind,
            "x": 0,
            "y": 0,
            "width": 100,
            "height": 100,
            "rotation": 0,
            "locked": False,
            "fill": "#5474E5",
            "stroke": "#17334A",
            "stroke_width": 0,
            "paragraphs": [],
            "asset_id": None,
            "crop": {"left": 0, "right": 0, "top": 0, "bottom": 0},
            **values,
        }
    ).model_dump()


def paragraphs(frame):
    result = []
    for paragraph in frame.paragraphs:
        runs = []
        for run in paragraph.runs:
            font = run.font
            runs.append(
                {
                    "text": run.text,
                    **text_marks(run),
                    "font": font.name
                    if font.name in {"Arial", "Consolas", "Microsoft YaHei"}
                    else "Microsoft YaHei",
                    "size": min(
                        240, max(6, float(font.size or paragraph.font.size or 24 * 12700) / 9525)
                    ),
                    "color": color(font.color, "#17334A"),
                    "bold": bool(font.bold),
                    "italic": bool(font.italic),
                    "underline": bool(font.underline),
                }
            )
        if not runs:
            runs = [
                {
                    "text": paragraph.text,
                    "font": "Microsoft YaHei",
                    "size": 28,
                    "color": "#17334A",
                    "bold": False,
                    "italic": False,
                    "underline": False,
                }
            ]
        properties = paragraph._p.pPr
        numbered = properties is not None and bool(properties.xpath("./a:buAutoNum"))
        bullet = properties is not None and bool(properties.xpath("./a:buChar"))
        result.append(
            {
                "runs": runs,
                "align": {PP_ALIGN.CENTER: "center", PP_ALIGN.RIGHT: "right"}.get(
                    paragraph.alignment, "left"
                ),
                "line_height": 1.3,
                "bullet": bullet and not numbered,
                "numbered": numbered,
            }
        )
    return result or [
        {"runs": [], "align": "left", "line_height": 1.3, "bullet": False, "numbered": False}
    ]


def table_data(table):
    rows = []
    for row in table.rows:
        cells = []
        for cell in row.cells:
            paragraph = cell.text_frame.paragraphs[0]
            font = paragraph.runs[0].font if paragraph.runs else paragraph.font
            cells.append(
                {
                    "text": cell.text,
                    "fill": fill(cell.fill),
                    "color": color(font.color, "#17334A"),
                    "bold": bool(font.bold),
                    "italic": bool(font.italic),
                    "underline": bool(font.underline),
                    "align": {PP_ALIGN.CENTER: "center", PP_ALIGN.RIGHT: "right"}.get(
                        paragraph.alignment, "left"
                    ),
                    "row_span": cell.span_height if cell.is_merge_origin else 1,
                    "col_span": cell.span_width if cell.is_merge_origin else 1,
                    "covered": cell.is_spanned,
                }
            )
        rows.append(cells)
    return {"rows": rows, "column_widths": [float(c.width) / 9525 for c in table.columns]}


def chart_data(chart):
    mapping = {
        XL_CHART_TYPE.COLUMN_CLUSTERED: "column",
        XL_CHART_TYPE.COLUMN_STACKED: "column",
        XL_CHART_TYPE.BAR_CLUSTERED: "bar",
        XL_CHART_TYPE.BAR_STACKED: "bar",
        XL_CHART_TYPE.LINE: "line",
        XL_CHART_TYPE.LINE_STACKED: "line",
        XL_CHART_TYPE.AREA: "area",
        XL_CHART_TYPE.AREA_STACKED: "area",
        XL_CHART_TYPE.PIE: "pie",
        XL_CHART_TYPE.DOUGHNUT: "ring",
        XL_CHART_TYPE.RADAR: "radar",
        XL_CHART_TYPE.XY_SCATTER: "scatter",
    }
    kind = mapping[chart.chart_type]
    categories = (
        [str(c.label) for c in chart.plots[0].categories]
        if kind != "scatter"
        else [n.text for n in chart.series[0]._element.xpath("./c:xVal//c:pt/c:v")]
    )
    return {
        "type": kind,
        "categories": categories,
        "series": [{"name": s.name, "values": list(s.values)} for s in chart.series],
        "stacked": chart.chart_type
        in {
            XL_CHART_TYPE.COLUMN_STACKED,
            XL_CHART_TYPE.BAR_STACKED,
            XL_CHART_TYPE.LINE_STACKED,
            XL_CHART_TYPE.AREA_STACKED,
        },
    }


def native_path(shape):
    paths = shape._element.xpath("./p:spPr/a:custGeom/a:pathLst/a:path")
    if len(paths) != 1:
        raise ValueError("复合自由路径需要单独转换")
    path = paths[0]
    width, height = float(path.get("w") or shape.width), float(path.get("h") or shape.height)
    points = []
    closed = False
    smooth = False
    for command in path:
        name = command.tag.split("}")[-1]
        values = command.xpath("./a:pt")
        if name in {"moveTo", "lnTo"}:
            points.extend(
                {"x": float(p.get("x")) / width, "y": float(p.get("y")) / height} for p in values
            )
        elif name == "quadBezTo":
            smooth = True
            points.append(
                {"x": float(values[0].get("x")) / width, "y": float(values[0].get("y")) / height}
            )
        elif name == "close":
            closed = True
        else:
            raise ValueError("此自由路径包含暂不支持的曲线命令")
    return {"points": points, "closed": closed, "smooth": smooth}


def import_media(shape, assets):
    reference = shape._element.xpath(".//a:audioFile|.//a:videoFile")[0]
    part = shape.part.related_part(reference.get(qn("r:link")))
    identity = uuid4().hex
    suffix = mimetypes.guess_extension(part.content_type) or ".mp4"
    assets[identity] = ImportedFile(identity + suffix, part.content_type, part.blob)
    poster_id = None
    poster_ref = shape._element.blip_rId
    if poster_ref:
        poster = shape.part.get_image(poster_ref)
        poster_id = uuid4().hex
        assets[poster_id] = ImportedFile(
            poster_id + "." + poster.ext, poster.content_type, poster.blob
        )
    return (
        ("audio" if reference.tag == qn("a:audioFile") else "video"),
        identity,
        {"poster_asset_id": poster_id},
    )


def read_pptx(content: bytes, title: str) -> ParsedPresentation:
    with checked_archive(content) as archive:
        for name in archive.namelist():
            if name.endswith(".xml") or name.endswith(".rels"):
                fromstring(
                    archive.read(name), forbid_dtd=True, forbid_entities=True, forbid_external=True
                )
    deck = Presentation(io.BytesIO(content))
    slides = []
    assets = {}
    issues = []
    names = {value: key for key, value in SHAPES.items()}
    page_ids = {str(page.part.partname): uuid4().hex for page in deck.slides}
    for page in deck.slides:
        slide = {
            "id": page_ids[str(page.part.partname)],
            "background": fill(page.background.fill),
            "notes": page.notes_slide.notes_text_frame.text if page.has_notes_slide else "",
            "elements": [],
            "groups": [],
            "connections": [],
            "infographics": [],
        }

        def issue(code, message, identity=None, slide=slide):
            issues.append(
                ConversionIssue(
                    slide_id=slide["id"], element_id=identity, code=code, message=message
                )
            )

        def walk(shapes, ox=0, oy=0, sx=1, sy=1, parent=None, slide=slide):
            direct = []
            for shape in shapes:
                x, y = ox + float(shape.left) / 9525 * sx, oy + float(shape.top) / 9525 * sy
                width, height = (
                    max(1, float(shape.width) / 9525 * sx),
                    max(1, float(shape.height) / 9525 * sy),
                )
                if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
                    identity = uuid4().hex
                    transform = shape._element.grpSpPr.xfrm
                    cx, cy = (
                        float(transform.chExt.cx or shape.width),
                        float(transform.chExt.cy or shape.height),
                    )
                    gx, gy = sx * float(shape.width) / cx, sy * float(shape.height) / cy
                    group = {
                        "id": identity,
                        "name": shape.name,
                        "parent_id": parent,
                        "element_ids": [],
                    }
                    slide["groups"].append(group)
                    group["element_ids"] = walk(
                        shape.shapes,
                        x - float(transform.chOff.x) / 9525 * gx,
                        y - float(transform.chOff.y) / 9525 * gy,
                        gx,
                        gy,
                        identity,
                    )
                    if shape.rotation or transform.get("flipH") or transform.get("flipV"):
                        issue(
                            "group_rotation",
                            "旋转或翻转分组已按基础位置转换，请对照源文件检查",
                            identity,
                        )
                    continue
                values = {
                    "x": x,
                    "y": y,
                    "width": width,
                    "height": height,
                    "rotation": shape.rotation,
                    "flip_x": bool(shape._element.xpath('./p:spPr/a:xfrm[@flipH="1"]')),
                    "flip_y": bool(shape._element.xpath('./p:spPr/a:xfrm[@flipV="1"]')),
                    "name": shape.name[:120],
                }
                extra_text = None
                try:
                    report_appearance(shape, issue)
                    if shape._element.xpath(".//a:audioFile|.//a:videoFile"):
                        kind, asset_id, media = import_media(shape, assets)
                        item = native_element(kind, asset_id=asset_id, media=media, **values)
                    elif shape.has_table:
                        item = native_element("table", table=table_data(shape.table), **values)
                    elif shape.has_chart:
                        item = native_element("chart", chart=chart_data(shape.chart), **values)
                    elif shape.shape_type == MSO_SHAPE_TYPE.FREEFORM:
                        item = native_element(
                            "path",
                            path=native_path(shape),
                            fill=fill(shape.fill, "#5474E5"),
                            stroke=color(shape.line.color, "#17334A"),
                            stroke_width=float(shape.line.width or 0) / 9525,
                            **values,
                        )
                    elif shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                        image = shape.image
                        identity = uuid4().hex
                        svg = next(
                            (
                                node
                                for node in shape._element.iter()
                                if node.tag.endswith("}svgBlip")
                            ),
                            None,
                        )
                        kind = "image"
                        formula = None
                        if svg is not None:
                            part = shape.part.related_part(svg.get(qn("r:embed")))
                            assets[identity] = ImportedFile(
                                identity + ".svg", "image/svg+xml", part.blob
                            )
                            kind = "vector"
                            properties = shape._element.find(".//" + qn("p:cNvPr"))
                            description = (
                                properties.get("descr", "") if properties is not None else ""
                            )
                            if description.startswith("FPL:formula:"):
                                formula = json.loads(description.removeprefix("FPL:formula:"))
                                kind = "formula"
                        else:
                            assets[identity] = ImportedFile(
                                f"{identity}.{image.ext}", image.content_type, image.blob
                            )
                        item = native_element(
                            kind,
                            formula=formula,
                            asset_id=identity,
                            crop={
                                "left": shape.crop_left,
                                "right": shape.crop_right,
                                "top": shape.crop_top,
                                "bottom": shape.crop_bottom,
                            },
                            **values,
                        )
                    elif shape.has_text_frame and (
                        shape.shape_type in {MSO_SHAPE_TYPE.TEXT_BOX, MSO_SHAPE_TYPE.PLACEHOLDER}
                        or not shape.auto_shape_type
                    ):
                        item = native_element(
                            "text",
                            paragraphs=paragraphs(shape.text_frame),
                            text_layout=text_layout(shape.text_frame),
                            **values,
                        )
                    elif shape.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE:
                        kind = names.get(shape.auto_shape_type, "rect")
                        if shape.auto_shape_type not in names:
                            issue("shape_substituted", f"{shape.name} 使用矩形近似，请检查外观")
                        item = native_element(
                            kind,
                            fill=fill(shape.fill, "#5474E5"),
                            stroke=color(shape.line.color, "#17334A"),
                            stroke_width=float(shape.line.width or 0) / 9525,
                            **values,
                        )
                        if shape.has_text_frame and shape.text:
                            text = native_element(
                                "text", paragraphs=paragraphs(shape.text_frame), **values
                            )
                            item["paragraphs"] = text["paragraphs"]
                            item["text_layout"] = text_layout(shape.text_frame)
                    elif shape.shape_type == MSO_SHAPE_TYPE.LINE:
                        item = native_element(
                            "line",
                            stroke=color(shape.line.color, "#17334A"),
                            stroke_width=max(1, float(shape.line.width or 9525) / 9525),
                            **values,
                        )
                    else:
                        issue("unsupported_object", f"{shape.name} 的对象类型不受支持，未导入")
                        continue
                    if item["kind"] not in {
                        "image",
                        "vector",
                        "formula",
                        "audio",
                        "video",
                        "table",
                        "chart",
                    }:
                        item["paint"] = paint(
                            shape._element.find(qn("p:spPr")), shape.part, assets, issue
                        )
                    links = shape._element.xpath(".//a:hlinkClick")
                    if links:
                        link_id = links[0].get(qn("r:id"))
                        relation = shape.part.rels.get(link_id) if link_id else None
                        if relation:
                            if relation.is_external and relation.target_ref.startswith(
                                ("https://", "http://")
                            ):
                                item["link"] = {"type": "web", "target": relation.target_ref}
                            elif (
                                not relation.is_external
                                and str(relation.target_part.partname) in page_ids
                            ):
                                item["link"] = {
                                    "type": "slide",
                                    "target": page_ids[str(relation.target_part.partname)],
                                }
                            else:
                                issue(
                                    "unsupported_link",
                                    "部分超链接类型不受支持，链接未导入",
                                    item["id"],
                                )
                    slide["elements"].append(item)
                    direct.append(item["id"])
                    if extra_text:
                        slide["elements"].append(extra_text)
                        direct.append(extra_text["id"])
                except (ValueError, KeyError, AttributeError, TypeError) as exc:
                    issue("object_conversion", f"{shape.name} 无法完整转换：{str(exc)[:160]}")
            return direct

        background = page._element.xpath("./p:cSld/p:bg/p:bgPr")
        if background:
            slide["background_style"] = paint(background[0], page.part, assets, issue)
        if any(
            not s.is_placeholder
            for s in (*page.slide_layout.shapes, *page.slide_layout.slide_master.shapes)
        ):
            issue("master_content", "版式与母版上的固定装饰未自动创建为页面对象，请对照源文件检查")
        walk(page.shapes)
        if page._element.xpath("./p:timing|./p:transition"):
            issue("animation_not_imported", "原文件动画与切换未导入，可在工坊中重新设置")
        slides.append(slide)
    document = PresentationDocument.model_validate(
        {
            "version": 3,
            "width": round(deck.slide_width / 9525),
            "height": round(deck.slide_height / 9525),
            "slides": slides,
        }
    )
    return ParsedPresentation(title, document, assets, issues)
