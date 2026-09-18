import type {
  AudioAnnotationSegment,
  AudioAnnotationSpeaker,
} from "@features/audio-annotation/types";
import {
  MAX_WAVEFORM_ZOOM,
  MIN_SEGMENT_MS,
} from "@features/audio-annotation/model/limits";
import { sameSegmentSpeakers } from "@features/audio-annotation/model/speakers";

export function waveformSegmentSpeakerLabel(
  segmentIndex: number,
  speakerNames: string[],
): string {
  const names = speakerNames.length ? speakerNames.join("、") : "未指定";
  return `${String(segmentIndex + 1).padStart(2, "0")}  ${names}`;
}

export type WaveformRegionSegment = Pick<
  AudioAnnotationSegment,
  "id" | "start_ms" | "end_ms" | "speaker_id" | "speaker_ids"
>;
export type WaveformRegionSpeaker = Pick<
  AudioAnnotationSpeaker,
  "id" | "name" | "color"
>;

export function stabilizeWaveformRegionSegments(
  previous: WaveformRegionSegment[],
  segments: AudioAnnotationSegment[],
): WaveformRegionSegment[] {
  if (
    previous.length === segments.length &&
    segments.every((segment, index) => {
      const rendered = previous[index];
      return (
        rendered?.id === segment.id &&
        rendered.start_ms === segment.start_ms &&
        rendered.end_ms === segment.end_ms &&
        rendered.speaker_id === segment.speaker_id &&
        sameSegmentSpeakers(rendered, segment)
      );
    })
  )
    return previous;
  return segments.map(({ id, start_ms, end_ms, speaker_id, speaker_ids }) => ({
    id,
    start_ms,
    end_ms,
    speaker_id,
    speaker_ids,
  }));
}

export function stabilizeWaveformRegionSpeakers(
  previous: WaveformRegionSpeaker[],
  speakers: AudioAnnotationSpeaker[],
): WaveformRegionSpeaker[] {
  if (
    previous.length === speakers.length &&
    speakers.every((speaker, index) => {
      const rendered = previous[index];
      return (
        rendered?.id === speaker.id &&
        rendered.name === speaker.name &&
        rendered.color === speaker.color
      );
    })
  )
    return previous;
  return speakers.map(({ id, name, color }) => ({ id, name, color }));
}

export function clampWaveformZoom(ratio: number): number {
  if (!Number.isFinite(ratio)) return 1;
  return Math.min(MAX_WAVEFORM_ZOOM, Math.max(1, ratio));
}

export function waveformFocusZoom(
  durationMs: number,
  startMs: number,
  endMs: number,
): number {
  const rangeMs = Math.max(MIN_SEGMENT_MS, endMs - startMs);
  return clampWaveformZoom(durationMs / Math.max(2_000, rangeMs * 1.8));
}

export function waveformViewport(
  durationMs: number,
  zoomRatio: number,
  centerMs: number,
): { startMs: number; endMs: number } {
  const safeDuration = Math.max(0, durationMs);
  const visibleMs = safeDuration / clampWaveformZoom(zoomRatio);
  const startMs = Math.min(
    Math.max(0, centerMs - visibleMs / 2),
    Math.max(0, safeDuration - visibleMs),
  );
  return { startMs, endMs: Math.min(safeDuration, startMs + visibleMs) };
}
