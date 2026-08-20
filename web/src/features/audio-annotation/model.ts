import type {
  AudioAnnotationImportFile,
  AnnotationProjectFile,
  AnnotationSnapshot,
  AudioAnnotationProject,
  AudioAnnotationSegment,
  AudioAnnotationSpeaker,
  PortableTranscriptionFile,
} from "@features/audio-annotation/types";
import type { components } from "@generated/api";

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

export const ANNOTATION_LANGUAGES = [
  { code: "zh", label: "中文", color: "teal" },
  { code: "ja", label: "日语", color: "purple" },
  { code: "en", label: "英语", color: "blue" },
  { code: "ko", label: "韩语", color: "yellow" },
] as const;

export function languageLabel(code: string): string {
  return (
    ANNOTATION_LANGUAGES.find((language) => language.code === code)?.label ??
    code
  );
}

export function languageColor(code: string): string {
  return (
    ANNOTATION_LANGUAGES.find((language) => language.code === code)?.color ??
    "neutral"
  );
}

export function segmentLanguageCodes(
  segment: Pick<AudioAnnotationSegment, "language" | "localized_texts">,
): string[] {
  return [
    ...new Set([
      ...(segment.language ? [segment.language] : []),
      ...(segment.localized_texts ?? []).map((item) => item.language),
    ]),
  ];
}

export function segmentSearchableText(segment: AudioAnnotationSegment): string {
  return [
    segment.text,
    ...(segment.localized_texts ?? []).map((item) => item.text),
  ].join(" ");
}

export type ImportedAudioAnnotationSpeaker = {
  id: string;
  name: string;
  color?: string | null;
};

export function mergeImportedSpeakers(
  speakers: AudioAnnotationSpeaker[],
  imported: ImportedAudioAnnotationSpeaker[],
  createId: () => string = () => crypto.randomUUID(),
): AudioAnnotationSpeaker[] {
  const result = [...speakers];
  const names = new Set(
    result.map((speaker) => speaker.name.trim().toLocaleLowerCase("zh-CN")),
  );
  const ids = new Set(result.map((speaker) => speaker.id));

  for (const item of imported) {
    if (result.length >= 64) break;
    const name = item.name.trim();
    const normalizedName = name.toLocaleLowerCase("zh-CN");
    if (!name || names.has(normalizedName)) continue;

    let id = item.id.trim() || createId();
    if (ids.has(id)) id = createId();
    while (ids.has(id)) id = createId();

    result.push({
      id,
      name,
      color:
        item.color && /^#[0-9a-f]{6}$/i.test(item.color)
          ? item.color
          : SPEAKER_COLORS[result.length % SPEAKER_COLORS.length]!,
    });
    names.add(normalizedName);
    ids.add(id);
  }

  return result;
}

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
      speaker_id: null,
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
      speaker_id: current.speaker_id,
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
      speaker_id: null,
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

export function buildTranscriptionFile(
  task: components["schemas"]["ModelTestTranscriptionTaskOut"],
): PortableTranscriptionFile {
  return {
    kind: "future-props-transcription",
    schema_version: "1.1",
    exported_at: new Date().toISOString(),
    source: {
      kind: task.source.kind,
      asset_id: task.source.source_asset_id,
      filename: task.source.filename,
      mime_type: task.source.mime_type,
      byte_size: task.source.byte_size,
    },
    recognition: {
      task_id: task.id,
      provider_kind: task.provider_kind,
      provider_name: task.provider_name,
      model_slug: task.model_slug,
      language: task.language,
      created_at: task.created_at,
      completed_at: task.completed_at,
      text: task.result_text ?? "",
      segments: task.result_segments.map((segment) => ({ ...segment })),
      parameters: { ...task.parameters },
      result_detail: {
        ...task.result_detail,
        words: task.result_detail.words?.map((word) => ({ ...word })),
        warnings: task.result_detail.warnings?.map((warning) => ({
          ...warning,
        })),
        stages: task.result_detail.stages?.map((stage) => ({ ...stage })),
        overlap_intervals: task.result_detail.overlap_intervals?.map(
          (interval) => ({
            ...interval,
          }),
        ),
        audio_info: task.result_detail.audio_info
          ? { ...task.result_detail.audio_info }
          : null,
      },
    },
  };
}

export function parseTranscriptionFile(
  value: unknown,
): PortableTranscriptionFile {
  if (!value || typeof value !== "object")
    throw new Error("识别 JSON 格式无效");
  const candidate = value as Partial<PortableTranscriptionFile>;
  const source = candidate.source;
  const recognition = candidate.recognition;
  if (
    candidate.kind !== "future-props-transcription" ||
    !["1.0", "1.1"].includes(candidate.schema_version ?? "") ||
    !source ||
    !recognition ||
    !["upload", "library"].includes(source.kind ?? "") ||
    typeof source.filename !== "string" ||
    typeof source.mime_type !== "string" ||
    typeof source.byte_size !== "number" ||
    typeof recognition.text !== "string" ||
    !Array.isArray(recognition.segments) ||
    recognition.segments.some(
      (segment) =>
        !segment ||
        typeof segment.speaker !== "string" ||
        typeof segment.start_ms !== "number" ||
        !Number.isFinite(segment.start_ms) ||
        segment.start_ms < 0 ||
        typeof segment.end_ms !== "number" ||
        !Number.isFinite(segment.end_ms) ||
        segment.end_ms < 0 ||
        typeof segment.text !== "string",
    )
  ) {
    throw new Error("只支持语音识别结果 JSON 1.0 或 1.1");
  }
  return candidate as PortableTranscriptionFile;
}

export function parseAudioAnnotationImportFile(
  value: unknown,
): AudioAnnotationImportFile {
  if (
    value &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "future-props-transcription"
  )
    return parseTranscriptionFile(value);
  return parseProjectFile(value);
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
