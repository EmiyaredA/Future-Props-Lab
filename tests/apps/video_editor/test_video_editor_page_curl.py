import subprocess
import threading

import numpy as np
import pytest
from PIL import Image, ImageChops, ImageDraw
from pydantic import ValidationError

from studio.apps.media_rendering.local.evaluator import FrameSource, TimelineFrameRenderer
from studio.apps.media_rendering.local.inputs import RenderCaptureFrame
from studio.apps.media_rendering.local.page_curl import page_curl
from studio.apps.media_rendering.local.render_engine import RENDER_PRESETS, render_document
from studio.contracts.video_editor.timeline_document import (
    VideoEditorTimelineTransition,
    VideoEditorTransition,
    parse_timeline_document,
)


@pytest.mark.parametrize("size", [(160, 90), (90, 160), (17, 9), (1, 1)])
@pytest.mark.parametrize("progress", [0, 0.01, 0.25, 0.5, 0.75, 0.99, 1])
def test_curl_is_deterministic_mirrored_and_does_not_modify_source(size, progress):
    source = Image.new("RGBA", size, "#28486b")
    ImageDraw.Draw(source).rectangle((0, 0, size[0] // 2, size[1] // 2), fill="#f48633")
    original = source.tobytes()
    left = page_curl(source, progress, "left")
    right = page_curl(source.transpose(Image.Transpose.FLIP_LEFT_RIGHT), progress, "right")
    assert source.tobytes() == original
    assert left.tobytes() == page_curl(source, progress, "left").tobytes()
    # Hidden RGB is immaterial; compare premultiplied color and alpha.
    assert (
        left.convert("RGBa").tobytes()
        == right.transpose(Image.Transpose.FLIP_LEFT_RIGHT).convert("RGBa").tobytes()
    )
    if progress == 0:
        assert left.tobytes() == original
    elif progress == 1:
        assert left.getchannel("A").getbbox() is None


def test_paper_and_shadow_preserve_transparency_and_reveal_the_background():
    assert page_curl(Image.new("RGBA", (160, 90)), 0.5, "left").getbbox() is None
    source = Image.new("RGBA", (160, 90), (40, 80, 120, 128))
    pixels = np.asarray(page_curl(source, 0.5, "left"))
    assert pixels[:, :, 3].max() == 128
    assert pixels[45, 10].tolist() == [40, 80, 120, 128]
    assert pixels[45, 150, 3] == 0
    assert pixels[45, 90, 0] > 160  # Visible light paper back.
    assert 0 < pixels[45, 107, 3] < 128  # Local shadow ahead of the roll.


@pytest.mark.parametrize("model", [VideoEditorTransition, VideoEditorTimelineTransition])
@pytest.mark.parametrize("direction", ["up", "down", "in", "out"])
def test_contract_rejects_non_horizontal_page_directions(model, direction):
    with pytest.raises(ValidationError, match="书页翻页只支持左右方向"):
        model.model_validate(
            {
                "kind": "page-curl",
                "durationUs": 800_000,
                "direction": direction,
                "id": "seam",
                "fromClipId": "a",
                "toClipId": "b",
            }
        )


def test_seam_places_next_page_below_outgoing_and_keeps_other_tracks_above():
    clips = [
        {
            "id": name,
            "name": name,
            "trackId": "v1",
            "kind": "image",
            "assetId": name,
            "timelineStartUs": start,
            "durationUs": 2_000_000,
        }
        for name, start in [("a", 0), ("b", 2_000_000)]
    ]
    raw = {
        "tracks": [{"id": "v1", "name": "V1", "kind": "visual", "order": 1, "clips": clips}],
        "transitions": [
            {
                "id": "seam",
                "kind": "page-curl",
                "durationUs": 800_000,
                "fromClipId": "a",
                "toClipId": "b",
                "easing": "linear",
                "placement": "between",
            }
        ],
    }
    source = FrameSource(
        lambda clip, _: Image.new("RGBA", (1920, 1080), "red" if clip.id == "a" else "blue"),
        lambda _: None,
    )
    renderer = TimelineFrameRenderer(parse_timeline_document(raw), source)
    middle = renderer.render(2_000_000)
    assert middle.getpixel((100, 540)) == (255, 0, 0)
    assert middle.getpixel((1800, 540)) == (0, 0, 255)
    assert renderer.render(1_600_000).getpixel((1800, 540)) == (255, 0, 0)
    assert renderer.render(2_400_000).getpixel((100, 540)) == (0, 0, 255)
    raw["tracks"].append(
        {
            "id": "top",
            "name": "Top",
            "kind": "visual",
            "order": 0,
            "clips": [
                {
                    "id": "overlay",
                    "name": "Overlay",
                    "trackId": "top",
                    "kind": "color",
                    "color": "#00ff00",
                    "timelineStartUs": 0,
                    "durationUs": 4_000_000,
                }
            ],
        }
    )
    top = TimelineFrameRenderer(parse_timeline_document(raw), source).render(2_000_000)
    assert ImageChops.difference(top, Image.new("RGB", top.size, "#00ff00")).getbbox() is None


@pytest.mark.parametrize("fps,rate", [(30, 1), (60, 1), (30, 1.5)])
def test_encoded_curl_holds_the_frame_before_the_source_cut(tmp_path, monkeypatch, fps, rate):
    """A tail handle at duration-1 must not drain the decoder into the next shot."""
    path = tmp_path / "cut.mp4"
    boundary = round(2 * rate * 30)
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-s",
            "16x16",
            "-r",
            "30",
            "-i",
            "pipe:0",
            "-an",
            "-c:v",
            "libx264",
            "-crf",
            "0",
            "-pix_fmt",
            "yuv444p",
            "-y",
            str(path),
        ],
        input=b"".join(bytes([30 if i < boundary else 220]) * (16 * 16 * 3) for i in range(150)),
        check=True,
        capture_output=True,
        timeout=30,
    )
    document = parse_timeline_document(
        {
            "tracks": [
                {
                    "id": "v",
                    "name": "V",
                    "kind": "visual",
                    "order": 0,
                    "clips": [
                        {
                            "id": name,
                            "name": name,
                            "kind": "video",
                            "assetId": "source",
                            "trackId": "v",
                            "timelineStartUs": index * 2_000_000,
                            "durationUs": 2_000_000,
                            "sourceInUs": index * round(2_000_000 * rate),
                            "playbackRate": rate,
                            "transform": {"x": 8, "y": 8},
                        }
                        for index, name in enumerate(["a", "b"])
                    ],
                }
            ],
            "transitions": [
                {
                    "id": "seam",
                    "kind": "page-curl",
                    "durationUs": 800_000,
                    "placement": "between",
                    "fromClipId": "a",
                    "toClipId": "b",
                }
            ],
        }
    )
    document.settings = document.settings.model_copy(update={"width": 16, "height": 16})
    monkeypatch.setitem(RENDER_PRESETS, "curl-test", (16, 16, fps))
    output = tmp_path / "export.mp4"
    render_document(
        document,
        {"source": path},
        output,
        preset="curl-test",
        start_us=1_700_000,
        end_us=2_300_000,
        cancel=threading.Event(),
        progress=lambda _: None,
        capture_frame=RenderCaptureFrame(width=16, height=16),
    )
    decoded = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(output),
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
        timeout=30,
    ).stdout
    frame = np.frombuffer(decoded, dtype=np.uint8).reshape(-1, 16, 16, 3)
    middle = round(0.3 * fps)
    assert abs(int(frame[middle, 8, 0, 0]) - 30) <= 5
    assert abs(int(frame[middle, 8, 15, 0]) - 220) <= 5
