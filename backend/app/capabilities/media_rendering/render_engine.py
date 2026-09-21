from __future__ import annotations

import json
import os
import select
import signal
import subprocess
import threading
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import BinaryIO

from PIL import Image

from app.capabilities.media_rendering.contracts import RenderCaptureFrame, RenderPlan
from app.capabilities.media_rendering.evaluator import FrameSource, TimelineFrameRenderer
from app.capabilities.media_rendering.presets import RENDER_PRESETS
from app.capabilities.media_rendering.speed import audio_speed_filters, source_time_us
from app.capabilities.media_rendering.timeline_document import (
    VideoEditorClip,
    VideoEditorTimelineDocument,
)


class RenderCancelled(RuntimeError):
    pass


@lru_cache(maxsize=128)
def _has_audio_stream(path: str) -> bool:
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=index",
                "-of",
                "json",
                path,
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        return bool(json.loads(result.stdout).get("streams"))
    except (OSError, subprocess.CalledProcessError, ValueError, json.JSONDecodeError):
        return False


@lru_cache(maxsize=128)
def _video_dimensions(path: str) -> tuple[int, int] | None:
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height",
                "-of",
                "json",
                path,
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        stream = (json.loads(result.stdout).get("streams") or [{}])[0]
        width = int(stream.get("width") or 0)
        height = int(stream.get("height") or 0)
        return (width, height) if width > 0 and height > 0 else None
    except (OSError, subprocess.CalledProcessError, ValueError, TypeError, json.JSONDecodeError):
        return None


def _terminate_process_group(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()


def _read_exact(
    stream: BinaryIO,
    size: int,
    *,
    cancel: threading.Event,
) -> bytes:
    descriptor = stream.fileno()
    was_blocking = os.get_blocking(descriptor)
    if was_blocking:
        os.set_blocking(descriptor, False)
    chunks = bytearray()
    try:
        while len(chunks) < size:
            if cancel.is_set():
                raise RenderCancelled("渲染已取消")
            readable, _, _ = select.select([descriptor], [], [], 0.1)
            if not readable:
                continue
            try:
                chunk = os.read(descriptor, size - len(chunks))
            except BlockingIOError:
                continue
            if not chunk:
                break
            chunks.extend(chunk)
    finally:
        if was_blocking:
            os.set_blocking(descriptor, True)
    return bytes(chunks)


def _write_all(
    stream: BinaryIO,
    payload: bytes,
    *,
    cancel: threading.Event,
) -> None:
    descriptor = stream.fileno()
    was_blocking = os.get_blocking(descriptor)
    if was_blocking:
        os.set_blocking(descriptor, False)
    view = memoryview(payload)
    written = 0
    try:
        while written < len(view):
            if cancel.is_set():
                raise RenderCancelled("渲染已取消")
            _, writable, _ = select.select([], [descriptor], [], 0.1)
            if not writable:
                continue
            try:
                count = os.write(descriptor, view[written:])
            except BlockingIOError:
                continue
            if count <= 0:
                raise BrokenPipeError("画面编码器已关闭输入管道")
            written += count
    finally:
        if was_blocking:
            os.set_blocking(descriptor, True)


def _wait_for_process(
    process: subprocess.Popen[bytes],
    *,
    cancel: threading.Event,
) -> int:
    while True:
        if cancel.is_set():
            _terminate_process_group(process)
            raise RenderCancelled("渲染已取消")
        try:
            return process.wait(timeout=0.1)
        except subprocess.TimeoutExpired:
            continue


def _run(args: list[str], *, cancel: threading.Event) -> None:
    process = subprocess.Popen(
        args,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    while process.poll() is None:
        if cancel.wait(0.1):
            _terminate_process_group(process)
            raise RenderCancelled("渲染已取消")
    if process.returncode:
        stderr = (process.stderr.read() if process.stderr else b"").decode(errors="replace")
        raise RuntimeError(stderr[-4000:] or "FFmpeg 执行失败")


# Coarse input seek lands near a keyframe; fine output seek then positions exactly.
_DECODER_SEEK_PREROLL_US = 10_000_000


def _decoder_seek_args(source_us: int, *, preroll_us: int = _DECODER_SEEK_PREROLL_US) -> list[str]:
    """Build ffmpeg seek args: optional coarse -ss before -i, accurate -ss after -i."""
    target = max(0, source_us)
    if target <= 0:
        return ["-i"]
    coarse = max(0, target - max(0, preroll_us))
    fine = target - coarse
    args: list[str] = []
    if coarse > 0:
        args.extend(["-ss", f"{coarse / 1_000_000:.6f}"])
    args.append("-i")
    if fine > 0:
        args.extend(["-ss", f"{fine / 1_000_000:.6f}"])
    return args


class _VideoDecoder:
    def __init__(
        self,
        path: Path,
        source_us: int,
        fps: int,
        canvas_size: tuple[int, int],
        cancel: threading.Event,
        playback_rate: float = 1,
        *,
        local_us: int = 0,
    ) -> None:
        self.width, self.height = _video_dimensions(str(path)) or canvas_size
        self.cancel = cancel
        # Clip-local time of the last frame returned by next()/frame_at().
        self.local_us = local_us
        seek_args = _decoder_seek_args(source_us)
        # Insert the input path after the "-i" placeholder from seek args.
        command = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            *seek_args,
            "-an",
            "-vf",
            f"setpts=(PTS-STARTPTS)/{playback_rate:.8g},fps={fps},format=rgba",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            "pipe:1",
        ]
        input_index = command.index("-i") + 1
        command.insert(input_index, str(path))
        self.process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
        self.last: Image.Image | None = None

    def next(self) -> Image.Image | None:
        assert self.process.stdout is not None
        size = self.width * self.height * 4
        data = _read_exact(self.process.stdout, size, cancel=self.cancel)
        if len(data) == size:
            self.last = Image.frombytes("RGBA", (self.width, self.height), data)
        return self.last.copy() if self.last else None

    def close(self) -> None:
        _terminate_process_group(self.process)


def _decoder_request_action(
    decoder_local_us: int | None,
    requested_local_us: int,
    frame_us: int,
) -> tuple[str, int]:
    """Map a clip-local frame request onto open / hold / advance for a pipe decoder.

    Returns (action, value):
    - ("open", at_us): recreate the decoder so its first frame is at_us
    - ("hold", 0): reuse the last emitted frame
    - ("advance", steps): call next() `steps` times (steps >= 1)
    """
    requested = max(0, requested_local_us)
    step = max(1, frame_us)
    if decoder_local_us is None or requested < decoder_local_us:
        return ("open", requested)
    if requested <= decoder_local_us:
        return ("hold", 0)
    steps = max(1, round((requested - decoder_local_us) / step))
    return ("advance", steps)


def _render_segment(
    document: VideoEditorTimelineDocument,
    asset_paths: dict[str, Path],
    output: Path,
    *,
    preset: str,
    range_start_us: int,
    first_frame: int,
    frame_count: int,
    total_frames: int,
    cancel: threading.Event,
    progress: Callable[[int], None],
    capture_frame: RenderCaptureFrame,
) -> None:
    width, height, fps = RENDER_PRESETS[preset]
    canvas_size = (document.settings.width, document.settings.height)
    frame_us = max(1, round(1_000_000 / fps))
    decoders: dict[str, _VideoDecoder] = {}
    image_cache: dict[str, Image.Image] = {}

    def image_for_clip(clip: VideoEditorClip, local_us: int) -> Image.Image | None:
        path = asset_paths.get(clip.asset_id or "")
        if path is None:
            return None
        if clip.kind == "image":
            if clip.id not in image_cache:
                with Image.open(path) as source:
                    image_cache[clip.id] = source.convert("RGBA")
            return image_cache[clip.id].copy()
        if clip.kind == "video":
            requested = max(0, local_us)
            decoder = decoders.get(clip.id)
            action, value = _decoder_request_action(
                None if decoder is None else decoder.local_us,
                requested,
                frame_us,
            )
            if action == "open":
                if decoder is not None:
                    decoder.close()
                decoder = _VideoDecoder(
                    path,
                    source_time_us(clip, value),
                    fps,
                    canvas_size,
                    cancel,
                    clip.playback_rate or 1,
                    local_us=value,
                )
                decoders[clip.id] = decoder
                return decoder.next()
            if action == "hold":
                return decoder.last.copy() if decoder and decoder.last else None
            assert decoder is not None
            image: Image.Image | None = None
            for _ in range(value):
                image = decoder.next()
                if image is None:
                    break
                decoder.local_us += frame_us
            # Snap the cursor to the requested time so repeated holds and the next
            # monotonic step stay aligned with evaluator local_us (incl. continuity).
            decoder.local_us = requested
            return image if image is not None else (
                decoder.last.copy() if decoder.last else None
            )
        return None

    renderer = TimelineFrameRenderer(
        document,
        FrameSource(
            image_for_clip=image_for_clip,
            font_for_clip=lambda clip: asset_paths.get(clip.font_asset_id or ""),
        ),
    )
    encoder = subprocess.Popen(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-s",
            f"{width}x{height}",
            "-r",
            str(fps),
            "-i",
            "pipe:0",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-r",
            str(fps),
            "-g",
            str(fps * 2),
            "-video_track_timescale",
            "90000",
            "-y",
            str(output),
        ],
        stdin=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    try:
        assert encoder.stdin is not None
        for offset in range(frame_count):
            if cancel.is_set():
                raise RenderCancelled("渲染已取消")
            frame_number = first_frame + offset
            time_us = range_start_us + round(frame_number * 1_000_000 / fps)
            frame = renderer.render(time_us)
            frame = frame.crop(
                (
                    capture_frame.x,
                    capture_frame.y,
                    capture_frame.x + capture_frame.width,
                    capture_frame.y + capture_frame.height,
                )
            ).resize((width, height), Image.Resampling.LANCZOS)
            _write_all(encoder.stdin, frame.tobytes(), cancel=cancel)
            if frame_number % max(1, fps // 2) == 0:
                progress(round((frame_number + 1) / max(1, total_frames) * 82))
        encoder.stdin.close()
        return_code = _wait_for_process(encoder, cancel=cancel)
        if return_code:
            stderr = (encoder.stderr.read() if encoder.stderr else b"").decode(errors="replace")
            raise RuntimeError(stderr[-4000:] or "画面编码失败")
    except Exception as exc:
        _terminate_process_group(encoder)
        if cancel.is_set() and not isinstance(exc, RenderCancelled):
            raise RenderCancelled("渲染已取消") from exc
        raise
    finally:
        if encoder.stdin is not None and not encoder.stdin.closed:
            try:
                encoder.stdin.close()
            except OSError:
                pass
        for decoder in decoders.values():
            decoder.close()


def _volume_expression(clip: VideoEditorClip, clip_local_start_us: int) -> str:
    keys = sorted(
        (key for key in clip.keyframes if key.property == "volume"), key=lambda key: key.time_us
    )
    if not keys:
        return f"{clip.volume:.6f}"
    values: list[str] = []
    for index, left in enumerate(keys[:-1]):
        right = keys[index + 1]
        start = (left.time_us - clip_local_start_us) / 1_000_000
        stop = (right.time_us - clip_local_start_us) / 1_000_000
        duration = max(0.000001, stop - start)
        expression = f"{left.value}+({right.value - left.value})*(t-{start})/{duration}"
        values.append(f"if(between(t,{start},{stop}),{expression},")
    return "".join(values) + f"{keys[-1].value}" + ")" * len(values)


def _mux_audio(
    document: VideoEditorTimelineDocument,
    asset_paths: dict[str, Path],
    video_path: Path,
    output_path: Path,
    *,
    start_us: int,
    end_us: int,
    cancel: threading.Event,
) -> None:
    duration = (end_us - start_us) / 1_000_000
    audio_clips = [
        clip
        for track in document.tracks
        if track.kind in {"audio", "mixed"} and not track.muted
        for clip in track.clips
        if clip.timeline_start_us < end_us
        and clip.timeline_start_us + clip.duration_us > start_us
        and clip.asset_id in asset_paths
        and not clip.muted
        and (track.kind == "audio" or clip.kind == "video")
        and _has_audio_stream(str(asset_paths[clip.asset_id or ""]))
    ]
    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(video_path)]
    filters: list[str] = []
    labels: list[str] = []
    for index, clip in enumerate(audio_clips, start=1):
        intersection_start = max(start_us, clip.timeline_start_us)
        intersection_end = min(end_us, clip.timeline_start_us + clip.duration_us)
        source_start = source_time_us(clip, intersection_start - clip.timeline_start_us)
        clip_duration = (intersection_end - intersection_start) / 1_000_000
        playback_rate = clip.playback_rate or 1
        source_duration = clip_duration * playback_rate
        input_args = [
            *(["-stream_loop", "-1"] if clip.source_loop else []),
            "-ss",
            f"{source_start / 1_000_000:.6f}",
            "-t",
            f"{source_duration:.6f}",
            "-i",
            str(asset_paths[clip.asset_id or ""]),
        ]
        args.extend(input_args)
        delay_ms = round((intersection_start - start_us) / 1000)
        volume = _volume_expression(clip, intersection_start - clip.timeline_start_us)
        chain = [
            f"[{index}:a]atrim=start=0:end={source_duration:.6f}",
            "asetpts=PTS-STARTPTS",
            *audio_speed_filters(playback_rate),
            "aresample=48000",
            f"volume='{volume}':eval=frame",
        ]
        if (
            clip.transition_in
            and clip.transition_in.kind == "audio-crossfade"
            and clip.transition_in.duration_us > 0
        ):
            chain.append(f"afade=t=in:st=0:d={clip.transition_in.duration_us / 1_000_000:.6f}")
        if (
            clip.transition_out
            and clip.transition_out.kind == "audio-crossfade"
            and clip.transition_out.duration_us > 0
        ):
            fade_start = max(0, clip_duration - clip.transition_out.duration_us / 1_000_000)
            fade_duration = clip.transition_out.duration_us / 1_000_000
            chain.append(f"afade=t=out:st={fade_start:.6f}:d={fade_duration:.6f}")
        chain.append(f"adelay={delay_ms}:all=1[a{index}]")
        filters.append(",".join(chain))
        labels.append(f"[a{index}]")
    if labels:
        filters.append(
            f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0:duration=longest,"
            f"atrim=start=0:end={duration:.6f},asetpts=PTS-STARTPTS[aout]"
        )
        args.extend(["-filter_complex", ";".join(filters), "-map", "0:v:0", "-map", "[aout]"])
    else:
        args.extend(
            [
                "-f",
                "lavfi",
                "-t",
                f"{duration:.6f}",
                "-i",
                "anullsrc=r=48000:cl=stereo",
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
            ]
        )
    args.extend(
        [
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-ar",
            "48000",
            "-b:a",
            "192k",
            "-t",
            f"{duration:.6f}",
            "-movflags",
            "+faststart",
            "-y",
            str(output_path),
        ]
    )
    _run(args, cancel=cancel)


def render_document(
    document: VideoEditorTimelineDocument,
    asset_paths: dict[str, Path],
    output_path: Path,
    *,
    preset: str,
    start_us: int,
    end_us: int,
    cancel: threading.Event,
    progress: Callable[[int], None],
    capture_frame: RenderCaptureFrame = RenderCaptureFrame(),
) -> None:
    _width, _height, fps = RENDER_PRESETS[preset]
    total_frames = round((end_us - start_us) / 1_000_000 * fps)
    with TemporaryDirectory(prefix="video-editor-render-") as temp:
        root = Path(temp)
        # One continuous encode: internal 30s chunk+concat restarted decoders with
        # input-side -ss, which jumped back ~1 GOP at each boundary (e.g. 2:00).
        silent_video = root / "picture.mp4"
        _render_segment(
            document,
            asset_paths,
            silent_video,
            preset=preset,
            range_start_us=start_us,
            first_frame=0,
            frame_count=total_frames,
            total_frames=total_frames,
            cancel=cancel,
            progress=progress,
            capture_frame=capture_frame,
        )
        progress(88)
        _mux_audio(
            document,
            asset_paths,
            silent_video,
            output_path,
            start_us=start_us,
            end_us=end_us,
            cancel=cancel,
        )
        progress(96)


def render_plan(
    plan: RenderPlan,
    output_path: Path,
    *,
    preset: str,
    start_us: int,
    end_us: int,
    cancel: threading.Event,
    progress: Callable[[int], None],
) -> None:
    render_document(
        plan.document,
        plan.asset_paths,
        output_path,
        preset=preset,
        start_us=start_us,
        end_us=end_us,
        cancel=cancel,
        progress=progress,
        capture_frame=plan.capture_frame,
    )
