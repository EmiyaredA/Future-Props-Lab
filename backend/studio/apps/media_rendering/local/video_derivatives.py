"""Deterministic clip probing, preview proxies, thumbnails and waveforms."""

import json
import subprocess
from pathlib import Path

from studio.runtime.files.digests import sha256_file


def probe_media(path: Path) -> dict:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration,format_name:stream=index,codec_type,codec_name,width,height,avg_frame_rate,pix_fmt,nb_frames,sample_rate,channels",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout)
    duration = float((payload.get("format") or {}).get("duration") or 0)
    payload["durationUs"] = max(0, round(duration * 1_000_000))
    return payload


def _run(args: list[str]) -> None:
    try:
        result = subprocess.run(args, check=True, capture_output=True, text=True)
    except FileNotFoundError as exc:
        raise RuntimeError(f"缺少媒体处理程序：{args[0]}") from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError((exc.stderr or "媒体处理失败")[-4000:]) from exc
    if result.returncode:
        raise RuntimeError((result.stderr or "媒体处理失败")[-4000:])


def prepare_media(
    source: Path, asset_id: str, media_kind: str, derived: Path, probe: dict | None = None
) -> tuple[dict, str | None, str | None, str | None, str]:
    fingerprint = sha256_file(source)
    proxy: str | None = None
    thumbnail: str | None = None
    waveform: str | None = None
    if media_kind == "font":
        return {"mediaKind": "font"}, proxy, thumbnail, waveform, fingerprint
    probe = probe if probe is not None else probe_media(source)
    if media_kind == "video":
        video_stream = next(
            (item for item in probe.get("streams", []) if item.get("codec_type") == "video"), {}
        )
        alpha = str(video_stream.get("pix_fmt") or "").startswith(
            ("yuva", "rgba", "bgra", "argb", "abgr")
        )
        proxy = f"{asset_id}-proxy.{'webm' if alpha else 'mp4'}"
        thumbnail = f"{asset_id}-thumbnail.png"
        proxy_args = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(source),
            "-vf",
            "scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2:color=black@0",
        ]
        if alpha:
            proxy_args.extend(
                [
                    "-c:v",
                    "libvpx-vp9",
                    "-crf",
                    "30",
                    "-b:v",
                    "0",
                    "-pix_fmt",
                    "yuva420p",
                    "-auto-alt-ref",
                    "0",
                    "-c:a",
                    "libopus",
                ]
            )
        else:
            proxy_args.extend(
                [
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "24",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-ar",
                    "48000",
                    "-movflags",
                    "+faststart",
                ]
            )
        proxy_args.extend(["-y", str(derived / proxy)])
        _run(proxy_args)
        _run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                "0",
                "-i",
                str(source),
                "-frames:v",
                "1",
                "-vf",
                "scale=480:-2",
                "-y",
                str(derived / thumbnail),
            ]
        )
    elif media_kind == "image":
        thumbnail = f"{asset_id}-thumbnail.png"
        _run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(source),
                "-vf",
                "scale=480:-2",
                "-frames:v",
                "1",
                "-y",
                str(derived / thumbnail),
            ]
        )
    elif media_kind == "audio":
        proxy = f"{asset_id}-proxy.m4a"
        waveform = f"{asset_id}-waveform.png"
        _run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(source),
                "-vn",
                "-c:a",
                "aac",
                "-ar",
                "48000",
                "-b:a",
                "128k",
                "-y",
                str(derived / proxy),
            ]
        )
        _run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(source),
                "-filter_complex",
                "showwavespic=s=1200x160:colors=7c6cff",
                "-frames:v",
                "1",
                "-y",
                str(derived / waveform),
            ]
        )
    return probe, proxy, thumbnail, waveform, fingerprint
