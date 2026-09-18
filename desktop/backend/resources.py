"""Isolated native-resource diagnostic; never opens a database or user directory."""

from __future__ import annotations

import io
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def check_resources() -> None:
    import resvg_py
    from PIL import Image, ImageDraw, ImageFont
    from pptx import Presentation

    frozen = getattr(sys, "frozen", False)
    root = Path(sys._MEIPASS) if frozen else Path(__file__).resolve().parents[2]
    assets = root / ("app" if frozen else "backend/app") / "capabilities/media_rendering/assets"
    image = Image.new("RGB", (320, 100), "white")
    font = ImageFont.truetype(str(assets / "NotoSansSC-Regular.ttf"), 24)
    ImageDraw.Draw(image).text((10, 10), "未来道具研究所", font=font, fill="black")
    assert image.getbbox()
    png = resvg_py.svg_to_bytes(
        svg_string=(
            '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">'
            '<rect width="100" height="100" fill="red"/></svg>'
        )
    )
    assert png.startswith(b"\x89PNG")
    slides = Presentation()
    slides.slides.add_slide(slides.slide_layouts[6])
    output = io.BytesIO()
    slides.save(output)
    assert output.getvalue().startswith(b"PK")
    assert (root / "README.md").read_text().startswith("# Future Props Lab")
    assert list((root / "docs/reference").glob("*.md"))
    ffmpeg = str(root / "bin/ffmpeg") if frozen else shutil.which("ffmpeg")
    ffprobe = str(root / "bin/ffprobe") if frozen else shutil.which("ffprobe")
    with tempfile.TemporaryDirectory(prefix="fpl-native-smoke-") as directory:
        video = Path(directory) / "sample.mp4"
        subprocess.run(
            [
                ffmpeg,
                "-nostdin",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=64x64:d=0.2",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                str(video),
            ],
            check=True,
            timeout=30,
        )
        probe = subprocess.check_output(
            [
                ffprobe,
                "-v",
                "error",
                "-show_streams",
                "-of",
                "json",
                str(video),
            ],
            text=True,
            timeout=20,
        )
        assert json.loads(probe)["streams"][0]["codec_name"] == "h264"
    print(
        json.dumps(
            {"font": "ok", "svg": "ok", "pptx": "ok", "docs": "ok", "ffmpeg": "ok", "ffprobe": "ok"}
        )
    )
