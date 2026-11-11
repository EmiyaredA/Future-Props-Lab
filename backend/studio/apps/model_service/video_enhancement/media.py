"""FFmpeg frame planning and per-segment media I/O."""

import asyncio
import json
import os
import re
import signal
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

CORE_FRAMES = 48
CONTEXT_FRAMES = 8


class MediaError(ValueError):
    pass


async def command(*args):
    process = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    try:
        out, err = await process.communicate()
    except asyncio.CancelledError:
        if process.returncode is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        await process.wait()
        raise
    if process.returncode:
        raise MediaError(err.decode(errors="replace").strip()[-1200:] or "媒体处理失败")
    return out, err


@dataclass(frozen=True)
class Video:
    width: int
    height: int
    fps: str
    frames: int
    offset: float
    audio_codec: str | None

    def seconds(self, frame):
        return float(frame / Fraction(self.fps))

    @property
    def output_size(self):
        if self.width >= self.height:
            return round(540 * self.width / self.height) * 2, 1080
        return 1080, round(540 * self.height / self.width) * 2


def segments(frames, cuts, *, core_frames=CORE_FRAMES):
    boundaries = [0, *sorted({cut for cut in cuts if 0 < cut < frames}), frames]
    return [
        [start, min(start + core_frames, right), left, right]
        for left, right in zip(boundaries[:-1], boundaries[1:], strict=True)
        for start in range(left, right, core_frames)
    ]


def windows(segment, *, reduced=False):
    start, end, scene_start, scene_end = segment
    core = 16 if reduced else CORE_FRAMES
    for first in range(start, end, core):
        last = min(first + core, end)
        yield (
            first,
            last,
            max(scene_start, first - CONTEXT_FRAMES),
            min(scene_end, last + CONTEXT_FRAMES),
        )


async def probe(source):
    out, _ = await command(
        "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", source
    )
    data = json.loads(out)
    streams = data.get("streams", [])
    stream = next(
        (
            item
            for item in streams
            if item["codec_type"] == "video" and not item.get("disposition", {}).get("attached_pic")
        ),
        None,
    )
    if not stream:
        raise MediaError("未找到视频轨")
    if stream.get("color_transfer") in {"smpte2084", "arib-std-b67"}:
        raise MediaError("请选择 SDR 视频")
    if stream.get("sample_aspect_ratio") not in {None, "N/A", "0:1", "1:1"}:
        raise MediaError("请选择方形像素视频")
    width, height = stream["width"], stream["height"]
    for side_data in stream.get("side_data_list", []):
        if abs(side_data.get("rotation", 0)) % 180 == 90:
            width, height = height, width
    if min(width, height) < 16 or max(width, height) > 2048:
        raise MediaError("视频尺寸超出本机增强范围")
    try:
        fps = Fraction(stream["r_frame_rate"])
        time_base = Fraction(stream["time_base"])
    except (KeyError, ValueError, ZeroDivisionError):
        raise MediaError("无法读取视频帧率") from None
    if not 1 <= fps <= 120:
        raise MediaError("无法读取有效的视频帧率")
    out, _ = await command(
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        str(stream["index"]),
        "-show_entries",
        "frame=best_effort_timestamp",
        "-of",
        "json",
        source,
    )
    ticks = [
        int(item["best_effort_timestamp"])
        for item in json.loads(out)["frames"]
        if "best_effort_timestamp" in item
    ]
    if not ticks or any(
        abs((tick - ticks[0]) * time_base - index / fps) > min(time_base, 1 / (4 * fps))
        for index, tick in enumerate(ticks)
    ):
        raise MediaError("请选择恒定帧率视频")
    origin = float(data.get("format", {}).get("start_time", 0))
    video = Video(
        width,
        height,
        str(fps),
        len(ticks),
        max(0.0, float(ticks[0] * time_base) - origin),
        next((item["codec_name"] for item in streams if item["codec_type"] == "audio"), None),
    )
    if max(video.output_size) > 3840:
        raise MediaError("视频画幅超出本机增强范围")
    return video


async def plan(source, video, *, core_frames=CORE_FRAMES):
    _, err = await command(
        "ffmpeg",
        "-nostdin",
        "-loglevel",
        "info",
        "-i",
        source,
        "-map",
        "0:V:0",
        "-an",
        "-vf",
        "setpts=PTS-STARTPTS,scale=320:-2,select=gt(scene\\,0.35),showinfo",
        "-f",
        "null",
        "-",
    )
    cuts = [
        round(float(timestamp) * Fraction(video.fps))
        for timestamp in re.findall(rb"pts_time:([0-9.eE+-]+)", err)
    ]
    return segments(video.frames, cuts, core_frames=core_frames)


async def extract(source, video, start, end, target):
    await command(
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-y",
        "-ss",
        f"{max(0.0, video.offset + video.seconds(start - 0.5)):.9f}",
        "-i",
        source,
        "-map",
        "0:V:0",
        "-frames:v",
        str(end - start),
        "-fps_mode",
        "passthrough",
        "-pix_fmt",
        "rgb24",
        "-c:v",
        "rawvideo",
        "-threads:v",
        "1",
        "-f",
        "rawvideo",
        target,
    )
    if target.stat().st_size != (end - start) * video.width * video.height * 3:
        raise MediaError("提取的帧数与片段计划不一致")


async def encode(raw, source, video, first, last, factor, target):
    width, height = video.output_size
    await command(
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-y",
        "-f",
        "rawvideo",
        "-pixel_format",
        "rgb24",
        "-video_size",
        f"{video.width * factor}x{video.height * factor}",
        "-framerate",
        video.fps,
        "-i",
        raw,
        "-ss",
        f"{video.offset + video.seconds(first):.9f}",
        "-i",
        source,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0?",
        "-t",
        f"{video.seconds(last - first):.9f}",
        "-vf",
        f"scale={width}:{height}:flags=lanczos,setsar=1",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        target,
    )


async def fast_segment(source, video, segment, scratch):
    first, last, *_scene = segment
    width, height = video.output_size
    frames = last - first
    graph = (
        f"[0:V:0]setpts=PTS-STARTPTS,scale={width}:{height}:flags=lanczos,"
        "setsar=1,split[plain][detail];[detail]unsharp=5:5:0.30:5:5:0[sharp]"
    )
    common = (
        "-map",
        "1:a:0?",
        "-frames:v",
        str(frames),
        "-t",
        f"{video.seconds(frames):.9f}",
        "-fps_mode",
        "passthrough",
        "-c:v",
        "h264_videotoolbox",
        "-allow_sw",
        "0",
        "-b:v",
        "10M",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
    )
    original, enhanced = scratch / "original.mp4", scratch / "enhanced.mp4"
    await command(
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-y",
        "-ss",
        f"{max(0.0, video.offset + video.seconds(first - 0.5)):.9f}",
        "-i",
        source,
        "-ss",
        f"{video.offset + video.seconds(first):.9f}",
        "-i",
        source,
        "-filter_complex",
        graph,
        "-map",
        "[plain]",
        *common,
        original,
        "-map",
        "[sharp]",
        *common,
        enhanced,
    )
    await verify(original, video, frames)
    await verify(enhanced, video, frames)


async def verify(path, video, frames):
    out, _ = await command(
        "ffprobe",
        "-v",
        "error",
        "-count_frames",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,nb_read_frames,r_frame_rate",
        "-of",
        "json",
        path,
    )
    stream = next(iter(json.loads(out).get("streams", [])), {})
    if (stream.get("width"), stream.get("height"), stream.get("nb_read_frames")) != (
        *video.output_size,
        str(frames),
    ):
        raise MediaError("生成片段未通过帧数和尺寸校验")
    if Fraction(stream.get("r_frame_rate", "0")) != Fraction(video.fps):
        raise MediaError("生成片段帧率与原视频不一致")
    await command(
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-xerror",
        "-i",
        path,
        "-map",
        "0:v:0",
        "-f",
        "null",
        "-",
    )


async def combine(parts, source, video, target, scratch):
    # Video-only copies prevent per-segment audio durations from offsetting the concat timeline.
    playlist = scratch / "concat.txt"
    lines = []
    for index, (part, frame_count) in enumerate(parts):
        silent = scratch / f"video-{index}.mp4"
        await command(
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-y",
            "-i",
            part,
            "-map",
            "0:v:0",
            "-c",
            "copy",
            silent,
        )
        lines.extend((f"file {silent.name}\n", f"duration {video.seconds(frame_count):.9f}\n"))
    playlist.write_text("".join(lines))
    await command(
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-y",
        "-f",
        "concat",
        "-i",
        playlist,
        "-ss",
        f"{video.offset:.9f}",
        "-i",
        source,
        "-map",
        "0:v:0",
        "-map",
        "1:a?",
        "-c:v",
        "copy",
        "-c:a",
        "copy" if video.audio_codec == "aac" and not video.offset else "aac",
        "-t",
        f"{video.seconds(video.frames):.9f}",
        "-movflags",
        "+faststart",
        target,
    )


def append_frames(source: Path, destination: Path, skip, frames, frame_bytes):
    with source.open("rb") as data, destination.open("ab") as target:
        data.seek(skip * frame_bytes)
        for _ in range(frames):
            frame = data.read(frame_bytes)
            if len(frame) != frame_bytes:
                raise MediaError("超分模型输出帧不完整")
            target.write(frame)
