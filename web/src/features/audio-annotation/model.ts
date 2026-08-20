import type {
  AnnotationProjectFile,
  AnnotationSnapshot,
  AudioAnnotationProject,
  AudioAnnotationSegment,
  AudioAnnotationSpeaker,
} from "@features/audio-annotation/types";

export const MIN_SEGMENT_MS = 100;
export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
export const MAX_AUDIO_DURATION_MS = 60 * 60 * 1000;
export const SPEAKER_COLORS = [
  "#28B8A7",
  "#4C8FE8",
  "#9B62D0",
  "#E7A72F",
  "#ED7A52",
  "#D85E9D",
  "#7586E5",
  "#46B978",
];

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

export function formatTimestamp(milliseconds: number): string {
  const safe = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  return `${hours ? `${pad(hours)}:` : ""}${pad(minutes)}:${pad(seconds)}.${pad(safe % 1000, 3)}`;
}

export function parseTimestamp(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const secondsPart = parts.pop()!;
  const seconds = Number(secondsPart);
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts[0]) : 0;
  if (
    ![hours, minutes, seconds].every(Number.isFinite) ||
    minutes < 0 ||
    minutes >= 60 ||
    seconds < 0 ||
    seconds >= 60
  )
    return null;
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

export function formatSrtTimestamp(milliseconds: number): string {
  const safe = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(safe % 1000, 3)}`;
}

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
              status: "draft" as const,
            },
          ]
        : [segment],
    ),
  );
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
      end_ms: next.end_ms,
      speaker_id: current.speaker_id,
      text,
      status: "draft" as const,
    },
    ...sorted.slice(index + 2),
  ];
}

export function createSegmentInGap(
  segments: AudioAnnotationSegment[],
  startMs: number,
  endMs: number,
  createId: () => string = () => crypto.randomUUID(),
): AudioAnnotationSegment[] | null {
  const start = Math.max(0, Math.round(startMs));
  const end = Math.round(endMs);
  if (end - start < MIN_SEGMENT_MS) return null;
  if (
    segments.some((segment) => start < segment.end_ms && end > segment.start_ms)
  )
    return null;
  return sortSegments([
    ...segments,
    {
      id: createId(),
      start_ms: start,
      end_ms: end,
      speaker_id: null,
      text: "",
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
  const previous = sorted[index - 1];
  const next = sorted[index + 1];
  const start = Math.max(0, Math.round(startMs), previous?.end_ms ?? 0);
  const end = Math.min(
    durationMs,
    Math.round(endMs),
    next?.start_ms ?? durationMs,
  );
  if (end - start < MIN_SEGMENT_MS) return null;
  sorted[index] = {
    ...sorted[index]!,
    start_ms: start,
    end_ms: end,
    status: "draft",
  };
  return sorted;
}

export function buildProjectFile(
  project: AudioAnnotationProject,
  document: AnnotationSnapshot,
): AnnotationProjectFile {
  return {
    kind: "future-props-audio-annotation",
    schema_version: "1.0",
    exported_at: new Date().toISOString(),
    project: {
      title: project.title,
      duration_ms: project.duration_ms,
      source: {
        asset_id: project.asset_id,
        display_name: project.asset_display_name,
        original_filename: project.original_filename,
        mime_type: project.mime_type,
        byte_size: project.byte_size,
      },
    },
    speakers: document.speakers,
    segments: sortSegments(document.segments),
  };
}

export function parseProjectFile(value: unknown): AnnotationProjectFile {
  if (!value || typeof value !== "object")
    throw new Error("项目 JSON 格式无效");
  const candidate = value as Partial<AnnotationProjectFile>;
  if (
    candidate.kind !== "future-props-audio-annotation" ||
    candidate.schema_version !== "1.0" ||
    !candidate.project ||
    !Array.isArray(candidate.speakers) ||
    !Array.isArray(candidate.segments)
  ) {
    throw new Error("只支持录音标注项目 JSON 1.0");
  }
  return candidate as AnnotationProjectFile;
}

export function incompleteSegments(
  segments: AudioAnnotationSegment[],
): AudioAnnotationSegment[] {
  return segments.filter(
    (segment) => !segment.speaker_id || !segment.text.trim(),
  );
}

export function buildSrt(
  segments: AudioAnnotationSegment[],
  speakers: AudioAnnotationSpeaker[],
): string {
  const speakerById = new Map(
    speakers.map((speaker) => [speaker.id, speaker.name]),
  );
  const missing = incompleteSegments(segments);
  if (missing.length)
    throw new Error(`还有 ${missing.length} 个片段缺少说话人或内容`);
  return sortSegments(segments)
    .map((segment, index) => {
      const speaker = speakerById.get(segment.speaker_id!);
      return `${index + 1}\n${formatSrtTimestamp(segment.start_ms)} --> ${formatSrtTimestamp(segment.end_ms)}\n${speaker}：${segment.text.trim()}\n`;
    })
    .join("\n");
}

export function safeFileBase(value: string): string {
  return (
    Array.from(value)
      .map((character) =>
        character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character)
          ? "-"
          : character,
      )
      .join("")
      .trim()
      .slice(0, 100) || "audio-annotation"
  );
}
