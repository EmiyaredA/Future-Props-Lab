from __future__ import annotations

import hashlib
import json
import math
import os
import signal
import subprocess
import sys
import threading
from array import array
from bisect import bisect_right
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ANALYSIS_VERSION = "galgame-audio-envelope-v2-30hz"
SAMPLE_RATE = 48_000
HOP_US = 33_334
MIN_DECIBELS = -100.0
MOUTH_PATTERNS = {
    1: (1, 1, 0),
    2: (1, 2, 2, 1, 0),
}
RELEASE_HOLD_US = 180_000


@dataclass(frozen=True)
class AudioEnvelope:
    hop_us: int
    levels_db: tuple[float, ...]

    def level_at(self, time_us: int) -> float:
        if not self.levels_db:
            return MIN_DECIBELS
        index = max(0, min(len(self.levels_db) - 1, time_us // self.hop_us))
        return self.levels_db[index]


@dataclass(frozen=True)
class LipSyncSchedule:
    events: dict[tuple[str, str], tuple[tuple[int, int], ...]]

    def frame_at(self, character_id: str, expression_id: str, time_us: int) -> int:
        values = self.events.get((character_id, expression_id)) or self.events.get(
            (character_id, "*"), ()
        )
        index = bisect_right(values, (time_us, 3)) - 1
        return values[index][1] if index >= 0 else 0

    def boundaries(
        self, character_id: str, expression_id: str, start_us: int, end_us: int
    ) -> list[int]:
        values = self.events.get((character_id, expression_id)) or self.events.get(
            (character_id, "*"), ()
        )
        return [time_us for time_us, _frame in values if start_us < time_us < end_us]


class _LipTracker:
    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.noise_floor_db = -48.0
        self.frame = 0
        self.voiced_started_at_us: int | None = None
        self.last_voiced_at_us: int | None = None
        self.opening = 0

    def update(self, level_db: float, speaking: bool, now_us: int, fps: int) -> int:
        if not speaking:
            sample = max(MIN_DECIBELS, min(-12.0, level_db))
            self.noise_floor_db = self.noise_floor_db * 0.9 + sample * 0.1
            self.frame = 0
            self.voiced_started_at_us = None
            return 0
        above_noise = level_db - self.noise_floor_db
        detected = 2 if above_noise >= 11 else (1 if above_noise >= 5 else 0)
        if detected == 0:
            self.noise_floor_db = self.noise_floor_db * 0.98 + min(-12.0, level_db) * 0.02
        if detected > 0:
            self.opening = detected
            self.last_voiced_at_us = now_us
        elif self.last_voiced_at_us is None or now_us - self.last_voiced_at_us > RELEASE_HOLD_US:
            self.opening = 0
        opening = self.opening
        if opening == 0:
            self.frame = 0
            self.voiced_started_at_us = None
            return 0
        if self.voiced_started_at_us is None:
            self.voiced_started_at_us = now_us
        bounded_fps = max(1, min(60, fps))
        elapsed_us = max(0, now_us - self.voiced_started_at_us)
        cadence = (elapsed_us * bounded_fps + 500_000) // 1_000_000
        pattern = MOUTH_PATTERNS[opening]
        self.frame = pattern[cadence % len(pattern)]
        return self.frame


def _read_exact(stream: Any, size: int, cancel: threading.Event | None) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining > 0:
        if cancel and cancel.is_set():
            break
        chunk = stream.read(remaining)
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def analyze_audio_envelope(path: Path, *, cancel: threading.Event | None = None) -> AudioEnvelope:
    process = subprocess.Popen(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "-f",
            "f32le",
            "pipe:1",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    hop_samples = round(SAMPLE_RATE * HOP_US / 1_000_000)
    levels: list[float] = []
    try:
        assert process.stdout is not None
        while True:
            payload = _read_exact(process.stdout, hop_samples * 4, cancel)
            if cancel and cancel.is_set():
                raise InterruptedError("口型音频分析已取消")
            if not payload:
                break
            usable = len(payload) - len(payload) % 4
            samples = array("f")
            samples.frombytes(payload[:usable])
            if sys.byteorder != "little":
                samples.byteswap()
            rms = math.sqrt(sum(value * value for value in samples) / max(1, len(samples)))
            levels.append(max(MIN_DECIBELS, 20 * math.log10(max(rms, 0.00001))))
            if len(payload) < hop_samples * 4:
                break
        return_code = process.wait()
        if return_code:
            error = (process.stderr.read() if process.stderr else b"").decode(errors="replace")
            raise RuntimeError(error[-2000:] or f"无法分析音频 {path.name}")
    except Exception:
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            process.wait()
        raise
    return AudioEnvelope(hop_us=HOP_US, levels_db=tuple(levels))


def _audio_file_ids(
    document: dict[str, Any], selected_fragment_ids: set[str] | None = None
) -> set[str]:
    logical_files = {
        str(item.get("id")): str(item.get("fileId"))
        for item in document.get("assets", [])
        if item.get("fileId")
    }
    logical_ids: set[str] = set()
    for chapter in document.get("chapters", []):
        for fragment in chapter.get("fragments", []):
            if selected_fragment_ids and fragment.get("id") not in selected_fragment_ids:
                continue
            master = (fragment.get("timeline") or {}).get("masterAudio") or {}
            if master.get("assetId"):
                logical_ids.add(str(master["assetId"]))
                continue
            for block in fragment.get("blocks", []):
                if block.get("type") == "dialogue" and block.get("voiceAssetId"):
                    logical_ids.add(str(block["voiceAssetId"]))
    return {logical_files[item] for item in logical_ids if item in logical_files}


def prepare_audio_envelopes(
    document: dict[str, Any],
    asset_paths: dict[str, Path],
    *,
    cache_dir: Path | None = None,
    asset_fingerprints: dict[str, str] | None = None,
    selected_fragment_ids: set[str] | None = None,
    cancel: threading.Event | None = None,
) -> dict[str, AudioEnvelope]:
    if cache_dir is not None:
        cache_dir.mkdir(parents=True, exist_ok=True)
    result: dict[str, AudioEnvelope] = {}
    for file_id in sorted(_audio_file_ids(document, selected_fragment_ids)):
        if cancel and cancel.is_set():
            raise InterruptedError("口型音频分析已取消")
        path = asset_paths.get(file_id)
        if path is None or not path.is_file():
            raise RuntimeError(f"口型引用的音频素材 {file_id} 不存在")
        fingerprint = (asset_fingerprints or {}).get(file_id) or (
            f"{path.resolve()}:{path.stat().st_size}:{path.stat().st_mtime_ns}"
        )
        key = hashlib.sha256(f"{ANALYSIS_VERSION}:{fingerprint}".encode()).hexdigest()
        cache_path = cache_dir / f"{key}.json" if cache_dir is not None else None
        if cache_path is not None and cache_path.is_file():
            try:
                cached = json.loads(cache_path.read_text(encoding="utf-8"))
                result[file_id] = AudioEnvelope(
                    hop_us=int(cached["hopUs"]),
                    levels_db=tuple(float(value) for value in cached["levelsDb"]),
                )
                continue
            except (OSError, ValueError, KeyError, TypeError):
                cache_path.unlink(missing_ok=True)
        envelope = analyze_audio_envelope(path, cancel=cancel)
        result[file_id] = envelope
        if cache_path is not None:
            temporary = cache_path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
            try:
                temporary.write_text(
                    json.dumps(
                        {"hopUs": envelope.hop_us, "levelsDb": envelope.levels_db},
                        separators=(",", ":"),
                    ),
                    encoding="utf-8",
                )
                os.replace(temporary, cache_path)
            finally:
                temporary.unlink(missing_ok=True)
    return result


def _expression(character: dict[str, Any], expression_id: str) -> dict[str, Any] | None:
    return next(
        (item for item in character.get("expressions", []) if item.get("id") == expression_id),
        None,
    )


def _lip_fps(character: dict[str, Any], expression_id: str) -> int:
    expression = _expression(character, expression_id) or {}
    sequence = expression.get("sequence") or {}
    if (
        expression.get("renderMode") == "frameSequence"
        and sequence.get("playbackMode") == "lipSync"
    ):
        return int(sequence.get("fps", 10))
    return 2


def build_lip_sync_schedule(
    document: dict[str, Any],
    fragment: dict[str, Any],
    events: list[tuple[int, int, str, dict[str, Any]]],
    *,
    duration_us: int,
    logical_files: dict[str, str],
    envelopes: dict[str, AudioEnvelope],
) -> LipSyncSchedule:
    stage_style = (document.get("presentation") or {}).get("stage") or {}
    if not bool(stage_style.get("lipSyncEnabled", True)):
        return LipSyncSchedule(events={})
    characters = {item["id"]: item for item in document.get("characters", [])}
    endings = {
        str(block.get("id")): time_ms * 1000
        for time_ms, _priority, action, block in events
        if action == "content-end"
    }
    dialogues: list[tuple[int, int, dict[str, Any]]] = []
    for time_ms, _priority, action, block in events:
        if action != "content-start" or block.get("type") != "dialogue":
            continue
        end_us = endings.get(str(block.get("id")), time_ms * 1000)
        dialogues.append((time_ms * 1000, end_us, block))
    master = (fragment.get("timeline") or {}).get("masterAudio") or {}
    master_file = logical_files.get(str(master.get("assetId") or ""))
    master_envelope = envelopes.get(master_file or "")
    checkpoints = set(range(0, max(0, duration_us) + HOP_US, HOP_US))
    for start_us, end_us, _block in dialogues:
        checkpoints.update((start_us, end_us))
    tracker = _LipTracker()
    current_identity: tuple[str, str] | None = None
    current_keys: tuple[tuple[str, str], ...] = ()
    current_frame = 0
    output: dict[tuple[str, str], list[tuple[int, int]]] = {}

    def publish(identity: tuple[str, str], time_us: int, frame: int) -> None:
        values = output.setdefault(identity, [])
        if values and values[-1][1] == frame:
            return
        values.append((max(0, time_us), frame))

    for time_us in sorted(time for time in checkpoints if 0 <= time <= duration_us):
        active = next(
            (
                block
                for start_us, end_us, block in reversed(dialogues)
                if start_us <= time_us < end_us
            ),
            None,
        )
        if active is None:
            if current_frame != 0:
                for key in current_keys:
                    publish(key, time_us, 0)
            current_identity = None
            current_keys = ()
            current_frame = tracker.update(
                master_envelope.level_at(time_us) if master_envelope else MIN_DECIBELS,
                False,
                time_us,
                12,
            )
            continue
        character_id = str(active.get("characterId") or "")
        character = characters.get(character_id) or {}
        expression_id = str(
            active.get("expressionId") or character.get("defaultExpressionId") or ""
        )
        identity = (character_id, expression_id)
        speaker_ids = tuple(
            str(value) for value in (active.get("speakerIds") or [character_id]) if value
        )
        keys = tuple(
            (speaker_id, expression_id if speaker_id == character_id else "*")
            for speaker_id in speaker_ids
        )
        if identity != current_identity:
            if current_frame != 0:
                for key in current_keys:
                    publish(key, time_us, 0)
            tracker.reset()
            current_identity = identity
        current_keys = keys
        if master_envelope is not None:
            level = master_envelope.level_at(time_us)
            speaking = True
        else:
            voice_file = logical_files.get(str(active.get("voiceAssetId") or ""))
            envelope = envelopes.get(voice_file or "")
            start_us = next(
                start
                for start, end, block in dialogues
                if block is active and start <= time_us < end
            )
            level = envelope.level_at(time_us - start_us) if envelope else MIN_DECIBELS
            speaking = envelope is not None
        frame = tracker.update(level, speaking, time_us, _lip_fps(character, expression_id))
        for key in keys:
            publish(key, time_us, frame)
        current_frame = frame
    if current_frame != 0:
        for key in current_keys:
            publish(key, duration_us, 0)
    return LipSyncSchedule(events={key: tuple(values) for key, values in output.items()})
