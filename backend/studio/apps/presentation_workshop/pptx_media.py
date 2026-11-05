"""Vector embedding and picture effects; PNG fallback accompanies each SVG."""

from hashlib import sha256
from pathlib import Path

import resvg_py
from pptx.opc.package import Part
from pptx.opc.packuri import PackURI
from pptx.oxml.xmlchemy import OxmlElement

from studio.apps.presentation_workshop.pptx_styles import apply_shape_style
from studio.runtime.files.svg import tint_svg

SVG_NS = "http://schemas.microsoft.com/office/drawing/2016/SVG/main"
IMAGE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def vector_picture(slide, item, image: Path, bounds):
    svg = tint_svg(image.with_suffix(".svg").read_text(), item.vector_color)
    identifier = sha256(item.id.encode()).hexdigest()
    fallback = image.parent / f"vector-{identifier}.png"
    scale = min(2, 4096 / max(item.width, item.height))
    fallback.write_bytes(
        resvg_py.svg_to_bytes(
            svg_string=svg,
            width=max(1, round(item.width * scale)),
            height=max(1, round(item.height * scale)),
        )
    )
    shape = slide.shapes.add_picture(str(fallback), *bounds)
    package = slide.part.package
    part = Part(
        PackURI(f"/ppt/media/vector-{identifier}.svg"), "image/svg+xml", package, svg.encode()
    )
    rid = slide.part.relate_to(part, IMAGE_REL)
    blip = shape._element.blipFill.blip
    ext_list = OxmlElement("a:extLst")
    ext = OxmlElement("a:ext")
    ext.set("uri", "{96DAC541-7B7A-43D3-8B79-37D633B846F1}")
    from lxml import etree

    svg_blip = etree.Element(f"{{{SVG_NS}}}svgBlip", nsmap={"asvg": SVG_NS})
    svg_blip.set(f"{{{REL_NS}}}embed", rid)
    ext.append(svg_blip)
    ext_list.append(ext)
    blip.append(ext_list)
    return shape


def picture_style(shape, item):
    if item.opacity != 1:
        alpha = OxmlElement("a:alphaModFix")
        alpha.set("amt", str(round(item.opacity * 100000)))
        # Effects precede the extension list containing the SVG relationship.
        shape._element.blipFill.blip.insert_element_before(alpha, "a:extLst")
    if item.kind == "image" and item.corner_radius:
        geom = shape._element.spPr.prstGeom
        geom.set("prst", "roundRect")
        av = geom.find("{http://schemas.openxmlformats.org/drawingml/2006/main}avLst")
        gd = OxmlElement("a:gd")
        gd.set("name", "adj")
        gd.set(
            "fmla",
            f"val {round(min(0.5, item.corner_radius / min(item.width, item.height)) * 100000)}",
        )
        av.append(gd)
    if item.image_border:
        apply_shape_style(shape, item)
    else:
        shape.line.fill.background()
