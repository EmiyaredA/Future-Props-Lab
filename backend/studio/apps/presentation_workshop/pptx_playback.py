"""Managed audio/video package relationships and local playback settings."""

import io

from PIL import Image, ImageDraw
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from pptx.oxml.ns import qn


def media_shape(slide, element, assets, bounds, mime_type):
    media = element.media
    poster = assets.get(media.poster_asset_id)
    if element.kind == "audio" and not poster:
        icon = Image.new("RGBA", (128, 128))
        draw = ImageDraw.Draw(icon)
        draw.polygon(
            [(22, 50), (45, 50), (68, 30), (68, 98), (45, 78), (22, 78)], fill=media.icon_color
        )
        draw.arc((40, 28, 108, 100), -55, 55, fill=media.icon_color, width=6)
        draw.arc((28, 10, 126, 118), -55, 55, fill=media.icon_color, width=6)
        poster = io.BytesIO()
        icon.save(poster, "PNG")
        poster.seek(0)
    shape = slide.shapes.add_movie(
        str(assets[element.asset_id]),
        *bounds,
        poster_frame_image=poster
        if isinstance(poster, io.BytesIO)
        else str(poster)
        if poster
        else None,
        mime_type=mime_type,
    )
    if element.kind == "audio":
        video = shape._element.find(".//" + qn("a:videoFile"))
        identity = video.get(qn("r:link"))
        target = slide.part.rels[identity].target_part
        slide.part.drop_rel(identity)
        video.tag = qn("a:audioFile")
        video.set(qn("r:link"), slide.part.relate_to(target, RT.AUDIO))
    for node in slide._element.findall(".//" + qn("p:video")):
        target = node.find(".//" + qn("p:spTgt"))
        if target is None or target.get("spid") != str(shape.shape_id):
            continue
        if element.kind == "audio":
            node.tag = qn("p:audio")
        timing = node.find(".//" + qn("p:cTn"))
        if media.loop:
            timing.set("repeatCount", "indefinite")
        if media.autoplay:
            condition = timing.find(".//" + qn("p:cond"))
            if condition is not None:
                condition.set("delay", "0")
    return shape
