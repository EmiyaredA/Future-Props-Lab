"""Native PowerPoint objects; all DrawingML details stay at this boundary."""

from pathlib import Path
from types import SimpleNamespace

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_AUTO_SHAPE_TYPE, MSO_CONNECTOR
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from pptx.oxml.ns import qn
from pptx.oxml.xmlchemy import OxmlElement
from pptx.util import Emu, Pt

from app.apps.presentation_workshop.image_crop import pptx_crop
from app.apps.presentation_workshop.native_shapes import freeform, points_for
from app.apps.presentation_workshop.pptx_appearance import apply_paint, apply_shadow, picture_source
from app.apps.presentation_workshop.pptx_media import picture_style, vector_picture
from app.apps.presentation_workshop.pptx_objects import chart_shape, table_shape
from app.apps.presentation_workshop.pptx_paths import path_shape
from app.apps.presentation_workshop.pptx_playback import media_shape
from app.apps.presentation_workshop.pptx_scene import add_scene
from app.apps.presentation_workshop.pptx_styles import apply_shape_style
from app.apps.presentation_workshop.schemas.document import (
    PresentationDocument,
    PresentationElement,
)
from app.apps.presentation_workshop.templates.resolver import resolve_document
from app.apps.presentation_workshop.visible_scene import visible_scene

SHAPES = {
    "rect": MSO_AUTO_SHAPE_TYPE.RECTANGLE,
    "roundRect": MSO_AUTO_SHAPE_TYPE.ROUNDED_RECTANGLE,
    "ellipse": MSO_AUTO_SHAPE_TYPE.OVAL,
    "triangle": MSO_AUTO_SHAPE_TYPE.ISOSCELES_TRIANGLE,
    "diamond": MSO_AUTO_SHAPE_TYPE.DIAMOND,
    "arrow": MSO_AUTO_SHAPE_TYPE.RIGHT_ARROW,
    "rightTriangle": MSO_AUTO_SHAPE_TYPE.RIGHT_TRIANGLE,
    "pentagon": MSO_AUTO_SHAPE_TYPE.REGULAR_PENTAGON,
    "hexagon": MSO_AUTO_SHAPE_TYPE.HEXAGON,
    "star": MSO_AUTO_SHAPE_TYPE.STAR_5_POINT,
    "parallelogram": MSO_AUTO_SHAPE_TYPE.PARALLELOGRAM,
    "trapezoid": MSO_AUTO_SHAPE_TYPE.TRAPEZOID,
    "leftArrow": MSO_AUTO_SHAPE_TYPE.LEFT_ARROW,
    "upArrow": MSO_AUTO_SHAPE_TYPE.UP_ARROW,
    "downArrow": MSO_AUTO_SHAPE_TYPE.DOWN_ARROW,
    "doubleArrow": MSO_AUTO_SHAPE_TYPE.LEFT_RIGHT_ARROW,
    "callout": MSO_AUTO_SHAPE_TYPE.RECTANGULAR_CALLOUT,
    "roundCallout": MSO_AUTO_SHAPE_TYPE.ROUNDED_RECTANGULAR_CALLOUT,
    "ellipseCallout": MSO_AUTO_SHAPE_TYPE.OVAL_CALLOUT,
}


def px(value: float):
    return Emu(round(value * 9525))


def color(value: str):
    return RGBColor.from_string(value[1:])


def add_text(shape, element: PresentationElement):
    frame = shape.text_frame
    frame.clear()
    frame.word_wrap = True
    frame.auto_size = MSO_AUTO_SIZE.NONE
    frame.margin_left = frame.margin_right = px(8)
    frame.margin_top = frame.margin_bottom = px(8)
    layout = element.text_layout
    if layout:
        frame.margin_left = frame.margin_right = frame.margin_top = frame.margin_bottom = px(
            layout.padding
        )
        frame.vertical_anchor = {
            "top": MSO_ANCHOR.TOP,
            "middle": MSO_ANCHOR.MIDDLE,
            "bottom": MSO_ANCHOR.BOTTOM,
        }[layout.align]
        frame._txBody.bodyPr.set("vert", "vert" if layout.vertical else "horz")
    number = 0
    for index, paragraph in enumerate(element.paragraphs):
        number = number + 1 if paragraph.numbered else 0
        p = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        p.alignment = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER, "right": PP_ALIGN.RIGHT}[
            paragraph.align
        ]
        p.space_before = Pt(paragraph.space_before * 0.75)
        p.space_after = Pt(paragraph.space_after * 0.75)
        p.line_spacing = Pt(
            max((r.size for r in paragraph.runs), default=24) * paragraph.line_height * 0.75
        )
        properties = p._p.get_or_add_pPr()
        bullet = OxmlElement(
            "a:buAutoNum" if paragraph.numbered else "a:buChar" if paragraph.bullet else "a:buNone"
        )
        if paragraph.numbered:
            bullet.set("type", "arabicPeriod")
            # Restart only at the beginning of a run, preserving native renumbering.
            if number == 1:
                bullet.set("startAt", "1")
        elif paragraph.bullet:
            bullet.set("char", "•")
        if paragraph.bullet or paragraph.numbered:
            indent = (
                max((r.size for r in paragraph.runs), default=24) * 2 if paragraph.numbered else 24
            )
            properties.set("marL", str(px(indent)))
            properties.set("indent", str(px(6 - indent)))
        properties.append(bullet)
        if paragraph.indent and not (paragraph.bullet or paragraph.numbered):
            properties.set(
                "marL",
                str(px(paragraph.indent * 2 * max((r.size for r in paragraph.runs), default=24))),
            )
        if paragraph.first_line_indent:
            properties.set("indent", str(px(paragraph.first_line_indent)))
        for item in paragraph.runs:
            for part_index, text in enumerate(item.text.split("\n")):
                if part_index:
                    p.add_line_break()
                run = p.add_run()
                run.text = text
                run.font.name = "Consolas" if item.code else item.font
                run.font.size = Pt(item.size * 0.75)
                run.font.bold, run.font.italic, run.font.underline = (
                    item.bold,
                    item.italic,
                    item.underline,
                )
                run.font.color.rgb = color(item.color)
                attributes = run._r.get_or_add_rPr()
                if item.strike:
                    attributes.set("strike", "sngStrike")
                if item.script != "normal":
                    attributes.set("baseline", "30000" if item.script == "sup" else "-25000")
                if layout and layout.letter_spacing:
                    attributes.set("spc", str(round(layout.letter_spacing * 75)))
                if item.highlight:
                    highlight = OxmlElement("a:highlight")
                    rgb = OxmlElement("a:srgbClr")
                    rgb.set("val", item.highlight[1:])
                    highlight.append(rgb)
                    attributes.insert_element_before(
                        highlight,
                        "a:uLnTx",
                        "a:uLn",
                        "a:uFillTx",
                        "a:uFill",
                        "a:latin",
                        "a:ea",
                        "a:cs",
                        "a:sym",
                        "a:hlinkClick",
                        "a:hlinkMouseOver",
                        "a:extLst",
                    )
                ea = OxmlElement("a:ea")
                ea.set("typeface", item.font)
                run._r.get_or_add_rPr().append(ea)


def write_pptx(
    document: PresentationDocument, images: dict[str, Path], target: Path, *, media_types=None
):

    document, issues = resolve_document(document)
    if any(issue["code"] == "toc_overflow" for issue in issues):
        raise ValueError("目录超出页面容量，请先添加目录续页")
    deck = Presentation()
    shape_maps = []
    deck.slide_width, deck.slide_height = px(document.width), px(document.height)
    for original_page in document.slides:
        page = visible_scene(original_page)
        shape_map = {}
        slide = deck.slides.add_slide(deck.slide_layouts[6])
        slide.background.fill.solid()
        slide.background.fill.fore_color.rgb = color(page.background)
        slide.notes_slide.notes_text_frame.text = page.notes
        if page.notes_rich:
            add_text(
                slide.notes_slide.notes_placeholder,
                SimpleNamespace(paragraphs=page.notes_rich, text_layout=None),
            )
        if page.background_style:
            apply_paint(
                slide,
                SimpleNamespace(
                    fill=slide.background.fill,
                    _element=SimpleNamespace(spPr=slide._element.cSld.bg.bgPr),
                ),
                page.background_style,
                images,
                document.width,
                document.height,
            )
        for item in page.elements:
            bounds = tuple(px(v) for v in (item.x, item.y, item.width, item.height))
            if item.kind in {"audio", "video"}:
                shape = media_shape(
                    slide, item, images, bounds, (media_types or {}).get(item.asset_id, "video/mp4")
                )
            elif item.kind == "table":
                shape = table_shape(slide, item, bounds)
            elif item.kind == "chart":
                shape = chart_shape(slide, item, bounds)
            elif item.kind == "path":
                shape = path_shape(slide, item, bounds)
            elif item.kind == "text":
                shape = slide.shapes.add_textbox(*bounds)
                add_text(shape, item)
            elif item.kind in {"vector", "formula"}:
                shape = vector_picture(slide, item, images[item.asset_id], bounds)
            elif item.kind == "image":
                shape = slide.shapes.add_picture(
                    picture_source(item, images[item.asset_id]), *bounds
                )
                crop = pptx_crop(*shape.image.size, item.width, item.height, item.crop.model_dump())
                for side, value in crop.items():
                    setattr(shape, f"crop_{side}", value)
            elif item.kind == "line":
                shape = slide.shapes.add_connector(
                    MSO_CONNECTOR.STRAIGHT,
                    px(item.x),
                    px(item.y),
                    px(item.x + item.width),
                    px(item.y + item.height),
                )
            else:
                points = points_for(item.kind, item.width, item.height)
                shape = (
                    freeform(slide, item, points)
                    if points
                    else slide.shapes.add_shape(SHAPES[item.kind], *bounds)
                )
                shape.fill.solid()
                shape.fill.fore_color.rgb = color(item.fill)
                if item.paragraphs:
                    add_text(shape, item)
            # Suppress PowerPoint theme effects (the default shape style adds shadows).
            if item.kind in {"table", "chart"}:
                shape.name = item.id
                shape.rotation = item.rotation
                shape_map[item.id] = shape
                continue
            shape._element.spPr.append(OxmlElement("a:effectLst"))
            style = shape._element.find(qn("p:style"))
            if style is not None:
                shape._element.remove(style)
            if item.kind == "arrow":
                shape.adjustments[1] = 0.35 * item.width / min(item.width, item.height)
            shape.name = item.id
            if item.formula:
                import json

                shape._element.find(".//" + qn("p:cNvPr")).set(
                    "descr",
                    "FPL:formula:" + json.dumps(item.formula.model_dump(), ensure_ascii=False),
                )
            shape_map[item.id] = shape
            shape.rotation = item.rotation % 360
            if item.flip_x:
                shape._element.spPr.get_or_add_xfrm().set("flipH", "1")
            if item.flip_y:
                shape._element.spPr.get_or_add_xfrm().set("flipV", "1")
            if item.kind in {"image", "vector", "formula", "audio", "video"}:
                picture_style(shape, item)
            if item.kind not in {"image", "vector", "formula", "audio", "video"}:
                apply_paint(slide, shape, item.paint, images, item.width, item.height)
            if item.kind not in {"text", "image", "vector", "formula", "audio", "video"}:
                apply_shape_style(shape, item)
            apply_shadow(shape, item.shadow)
            if item.image_effects and item.image_effects.crop_shape != "rect":
                geometry = shape._element.spPr.prstGeom
                geometry.set(
                    "prst",
                    {"ellipse": "ellipse", "triangle": "triangle", "diamond": "diamond"}[
                        item.image_effects.crop_shape
                    ],
                )
        add_scene(slide, page, shape_map)
        shape_maps.append(shape_map)
    slides_by_id = {
        page.id: slide for page, slide in zip(document.slides, deck.slides, strict=True)
    }
    for page, shapes in zip(document.slides, shape_maps, strict=True):
        for element in page.elements:
            if not element.link or element.id not in shapes:
                continue
            action = shapes[element.id].click_action
            if element.link.type == "web":
                action.hyperlink.address = element.link.target
            else:
                action.target_slide = slides_by_id[element.link.target]
    # python-pptx creates the notes master relationship but omits its presentation
    # reference. Keynote rejects notes-bearing decks without this registration.
    notes_masters = OxmlElement("p:notesMasterIdLst")
    notes_master = OxmlElement("p:notesMasterId")
    notes_master.set(qn("r:id"), deck.part.relate_to(deck.part.notes_master_part, RT.NOTES_MASTER))
    notes_masters.append(notes_master)
    deck._element.insert_element_before(notes_masters, "p:sldIdLst")
    deck.save(target)
