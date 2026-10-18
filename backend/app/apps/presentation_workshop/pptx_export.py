"""Native PowerPoint objects; all DrawingML details stay at this boundary."""

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_AUTO_SHAPE_TYPE, MSO_CONNECTOR
from pptx.enum.text import MSO_AUTO_SIZE, PP_ALIGN
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from pptx.oxml.ns import qn
from pptx.oxml.xmlchemy import OxmlElement
from pptx.util import Emu, Pt

from app.apps.presentation_workshop.image_crop import pptx_crop
from app.apps.presentation_workshop.native_shapes import freeform, points_for
from app.apps.presentation_workshop.pptx_media import picture_style, vector_picture
from app.apps.presentation_workshop.pptx_scene import add_scene
from app.apps.presentation_workshop.pptx_styles import apply_shape_style
from app.apps.presentation_workshop.schemas.document import (
    PresentationDocument,
    PresentationElement,
)

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
    for index, paragraph in enumerate(element.paragraphs):
        p = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        p.alignment = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER, "right": PP_ALIGN.RIGHT}[
            paragraph.align
        ]
        p.space_before = p.space_after = Pt(0)
        p.line_spacing = Pt(
            max((r.size for r in paragraph.runs), default=24) * paragraph.line_height * 0.75
        )
        properties = p._p.get_or_add_pPr()
        bullet = OxmlElement("a:buChar" if paragraph.bullet else "a:buNone")
        if paragraph.bullet:
            bullet.set("char", "•")
            properties.set("marL", str(px(24)))
            properties.set("indent", str(px(-18)))
        properties.append(bullet)
        for item in paragraph.runs:
            run = p.add_run()
            run.text = item.text
            run.font.name = item.font
            run.font.size = Pt(item.size * 0.75)
            run.font.bold, run.font.italic, run.font.underline = (
                item.bold,
                item.italic,
                item.underline,
            )
            run.font.color.rgb = color(item.color)
            ea = OxmlElement("a:ea")
            ea.set("typeface", item.font)
            run._r.get_or_add_rPr().append(ea)


def write_pptx(document: PresentationDocument, images: dict[str, Path], target: Path):
    deck = Presentation()
    deck.slide_width, deck.slide_height = px(document.width), px(document.height)
    for page in document.slides:
        shape_map = {}
        slide = deck.slides.add_slide(deck.slide_layouts[6])
        slide.background.fill.solid()
        slide.background.fill.fore_color.rgb = color(page.background)
        slide.notes_slide.notes_text_frame.text = page.notes
        for item in page.elements:
            bounds = tuple(px(v) for v in (item.x, item.y, item.width, item.height))
            if item.kind == "text":
                shape = slide.shapes.add_textbox(*bounds)
                add_text(shape, item)
            elif item.kind == "vector":
                shape = vector_picture(slide, item, images[item.asset_id], bounds)
            elif item.kind == "image":
                shape = slide.shapes.add_picture(str(images[item.asset_id]), *bounds)
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
            # Suppress PowerPoint theme effects (the default shape style adds shadows).
            shape._element.spPr.append(OxmlElement("a:effectLst"))
            style = shape._element.find(qn("p:style"))
            if style is not None:
                shape._element.remove(style)
            if item.kind == "arrow":
                shape.adjustments[1] = 0.35 * item.width / min(item.width, item.height)
            shape.name = item.id
            shape_map[item.id] = shape
            shape.rotation = item.rotation % 360
            if item.flip_x:
                shape._element.spPr.get_or_add_xfrm().set("flipH", "1")
            if item.flip_y:
                shape._element.spPr.get_or_add_xfrm().set("flipV", "1")
            if item.kind in {"image", "vector"}:
                picture_style(shape, item)
            if item.kind not in {"text", "image", "vector"}:
                apply_shape_style(shape, item)
        add_scene(slide, page, shape_map)
    # python-pptx creates the notes master relationship but omits its presentation
    # reference. Keynote rejects notes-bearing decks without this registration.
    notes_masters = OxmlElement("p:notesMasterIdLst")
    notes_master = OxmlElement("p:notesMasterId")
    notes_master.set(qn("r:id"), deck.part.relate_to(deck.part.notes_master_part, RT.NOTES_MASTER))
    notes_masters.append(notes_master)
    deck._element.insert_element_before(notes_masters, "p:sldIdLst")
    deck.save(target)
