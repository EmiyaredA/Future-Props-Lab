from __future__ import annotations

import io
from pathlib import Path

import pytest
from PIL import Image
from pydantic import ValidationError

from app.capabilities.media_rendering.chroma_key import apply_chroma_key
from app.capabilities.media_rendering.contracts import RenderPlan
from app.capabilities.media_rendering.evaluator import FrameSource, TimelineFrameRenderer
from app.capabilities.media_rendering.frame_renderer import render_plan_frame
from app.capabilities.media_rendering.timeline_document import (
    VideoEditorChromaKey,
    VideoEditorClip,
    VideoEditorTimelineDocument,
)


def clip(kind: str = "image", chroma_key: dict | None = None) -> VideoEditorClip:
    return VideoEditorClip.model_validate(
        {
            "id": "clip-1",
            "trackId": "track-1",
            "kind": kind,
            "name": "screen",
            "timelineStartUs": 0,
            "durationUs": 1_000_000,
            "assetId": "asset-1",
            **({"chromaKey": chroma_key} if chroma_key is not None else {}),
        }
    )


@pytest.mark.parametrize("color", ["#00ff00", "#0000ff", "#ff00ff"])
def test_chroma_removes_any_configured_color_but_preserves_foreground(color: str) -> None:
    image = Image.new("RGBA", (2, 1), (255, 0, 0, 255))
    image.putpixel((0, 0), (*bytes.fromhex(color[1:]), 255))
    result = apply_chroma_key(image, VideoEditorChromaKey(color=color, enabled=True))
    assert result.getpixel((0, 0))[3] == 0
    assert result.getpixel((1, 0))[3] == 255


def test_softness_and_existing_alpha_are_respected() -> None:
    image = Image.new("RGBA", (1, 1), (0, 60, 0, 128))
    soft = apply_chroma_key(image, VideoEditorChromaKey(enabled=True, softness=100))
    hard = apply_chroma_key(image, VideoEditorChromaKey(enabled=True, softness=0))
    assert 0 < soft.getpixel((0, 0))[3] < 128
    assert hard.getpixel((0, 0))[3] in {0, 128}


@pytest.mark.parametrize("color, mixed", [("#00ff00", (200, 55, 0)), ("#0000ff", (200, 0, 55))])
def test_despill_recovers_mixed_foreground_at_screen_boundary(
    color: str, mixed: tuple[int, int, int]
) -> None:
    image = Image.new("RGBA", (9, 1), (*mixed, 255))
    image.putpixel((0, 0), (*bytes.fromhex(color[1:]), 255))
    image.putpixel((1, 0), (100, 155, 0, 255) if color == "#00ff00" else (100, 0, 155, 255))
    result = apply_chroma_key(image, VideoEditorChromaKey(enabled=True, color=color, despill=100))
    assert result.getpixel((0, 0))[3] == 0
    assert result.getpixel((1, 0))[3] == pytest.approx(100, abs=2)
    assert result.getpixel((2, 0))[3] == pytest.approx(200, abs=2)
    assert result.getpixel((2, 0))[0] >= 250
    assert result.getpixel((2, 0))[1 if color == "#00ff00" else 2] <= 2
    assert result.getpixel((5, 0)) == (*mixed, 255)
    disabled = apply_chroma_key(image, VideoEditorChromaKey(enabled=True, color=color, despill=0))
    assert disabled.getpixel((2, 0)) == (*mixed, 255)


def test_clip_contract_is_optional_and_restricted_to_visual_media() -> None:
    assert clip().chroma_key is None
    assert clip("video", {"enabled": True}).chroma_key is not None
    with pytest.raises(ValidationError):
        clip("audio", {"enabled": True})


@pytest.mark.parametrize("kind", ["image", "video"])
def test_renderer_comparison_bypasses_only_selected_clip(kind: str) -> None:
    source = Image.new("RGBA", (2, 1), (0, 255, 0, 255))
    selected = clip(kind, chroma_key={"enabled": True})
    document = VideoEditorTimelineDocument()
    frame_source = FrameSource(
        image_for_clip=lambda _clip, _time: source.copy(), font_for_clip=lambda _clip: None
    )
    keyed = TimelineFrameRenderer(document, frame_source)._layer(selected, 0)
    raw = TimelineFrameRenderer(document, frame_source, without_chroma_clip_id=selected.id)._layer(
        selected, 0
    )
    assert keyed is not None and raw is not None
    assert keyed.getpixel((0, 0))[3] == 0
    assert raw.getpixel((0, 0))[3] == 255


def test_keyed_foreground_reveals_lower_visual_track(tmp_path: Path) -> None:
    foreground = Image.new("RGBA", (2, 2), (0, 255, 0, 255))
    foreground.putpixel((1, 1), (255, 0, 0, 255))
    background = Image.new("RGBA", (2, 2), (0, 0, 255, 255))
    document = VideoEditorTimelineDocument.model_validate(
        {
            "tracks": [
                {
                    "id": "front",
                    "name": "foreground",
                    "kind": "visual",
                    "order": 0,
                    "clips": [
                        {
                            "id": "front-clip",
                            "trackId": "front",
                            "kind": "image",
                            "name": "green",
                            "assetId": "green",
                            "timelineStartUs": 0,
                            "durationUs": 1_000_000,
                            "chromaKey": {"enabled": True},
                        }
                    ],
                },
                {
                    "id": "back",
                    "name": "background",
                    "kind": "visual",
                    "order": 1,
                    "clips": [
                        {
                            "id": "back-clip",
                            "trackId": "back",
                            "kind": "image",
                            "name": "blue",
                            "assetId": "blue",
                            "timelineStartUs": 0,
                            "durationUs": 1_000_000,
                        }
                    ],
                },
            ]
        }
    )
    rendered = TimelineFrameRenderer(
        document,
        FrameSource(
            image_for_clip=lambda item, _time: (
                foreground if item.asset_id == "green" else background
            ).copy(),
            font_for_clip=lambda _item: None,
        ),
    ).render(0, size=(16, 9))
    assert rendered.getpixel((1, 1)) == (0, 0, 255)
    assert rendered.getpixel((14, 8))[0] > 245

    foreground_path = tmp_path / "foreground.png"
    background_path = tmp_path / "background.png"
    foreground.save(foreground_path)
    background.save(background_path)
    plan = RenderPlan(document, {"green": foreground_path, "blue": background_path})
    keyed_frame = Image.open(io.BytesIO(render_plan_frame(plan, time_us=0, width=16)))
    raw_frame = Image.open(
        io.BytesIO(
            render_plan_frame(plan, time_us=0, width=16, without_chroma_clip_id="front-clip")
        )
    )
    assert keyed_frame.getpixel((1, 1))[:3] == (0, 0, 255)
    assert raw_frame.getpixel((1, 1))[:3] == (0, 255, 0)
