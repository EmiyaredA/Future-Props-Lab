from pathlib import Path

from PIL import Image, ImageDraw

from app.galgame_workshop.video_dialogue import (
    _draw_name,
    _speaker_name_geometry,
    render_dialogue_layer,
    resolve_dialogue_style,
)

PANEL = (0, 756, 1920, 1080)
CONTENT = (211, 795, 1709, 1061)


def _dialogue_style(placement: str) -> dict[str, object]:
    return {
        "preset": "custom",
        "backgroundColor": "#05070B",
        "textColor": "#05070B",
        "nameColor": "#FF0000",
        "backgroundOpacity": 0.82,
        "layout": {
            "mode": "bottomOverlay",
            "widthPercent": 100,
            "heightPercent": 30,
            "bottomOffsetPercent": 0,
            "contentInsetXPercent": 11,
            "contentInsetTopPercent": 12,
            "contentInsetBottomPercent": 6,
        },
        "background": {
            "mode": "verticalGradient",
            "gradientTopOpacity": 1,
            "gradientBottomOpacity": 1,
            "topRule": "none",
        },
        "speakerName": {
            "placement": placement,
            "fontSizePx": 22,
            "decoration": "none",
        },
        "advanceIndicator": {"visible": False},
    }


def _red_bounds(path: Path) -> tuple[int, int, int, int] | None:
    with Image.open(path) as source:
        image = source.convert("RGBA")
    points = [
        (x, y)
        for y in range(PANEL[1], PANEL[3])
        for x in range(PANEL[0], PANEL[2])
        if (lambda pixel: pixel[0] > 180 and pixel[1] < 80 and pixel[2] < 80)(
            image.getpixel((x, y))
        )
    ]
    if not points:
        return None
    xs, ys = zip(*points, strict=True)
    return min(xs), min(ys), max(xs), max(ys)


def test_gradient_nodes_multiply_the_overall_opacity_pixel_for_pixel() -> None:
    _, path = render_dialogue_layer(
        text="",
        name="",
        configured_style=_dialogue_style("hidden"),
        runtime_preset=None,
    )

    with Image.open(path) as image:
        assert image.convert("RGBA").getpixel((1800, 900)) == (5, 7, 11, 209)


def test_all_speaker_name_placements_render_at_the_shared_logical_positions() -> None:
    expected = {
        "topLeft": ("left", "top"),
        "topCenter": ("center", "top"),
        "bottomLeft": ("left", "bottom"),
        "bottomCenter": ("center", "bottom"),
    }
    for placement, (horizontal, vertical) in expected.items():
        _, path = render_dialogue_layer(
            text="",
            name="红莉栖",
            configured_style=_dialogue_style(placement),
            runtime_preset=None,
        )
        bounds = _red_bounds(path)
        assert bounds is not None
        center_x = (bounds[0] + bounds[2]) // 2
        assert (center_x < 500) is (horizontal == "left")
        assert (bounds[1] < 900) is (vertical == "top")

    _, hidden_path = render_dialogue_layer(
        text="", name="红莉栖", configured_style=_dialogue_style("hidden"), runtime_preset=None
    )
    assert _red_bounds(hidden_path) is None


def test_top_name_reserves_body_space_and_bottom_name_does_not() -> None:
    top = _speaker_name_geometry(
        placement="topCenter",
        name_width=100,
        font_size=22,
        layout_mode="bottomOverlay",
        content=CONTENT,
        panel=PANEL,
    )
    bottom = _speaker_name_geometry(
        placement="bottomCenter",
        name_width=100,
        font_size=22,
        layout_mode="bottomOverlay",
        content=CONTENT,
        panel=PANEL,
    )
    assert top == (910, 771, 807)
    assert bottom == (910, 1033, 795)

    image = Image.new("RGBA", (1920, 1080))
    style = resolve_dialogue_style(_dialogue_style("hidden"))
    assert _draw_name(ImageDraw.Draw(image), "红莉栖", style, CONTENT, PANEL) == 795
