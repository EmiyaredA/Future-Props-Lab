import pytest
from PIL import Image, ImageChops, ImageDraw

from app.capabilities.media_rendering.evaluator import FrameSource, TimelineFrameRenderer
from app.capabilities.media_rendering.spin_blur import spin_blur
from app.capabilities.media_rendering.timeline_document import parse_timeline_document


def _pattern():
    image = Image.new("RGBA", (160, 90), "#102030")
    draw = ImageDraw.Draw(image)
    draw.rectangle((100, 35, 125, 55), fill="white")
    draw.rectangle((20, 10, 30, 20), fill="red")
    return image


def test_angular_samples_move_detail_in_opposite_directions_and_preserve_source():
    source = _pattern()
    original = source.copy()
    clockwise = spin_blur(source, 0.6)
    counterclockwise = spin_blur(source, -0.6)
    assert spin_blur(source, 0) is source
    assert source.tobytes() == original.tobytes()
    assert clockwise.size == source.size
    assert clockwise.getchannel("A").getextrema() == (255, 255)
    assert clockwise.tobytes() != counterclockwise.tobytes()

    # A white detail right of center leaves an arc below/above center respectively.
    def detail_center_y(image):
        detail = [
            (y, pixel[1])
            for y in range(image.height)
            for x in range(image.width)
            if (pixel := image.getpixel((x, y)))[1] > 100
        ]
        return sum(y * weight for y, weight in detail) / sum(weight for _, weight in detail)

    assert detail_center_y(clockwise) > source.height / 2
    assert detail_center_y(counterclockwise) < source.height / 2
    assert any(60 < pixel[1] < 240 for pixel in clockwise.get_flattened_data())
    assert clockwise.tobytes() == spin_blur(source, 0.6).tobytes()


def test_transparent_samples_keep_their_color_without_dark_fringes():
    source = Image.new("RGBA", (80, 80), (0, 0, 0, 0))
    ImageDraw.Draw(source).rectangle((45, 30, 60, 50), fill=(255, 0, 0, 255))
    result = spin_blur(source, 0.6)
    partial = [pixel for pixel in result.get_flattened_data() if 10 < pixel[3] < 240]
    assert partial
    assert all(pixel[:3] == (255, 0, 0) for pixel in partial)


@pytest.mark.parametrize("placement", ["between", "in", "out"])
def test_spin_blur_is_rendered_at_seams_and_clip_edges(placement):
    clips = [
        {
            "id": name,
            "trackId": "v1",
            "kind": "image",
            "name": name,
            "assetId": name,
            "timelineStartUs": index * 2_000_000,
            "durationUs": 2_000_000,
        }
        for index, name in enumerate(["a", "b"])
    ]
    transition = {"kind": "spin-blur", "durationUs": 1_000_000, "easing": "linear"}
    raw = {"tracks": [{"id": "v1", "kind": "visual", "name": "V1", "order": 0, "clips": clips}]}
    if placement == "between":
        raw["transitions"] = [
            {**transition, "placement": "between", "id": "spin", "fromClipId": "a", "toClipId": "b"}
        ]
        time_us = 2_000_000
    else:
        clips[0]["transitionIn" if placement == "in" else "transitionOut"] = transition
        time_us = 500_000 if placement == "in" else 1_500_000
    source = FrameSource(lambda _clip, _local: _pattern(), lambda _clip: None)
    renderer = TimelineFrameRenderer(parse_timeline_document(raw), source)
    affected = renderer.render(time_us)
    assert affected.tobytes() == renderer.render(time_us).tobytes()
    assert affected.mode == "RGB"
    raw.pop("transitions", None)
    clips[0].pop("transitionIn", None)
    clips[0].pop("transitionOut", None)
    plain = TimelineFrameRenderer(parse_timeline_document(raw), source).render(time_us)
    assert ImageChops.difference(affected.convert("RGB"), plain.convert("RGB")).getbbox()
    # Once outside the window, no blur remains.
    assert (
        renderer.render(3_000_000).tobytes()
        == TimelineFrameRenderer(parse_timeline_document(raw), source).render(3_000_000).tobytes()
    )
