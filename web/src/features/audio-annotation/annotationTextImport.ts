import { normalizeImportedEmotion } from "./emotions";
import {
  sameSegmentSpeakers,
  segmentSpeakerEmotions,
  syncLegacyEmotion,
  type SpeakerEmotionEntry,
} from "./model";
import type { AnnotationSnapshot } from "./types";

function normalizeImportedSpeakerEmotions(
  value: unknown,
  speakerIds: string[],
): SpeakerEmotionEntry[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) throw new Error("invalid");
  const allowed = new Set(speakerIds);
  const seen = new Set<string>();
  const entries: SpeakerEmotionEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") throw new Error("invalid");
    const record = item as { speaker_id?: unknown; emotion?: unknown };
    if (
      typeof record.speaker_id !== "string" ||
      !allowed.has(record.speaker_id) ||
      seen.has(record.speaker_id)
    )
      throw new Error("invalid");
    seen.add(record.speaker_id);
    const emotion = normalizeImportedEmotion(record.emotion);
    if (!emotion) throw new Error("invalid");
    entries.push({
      speaker_id: record.speaker_id,
      emotion,
    });
  }
  return entries;
}

export function prepareTextOnlyAnnotationImport(
  current: AnnotationSnapshot,
  payload: unknown,
): AnnotationSnapshot {
  if (!payload || typeof payload !== "object")
    throw new Error("JSON 内容不是有效的标注项目");
  const imported = payload as Partial<AnnotationSnapshot>;
  if (imported.schema_version !== "1.0" || !Array.isArray(imported.segments))
    throw new Error("JSON 缺少有效的 1.0 标注文档");
  if (imported.segments.length !== current.segments.length)
    throw new Error("片段数量与当前项目不一致");

  const segments = current.segments.map((segment, index) => {
    const incoming = imported.segments![index];
    if (
      !incoming ||
      incoming.id !== segment.id ||
      incoming.start_ms !== segment.start_ms ||
      incoming.end_ms !== segment.end_ms ||
      !sameSegmentSpeakers(incoming, segment)
    )
      throw new Error(`片段 ${index + 1} 的结构与当前项目不一致`);
    const localizedTexts = incoming.localized_texts ?? [];
    const languages = localizedTexts.map((item) => item.language);
    if (
      languages.length !== new Set(languages).size ||
      localizedTexts.some(
        (item) =>
          typeof item.language !== "string" || typeof item.text !== "string",
      )
    )
      throw new Error(`片段 ${index + 1} 包含无效或重复的语言版本`);
    if (
      typeof incoming.text !== "string" ||
      (incoming.language !== null && typeof incoming.language !== "string") ||
      !["draft", "reviewed"].includes(incoming.status)
    )
      throw new Error(`片段 ${index + 1} 的文本字段无效`);

    const speakerIds =
      segment.speaker_ids?.length
        ? segment.speaker_ids
        : segment.speaker_id
          ? [segment.speaker_id]
          : [];
    let speakerEmotions = segmentSpeakerEmotions(segment);
    try {
      const importedEmotions = normalizeImportedSpeakerEmotions(
        incoming.speaker_emotions,
        speakerIds,
      );
      if (importedEmotions) speakerEmotions = importedEmotions;
      else if (incoming.emotion !== undefined) {
        const emotion = normalizeImportedEmotion(incoming.emotion);
        speakerEmotions = emotion
          ? speakerIds.map((speakerId) => ({
              speaker_id: speakerId,
              emotion,
            }))
          : [];
      }
    } catch {
      throw new Error(`片段 ${index + 1} 的情绪字段无效`);
    }
    return {
      ...segment,
      text: incoming.text,
      emotion: syncLegacyEmotion(speakerEmotions),
      speaker_emotions: speakerEmotions,
      language: incoming.language,
      localized_texts: localizedTexts,
      status: incoming.status,
    };
  });

  return {
    schema_version: "1.0",
    speakers: current.speakers,
    custom_emotions: current.custom_emotions ?? [],
    segments,
  };
}
