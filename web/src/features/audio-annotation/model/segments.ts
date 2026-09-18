import type { AudioAnnotationSegment } from "@features/audio-annotation/types";
import { MIN_SEGMENT_MS } from "@features/audio-annotation/model/limits";
import {
  segmentSpeakerIds,
  speakerAssignment,
} from "@features/audio-annotation/model/speakers";

export function sortSegments(segments: AudioAnnotationSegment[]) {
  return [...segments].sort(
    (left, right) =>
      left.start_ms - right.start_ms || left.end_ms - right.end_ms,
  );
}

export function splitSegment(
  segments: AudioAnnotationSegment[],
  segmentId: string,
  atMs: number,
  createId: () => string = () => crypto.randomUUID(),
): AudioAnnotationSegment[] | null {
  const selected = segments.find((segment) => segment.id === segmentId);
  if (
    !selected ||
    atMs - selected.start_ms < MIN_SEGMENT_MS ||
    selected.end_ms - atMs < MIN_SEGMENT_MS
  )
    return null;
  return sortSegments(
    segments.flatMap((segment) =>
      segment.id === segmentId
        ? [
            { ...segment, end_ms: atMs, status: "draft" as const },
            {
              ...segment,
              id: createId(),
              start_ms: atMs,
              text: "",
              language: selected.language,
              localized_texts: [],
              status: "draft" as const,
            },
          ]
        : [segment],
    ),
  );
}

export function duplicateSegmentForOverlap(
  segments: AudioAnnotationSegment[],
  segmentId: string,
  createId: () => string = () => crypto.randomUUID(),
): AudioAnnotationSegment[] | null {
  const selected = segments.find((segment) => segment.id === segmentId);
  if (!selected) return null;
  return sortSegments([
    ...segments,
    {
      ...selected,
      id: createId(),
      ...speakerAssignment([]),
      emotion: null,
      speaker_emotions: [],
      text: "",
      language: selected.language,
      localized_texts: [],
      status: "draft",
    },
  ]);
}

export function mergeWithNext(
  segments: AudioAnnotationSegment[],
  segmentId: string,
): AudioAnnotationSegment[] | null {
  const sorted = sortSegments(segments);
  const index = sorted.findIndex((segment) => segment.id === segmentId);
  const current = sorted[index];
  const next = sorted[index + 1];
  if (!current || !next) return null;
  const text = [current.text.trim(), next.text.trim()]
    .filter(Boolean)
    .join("\n");
  return [
    ...sorted.slice(0, index),
    {
      ...current,
      end_ms: Math.max(current.end_ms, next.end_ms),
      ...speakerAssignment(segmentSpeakerIds(current)),
      text,
      localized_texts: [],
      status: "draft" as const,
    },
    ...sorted.slice(index + 2),
  ];
}

export function createSegment(
  segments: AudioAnnotationSegment[],
  startMs: number,
  endMs: number,
  createId: () => string = () => crypto.randomUUID(),
): AudioAnnotationSegment[] | null {
  const start = Math.max(0, Math.round(startMs));
  const end = Math.round(endMs);
  if (end - start < MIN_SEGMENT_MS) return null;
  return sortSegments([
    ...segments,
    {
      id: createId(),
      start_ms: start,
      end_ms: end,
      ...speakerAssignment([]),
      emotion: null,
      speaker_emotions: [],
      text: "",
      language: null,
      localized_texts: [],
      status: "draft",
    },
  ]);
}

export function updateSegmentBounds(
  segments: AudioAnnotationSegment[],
  segmentId: string,
  startMs: number,
  endMs: number,
  durationMs: number,
): AudioAnnotationSegment[] | null {
  const sorted = sortSegments(segments);
  const index = sorted.findIndex((segment) => segment.id === segmentId);
  if (index < 0) return null;
  const start = Math.max(0, Math.round(startMs));
  const end = Math.min(durationMs, Math.round(endMs));
  if (end - start < MIN_SEGMENT_MS) return null;
  sorted[index] = {
    ...sorted[index]!,
    start_ms: start,
    end_ms: end,
    status: "draft",
  };
  return sortSegments(sorted);
}

export function snapSegmentToPrevious(
  segments: AudioAnnotationSegment[],
  segmentId: string,
  durationMs: number,
): AudioAnnotationSegment[] | null {
  const sorted = sortSegments(segments);
  const index = sorted.findIndex((segment) => segment.id === segmentId);
  const previous = sorted[index - 1];
  const current = sorted[index];
  if (!previous || !current || previous.end_ms >= current.start_ms) return null;
  return updateSegmentBounds(
    sorted,
    segmentId,
    previous.end_ms,
    current.end_ms,
    durationMs,
  );
}

export function snapSegmentToNext(
  segments: AudioAnnotationSegment[],
  segmentId: string,
  durationMs: number,
): AudioAnnotationSegment[] | null {
  const sorted = sortSegments(segments);
  const index = sorted.findIndex((segment) => segment.id === segmentId);
  const current = sorted[index];
  const next = sorted[index + 1];
  if (!current || !next || current.end_ms >= next.start_ms) return null;
  return updateSegmentBounds(
    sorted,
    segmentId,
    current.start_ms,
    next.start_ms,
    durationMs,
  );
}

export function incompleteSegments(
  segments: AudioAnnotationSegment[],
): AudioAnnotationSegment[] {
  return segments.filter(
    (segment) => !segmentSpeakerIds(segment).length || !segment.text.trim(),
  );
}
