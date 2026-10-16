from __future__ import annotations

import subprocess
import threading

from PIL import Image

from app.capabilities.media_rendering.contracts import RenderCaptureFrame
from app.capabilities.media_rendering.render_engine import RENDER_PRESETS, render_document
from app.capabilities.media_rendering.timeline_document import parse_timeline_document


def test_encoded_eyelid_has_symmetric_lids_and_switches_while_closed(tmp_path, monkeypatch):
    width, height, fps = 320, 180, 30
    assets = {}
    clips = []
    for index, color in enumerate(["red", "blue"]):
        path = tmp_path / f"{color}.png"
        Image.new("RGB", (width, height), color).save(path)
        assets[color] = path
        clips.append(
            {
                "id": color,
                "name": color,
                "trackId": "visual",
                "kind": "image",
                "assetId": color,
                "timelineStartUs": index * 1_000_000,
                "durationUs": 1_000_000,
                "transform": {"x": width / 2, "y": height / 2},
            }
        )
    document = parse_timeline_document(
        {
            "settings": {"fps": fps},
            "tracks": [
                {"id": "visual", "name": "画面", "order": 0, "kind": "visual", "clips": clips}
            ],
            "transitions": [
                {
                    "id": "blink",
                    "kind": "eyelid",
                    "placement": "between",
                    "fromClipId": "red",
                    "toClipId": "blue",
                    "durationUs": 1_000_000,
                    "easing": "linear",
                }
            ],
        }
    )
    # Keep the real encode/mux path inexpensive using an isolated small raster.
    document.settings = document.settings.model_copy(update={"width": width, "height": height})
    monkeypatch.setitem(RENDER_PRESETS, "eyelid-test", (width, height, fps))
    output = tmp_path / "eyelid.mp4"
    render_document(
        document,
        assets,
        output,
        preset="eyelid-test",
        start_us=0,
        end_us=2_000_000,
        cancel=threading.Event(),
        progress=lambda _: None,
        capture_frame=RenderCaptureFrame(width=width, height=height),
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
    frame_size = width * height * 3
    assert len(decoded) == 2 * fps * frame_size
    frames = [
        Image.frombytes("RGB", (width, height), decoded[index : index + frame_size])
        for index in range(0, len(decoded), frame_size)
    ]
    # Verify the actual H.264 output, including both closing and opening halves.
    for index in [22, 23, 37, 38]:
        frame = frames[index]
        for x in [0, 40, 80, 160, 240, 280, 319]:
            visible = [y for y in range(height) if max(frame.getpixel((x, y))) > 32]
            assert visible
            assert abs(visible[0] - (height - 1 - visible[-1])) <= 3
            assert max(frame.getpixel((x, height - 1))) < 10
        center = frame.getpixel((width // 2, height // 2))
        assert center[0 if index < fps else 2] > 200
    assert max(frames[fps].getextrema()[channel][1] for channel in range(3)) < 10
