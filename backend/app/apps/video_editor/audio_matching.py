"""Read-only music seam suggestions from a project's source audio."""

from __future__ import annotations

import asyncio
import subprocess
from math import floor
from pathlib import Path

import numpy as np
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.video_editor.audio_seam_edit import audio_seam_pair
from app.apps.video_editor.errors import VideoEditorValidationError
from app.apps.video_editor.media import VideoEditorMedia
from app.apps.video_editor.schemas.audio_seam import (
    AudioSeamCandidateOut,
    AudioSeamCandidatesIn,
    AudioSeamCandidatesOut,
)
from app.apps.video_editor.timeline import VideoEditorTimelines
from app.runtime.revisions import RevisionConflictError

SAMPLE_RATE = 11_025
HOP = 512
WINDOW = 2048
MAX_DURATION_US = 30 * 60 * 1_000_000
REFERENCE_US = 2_000_000
MIN_SPACING_US = 1_000_000


def _decode(path: Path, duration_us: int) -> np.ndarray:
    if not path.is_file():
        raise VideoEditorValidationError("源音频文件不存在", code="audio_source_missing")
    if duration_us <= REFERENCE_US or duration_us > MAX_DURATION_US:
        raise VideoEditorValidationError(
            "音频需长于 2 秒且不超过 30 分钟", code="audio_duration_unsupported"
        )
    try:
        result = subprocess.run(
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
                "-t",
                "1801",
                "-f",
                "f32le",
                "pipe:1",
            ],
            check=True,
            capture_output=True,
            timeout=120,
        )
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise VideoEditorValidationError("音频分析解码失败", code="audio_decode_failed") from exc
    samples = np.frombuffer(result.stdout, dtype="<f4")
    if samples.size > SAMPLE_RATE * 60 * 30 + SAMPLE_RATE or samples.size < SAMPLE_RATE * 2:
        raise VideoEditorValidationError(
            "音频时长不适合接点分析", code="audio_duration_unsupported"
        )
    return samples


def _features(samples: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """RMS, normalized log-frequency energy, and positive spectral change."""
    count = 1 + max(0, (samples.size - WINDOW) // HOP)
    rms = np.empty(count, dtype=np.float32)
    bands = np.empty((count, 8), dtype=np.float32)
    flux = np.empty(count, dtype=np.float32)
    edges = np.geomspace(80, SAMPLE_RATE / 2, 9)
    bins = np.fft.rfftfreq(WINDOW, 1 / SAMPLE_RATE)
    band_slices = [np.flatnonzero((bins >= edges[i]) & (bins < edges[i + 1])) for i in range(8)]
    taper = np.hanning(WINDOW).astype(np.float32)
    previous: np.ndarray | None = None
    for index in range(count):
        frame = samples[index * HOP : index * HOP + WINDOW]
        rms[index] = np.sqrt(np.mean(frame * frame))
        spectrum = np.abs(np.fft.rfft(frame * taper)).astype(np.float32)
        energies = np.array([np.mean(spectrum[part]) if part.size else 0 for part in band_slices])
        bands[index] = energies / max(float(np.sum(energies)), 1e-6)
        flux[index] = 0 if previous is None else np.mean(np.maximum(0, spectrum - previous))
        previous = spectrum
    return rms, bands, flux


def _peaks(samples: np.ndarray, start_us: int, duration_us: int = REFERENCE_US) -> list[float]:
    start = max(0, floor(start_us * SAMPLE_RATE / 1_000_000))
    end = min(samples.size, start + floor(duration_us * SAMPLE_RATE / 1_000_000))
    if end <= start:
        return []
    chunks = np.array_split(np.abs(samples[start:end]), 64)
    return [round(float(np.max(chunk)) if chunk.size else 0, 3) for chunk in chunks]


def rank_audio_seams(
    samples: np.ndarray,
    *,
    reference_end_us: int,
    search_start_us: int,
    search_end_us: int,
    rate: float,
) -> tuple[int, list[AudioSeamCandidateOut]]:
    reference_start = max(0, reference_end_us - REFERENCE_US)
    rms, bands, flux = _features(samples)
    start_index = min(len(rms) - 1, floor(reference_start * SAMPLE_RATE / 1_000_000 / HOP))
    window_frames = min(
        1 + floor(REFERENCE_US * SAMPLE_RATE / 1_000_000 / HOP), len(rms) - start_index
    )
    if window_frames < 8:
        return reference_start, []
    ref_rms = rms[start_index : start_index + window_frames]
    ref_bands = bands[start_index : start_index + window_frames]
    ref_flux = flux[start_index : start_index + window_frames]
    ref_loudness = float(np.mean(ref_rms[-6:]))
    if ref_loudness < 0.002:
        return reference_start, []
    ref_timbre = np.mean(ref_bands[-6:], axis=0)
    ref_rhythm = ref_flux / max(float(np.max(ref_flux)), 1e-6)
    ref_envelope = ref_rms / max(float(np.max(ref_rms)), 1e-6)
    ranked: list[tuple[float, int, str, int]] = []
    last = min(
        len(rms) - window_frames,
        floor(search_end_us * SAMPLE_RATE / 1_000_000 / HOP) - window_frames,
    )
    first = max(0, floor(search_start_us * SAMPLE_RATE / 1_000_000 / HOP))
    for index in range(first, last + 1, 2):
        candidate_us = round(index * HOP / SAMPLE_RATE * 1_000_000)
        if abs(candidate_us - reference_end_us) < MIN_SPACING_US:
            continue
        local_rms = rms[index : index + window_frames]
        if np.count_nonzero(local_rms > 0.002) < window_frames * 0.65:
            continue
        local_flux = flux[index : index + window_frames]
        local_bands = bands[index : index + window_frames]
        loudness = float(np.mean(local_rms[:6]))
        if max(ref_loudness, loudness) < 0.002:
            continue
        loudness_distance = abs(np.log((loudness + 1e-4) / (ref_loudness + 1e-4)))
        timbre_distance = float(np.mean(np.abs(np.mean(local_bands[:6], axis=0) - ref_timbre)))
        rhythm = local_flux / max(float(np.max(local_flux)), 1e-6)
        rhythm_distance = float(np.mean(np.abs(rhythm - ref_rhythm)))
        pattern_distance = float(np.mean(np.abs(local_bands - ref_bands)))
        envelope = local_rms / max(float(np.max(local_rms)), 1e-6)
        envelope_distance = float(np.mean(np.abs(envelope - ref_envelope)))
        transient_penalty = min(1.0, float(local_flux[0]) / max(float(np.max(local_flux)), 1e-6))
        score = (
            0.35 * min(2, loudness_distance)
            + 1.7 * timbre_distance
            + 0.25 * rhythm_distance
            + 0.6 * pattern_distance
            + 0.8 * envelope_distance
            + 0.1 * transient_penalty
        )
        if score > 0.55:
            continue
        reason = (
            "响度接近"
            if loudness_distance < 0.2
            else "音色接近"
            if timbre_distance < 0.04
            else "节奏接近"
        )
        fade_us = 150_000 if transient_penalty > 0.5 else 300_000
        if (search_end_us - candidate_us) / rate <= fade_us + 50_000:
            continue
        ranked.append((score, candidate_us, reason, fade_us))
    ranked.sort(key=lambda item: item[0])
    selected: list[AudioSeamCandidateOut] = []
    for _score, candidate_us, reason, fade_us in ranked:
        if any(abs(candidate_us - item.source_in_us) < MIN_SPACING_US for item in selected):
            continue
        selected.append(
            AudioSeamCandidateOut(
                sourceInUs=candidate_us,
                suggestedFadeUs=fade_us,
                matchReasons=[reason],
                peaks=_peaks(samples, candidate_us),
            )
        )
        if len(selected) == 3:
            break
    return reference_start, selected


class VideoEditorAudioMatching:
    def __init__(self, session: AsyncSession, workspace_id: str) -> None:
        self.session = session
        self.workspace_id = workspace_id

    async def candidates(
        self,
        project_id: str,
        body: AudioSeamCandidatesIn,
    ) -> AudioSeamCandidatesOut:
        timeline = await VideoEditorTimelines(self.session, self.workspace_id).row(project_id)
        if timeline.revision != body.expected_revision:
            raise RevisionConflictError(
                body.expected_revision,
                timeline.revision,
                VideoEditorTimelines.out(timeline).model_dump(mode="json", by_alias=True),
            )
        _track, source, target = audio_seam_pair(
            timeline.document, body.from_clip_id, body.to_clip_id
        )
        media = VideoEditorMedia(self.session, self.workspace_id)
        asset, metadata = await media.asset(project_id, source["assetId"])
        if asset.media_kind != "audio" or metadata.processing_status != "ready":
            raise VideoEditorValidationError("音频素材尚未准备好", code="audio_not_ready")
        duration_us = int((metadata.probe or {}).get("durationUs") or 0)
        source_end = source.get("sourceInUs", 0) + floor(
            source["durationUs"] * (source.get("playbackRate") or 1)
        )
        target_span = floor(target["durationUs"] * (target.get("playbackRate") or 1))
        target_end = target.get("sourceInUs", 0) + target_span
        if not 0 < source_end <= duration_us or target_end > duration_us:
            raise VideoEditorValidationError("音频源范围无效", code="invalid_source_range")
        samples = await asyncio.to_thread(_decode, media.storage.path_for(asset), duration_us)
        reference_start, candidates = await asyncio.to_thread(
            rank_audio_seams,
            samples,
            reference_end_us=source_end,
            search_start_us=0,
            search_end_us=duration_us - target_span + REFERENCE_US,
            rate=target.get("playbackRate") or 1,
        )
        return AudioSeamCandidatesOut(
            assetId=asset.id,
            referenceStartUs=reference_start,
            referencePeaks=_peaks(samples, reference_start),
            candidates=candidates,
        )
