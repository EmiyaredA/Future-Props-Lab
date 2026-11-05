"""Native fills/shadows and per-picture appearance at the DrawingML boundary."""

import io

from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from pptx.dml.color import RGBColor
from pptx.oxml.ns import qn
from pptx.oxml.xmlchemy import OxmlElement
from pptx.util import Emu


def picture_source(item, path):
    effects = item.image_effects
    if not effects:
        return str(path)
    with Image.open(path) as source:
        rgba = source.convert("RGBA")
        alpha = rgba.getchannel("A")
        image = rgba.convert("RGB")
        image = ImageEnhance.Brightness(image).enhance(effects.brightness)
        image = ImageEnhance.Contrast(image).enhance(effects.contrast)
        image = ImageEnhance.Color(image).enhance(effects.saturation)
        if effects.grayscale:
            image = Image.blend(image, ImageOps.grayscale(image).convert("RGB"), effects.grayscale)
        if effects.blur:
            image = image.filter(ImageFilter.GaussianBlur(effects.blur))
            alpha = alpha.filter(ImageFilter.GaussianBlur(effects.blur))
        if effects.tint:
            image = Image.blend(image, Image.new("RGB", image.size, effects.tint), 0.35)
        image.putalpha(alpha)
        buffer = io.BytesIO()
        image.save(buffer, "PNG")
        buffer.seek(0)
        return buffer


def paint_image(paint, path, width, height):
    scale = min(1, 2048 / max(width, height))
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    with Image.open(path) as source:
        image = source.convert("RGBA")
        if paint.fit == "repeat":
            tile = ImageOps.fit(image, (max(1, round(256 * scale)), max(1, round(256 * scale))))
            image = Image.new("RGBA", size, paint.color)
            for y in range(0, size[1], tile.height):
                for x in range(0, size[0], tile.width):
                    image.paste(tile, (x, y), tile)
        elif paint.fit == "contain":
            fitted = ImageOps.contain(image, size)
            image = Image.new("RGBA", size, paint.color)
            image.paste(
                fitted, ((size[0] - fitted.width) // 2, (size[1] - fitted.height) // 2), fitted
            )
        else:
            image = ImageOps.fit(image, size)
        output = io.BytesIO()
        image.save(output, "PNG")
        output.seek(0)
        return output


def apply_paint(slide, shape, paint, assets, width, height):
    if not paint:
        return
    if paint.type == "solid":
        shape.fill.solid()
        shape.fill.fore_color.rgb = RGBColor.from_string(paint.color[1:])
    elif paint.type in {"linear", "radial"}:
        shape.fill.gradient()
        shape.fill.gradient_angle = (90 - paint.angle) % 360
        shape.fill.gradient_stops[0].color.rgb = RGBColor.from_string(paint.color[1:])
        shape.fill.gradient_stops[-1].color.rgb = RGBColor.from_string(paint.end_color[1:])
        if paint.type == "radial":
            gradient = shape.fill._xPr.gradFill
            linear = gradient.find(qn("a:lin"))
            if linear is not None:
                gradient.remove(linear)
            path = OxmlElement("a:path")
            path.set("path", "circle")
            rect = OxmlElement("a:fillToRect")
            for side in ("l", "t", "r", "b"):
                rect.set(side, "50000")
            path.append(rect)
            gradient.insert_element_before(path, "a:tileRect")
    else:
        _, identity = slide.part.get_or_add_image_part(
            paint_image(paint, assets[paint.asset_id], width, height)
        )
        shape.fill.background()
        properties = shape._element.spPr
        properties.remove(properties.find(qn("a:noFill")))
        fill = OxmlElement("a:blipFill")
        blip = OxmlElement("a:blip")
        blip.set(qn("r:embed"), identity)
        fill.append(blip)
        stretch = OxmlElement("a:stretch")
        stretch.append(OxmlElement("a:fillRect"))
        fill.append(stretch)
        properties.insert_element_before(
            fill, "a:ln", "a:effectLst", "a:effectDag", "a:scene3d", "a:sp3d", "a:extLst"
        )


def apply_shadow(shape, shadow):
    if not shadow:
        return
    import math

    effects = shape._element.spPr.find(qn("a:effectLst"))
    if effects is None:
        effects = OxmlElement("a:effectLst")
        shape._element.spPr.append(effects)
    node = OxmlElement("a:outerShdw")
    node.set("blurRad", str(Emu(round(shadow.blur * 9525))))
    node.set("dist", str(round(math.hypot(shadow.x, shadow.y) * 9525)))
    node.set("dir", str(round(math.degrees(math.atan2(shadow.y, shadow.x)) % 360 * 60000)))
    node.set("rotWithShape", "0")
    color = OxmlElement("a:srgbClr")
    color.set("val", shadow.color[1:])
    alpha = OxmlElement("a:alpha")
    alpha.set("val", str(round(shadow.opacity * 100000)))
    color.append(alpha)
    node.append(color)
    effects.append(node)
