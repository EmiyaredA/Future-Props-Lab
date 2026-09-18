"""DrawingML shape styling kept consistent with the shared SVG renderer."""

from pptx.dml.color import RGBColor
from pptx.oxml.xmlchemy import OxmlElement
from pptx.util import Emu

from app.apps.presentation_workshop.schemas.document import PresentationElement


def apply_shape_style(shape, item: PresentationElement):
    if item.kind != "line":
        fill = shape._element.spPr.find(
            "{http://schemas.openxmlformats.org/drawingml/2006/main}solidFill"
        )
        if fill is not None and len(fill):
            alpha = OxmlElement("a:alpha")
            alpha.set("val", str(round(item.fill_opacity * item.opacity * 100000)))
            fill[0].append(alpha)
    if item.kind == "roundRect" and item.corner_radius is not None:
        shortest = min(item.width, item.height)
        shape.adjustments[0] = min(item.corner_radius / shortest, 0.5)
    if not item.stroke_width:
        shape.line.fill.background()
        return
    shape.line.color.rgb = RGBColor.from_string(item.stroke[1:])
    shape.line.width = Emu(round(item.stroke_width * 9525))
    line = shape._element.spPr.get_or_add_ln()
    if item.opacity != 1:
        color = line.find("{http://schemas.openxmlformats.org/drawingml/2006/main}solidFill")
        if color is not None and len(color):
            alpha = OxmlElement("a:alpha")
            alpha.set("val", str(round(item.opacity * 100000)))
            color[0].append(alpha)
    dash = OxmlElement("a:prstDash")
    dash.set("val", {"solid": "solid", "dash": "dash", "dot": "sysDot"}[item.stroke_dash])
    line.append(dash)
    if item.kind == "line":
        for name, value in (("headEnd", item.start_arrow), ("tailEnd", item.end_arrow)):
            arrow = OxmlElement(f"a:{name}")
            arrow.set("type", {"open": "arrow", "circle": "oval"}.get(value, value))
            arrow.set("w", "med")
            arrow.set("len", "med")
            line.append(arrow)
