import type {
  AudioAnnotationImportFile,
  AnnotationProjectFile,
  AnnotationSnapshot,
  AudioAnnotationProject,
  AudioAnnotationSegment,
  AudioAnnotationSpeaker,
  PortableTranscriptionFile,
} from "@features/audio-annotation/types";
import { normalizeCustomEmotions } from "@features/audio-annotation/emotions";
import {
  incompleteSegments,
  sortSegments,
} from "@features/audio-annotation/model/segments";
import { segmentSpeakerIds } from "@features/audio-annotation/model/speakers";
import { formatSrtTimestamp } from "@features/audio-annotation/model/timeFormat";
import type { components } from "@generated/api";

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
    custom_emotions: normalizeCustomEmotions(document.custom_emotions),
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
  return {
    ...(candidate as AnnotationProjectFile),
    custom_emotions: normalizeCustomEmotions(candidate.custom_emotions),
  };
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
      const speaker = segmentSpeakerIds(segment)
        .map((speakerId) => speakerById.get(speakerId))
        .filter(Boolean)
        .join("、");
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
