import { normalizeImportedEmotion } from "./emotions";
import { sameSegmentSpeakers } from "./model";
import type { AnnotationSnapshot } from "./types";

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

    let emotion = segment.emotion ?? null;
    try {
      if (incoming.emotion !== undefined)
        emotion = normalizeImportedEmotion(incoming.emotion);
    } catch {
      throw new Error(`片段 ${index + 1} 的情绪字段无效`);
    }
    return {
      ...segment,
      text: incoming.text,
      emotion,
      language: incoming.language,
      localized_texts: localizedTexts,
      status: incoming.status,
    };
  });

  return { schema_version: "1.0", speakers: current.speakers, segments };
}
