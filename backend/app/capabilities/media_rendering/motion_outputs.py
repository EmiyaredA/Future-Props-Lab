"""Deterministic Motion frame assembly and delivery formats."""

import subprocess
import zipfile
from collections.abc import Awaitable, Callable, Sequence
from functools import partial
from pathlib import Path
from tempfile import TemporaryDirectory

from anyio.to_thread import run_sync
from PIL import Image

from .motion_document import MotionComposition
from .motion_frames import MotionFrameRenderer

OUTPUT_NAMES = {
    "mp4": "composition.mp4",
    "mov4444": "composition-alpha.mov",
    "png-sequence": "frames-alpha.zip",
}


def encode_video(frames: Path, output: Path, fps: int, format_name: str) -> None:
    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-framerate", str(fps), "-i"]
    args.append(str(frames / ("rgb-%06d.png" if format_name == "mp4" else "alpha-%06d.png")))
    if format_name == "mp4":
        args.extend(
            [
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "18",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
            ]
        )
    else:
        args.extend(
            [
                "-an",
                "-c:v",
                "prores_ks",
                "-profile:v",
                "4444",
                "-pix_fmt",
                "yuva444p10le",
                "-alpha_bits",
                "16",
            ]
        )
    args.extend(["-y", str(output)])
    result = subprocess.run(args, capture_output=True, text=True, check=False)
    if result.returncode:
        raise RuntimeError((result.stderr or "视频编码失败")[-2000:])


def save_frames(renderer, frame_number, frames, index, *, alpha, rgb):
    with renderer.render(frame_number) as image:
        if alpha:
            image.save(frames / f"alpha-{index:06d}.png")
        if rgb:
            with Image.new(
                "RGB", image.size, renderer.document.settings.background_color
            ) as opaque:
                opaque.paste(image, mask=image.getchannel("A"))
                opaque.save(frames / f"rgb-{index:06d}.png")


def zip_frames(frames, output):
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(frames.glob("alpha-*.png")):
            archive.write(path, path.name)


async def render_outputs(
    document: MotionComposition,
    sources: dict[str, Path],
    target: Path,
    *,
    start: int,
    end: int,
    formats: Sequence[str],
    cancelled: Callable[[], Awaitable[bool]],
    progress: Callable[[int], Awaitable[None]],
) -> dict[str, str] | None:
    """Render into caller-owned staging. A cancelled caller must discard staged output."""
    renderer = MotionFrameRenderer(document, sources)
    alpha = any(name != "mp4" for name in formats)
    rgb = "mp4" in formats
    outputs = {}
    with TemporaryDirectory(dir=target.parent, prefix="motion-render-") as temporary:
        frames = Path(temporary)
        for index, frame_number in enumerate(range(start, end)):
            if await cancelled():
                return None
            await run_sync(
                partial(save_frames, renderer, frame_number, frames, index, alpha=alpha, rgb=rgb)
            )
            if index % max(1, document.settings.fps // 2) == 0:
                await progress(round((index + 1) / (end - start) * 78))
        target.mkdir(parents=True, exist_ok=True)
        for index, format_name in enumerate(formats):
            if await cancelled():
                return None
            filename = OUTPUT_NAMES[format_name]
            output = target / filename
            if format_name == "png-sequence":
                await run_sync(zip_frames, frames, output)
            else:
                await run_sync(encode_video, frames, output, document.settings.fps, format_name)
            outputs[format_name] = filename
            await progress(78 + round((index + 1) / len(formats) * 21))
    return None if await cancelled() else outputs
