import type { ManagedFile } from "@features/files";
import type { PromptMentionOption } from "./generationPromptModel";
import type {
  PromptReferenceSlots,
  PromptRenderDocument,
} from "./promptRendering";

export function h3SubjectDefinitions(document: PromptRenderDocument) {
  const section = document.sections.find(
    (item) => item.field === "subject_definitions",
  );
  const text =
    section?.blocks
      .flatMap((block) => block.tokens.map((token) => token.text))
      .join("") ?? "";
  return [...text.matchAll(/^\s*(<Subject ([1-9]\d*)>)([^\r\n]*)/gm)].map(
    (match) => ({
      source: match[1],
      index: match[2],
      definition: match[3].trim(),
    }),
  );
}

export function h3PromptMentions(
  document: PromptRenderDocument,
  assets: ManagedFile[],
  slots?: PromptReferenceSlots,
): PromptMentionOption[] {
  const result: PromptMentionOption[] = [];
  for (const [type, label, media] of [
    ["picture", "图", "image"],
    ["video", "视频", "video"],
    ["audio", "音频", "audio"],
  ] as const) {
    slots?.[type]?.forEach((id, index) => {
      const file = assets.find(
        (item) => item.id === id && item.media_kind === media,
      );
      if (file)
        result.push({
          key: `${type}:${index + 1}`,
          label: `${label}${index + 1}`,
          kind: media,
          source: `<${type === "picture" ? "Picture" : type === "video" ? "Video" : "Audio"} ${index + 1}>`,
          file,
          description: file.display_name,
        });
    });
  }
  for (const subject of h3SubjectDefinitions(document)) {
    result.push({
      key: subject.source,
      source: subject.source,
      label: `主体${subject.index}`,
      kind: "subject",
      description: subject.definition,
    });
  }
  const speakerText = document.sections
    .flatMap((section) =>
      section.blocks.flatMap((block) =>
        block.tokens
          .filter((token) => token.kind === "speaker")
          .map((token) => token.text),
      ),
    )
    .join("");
  const speakers = new Set(
    [...speakerText.matchAll(/\(S[1-9]\d*(?:,\s*S[1-9]\d*)*\)/g)].flatMap(
      (match) => match[0].slice(1, -1).split(/,\s*/),
    ),
  );
  for (const speaker of speakers)
    result.push({
      key: speaker,
      source: `(${speaker})`,
      label: `说话人 ${speaker}`,
      kind: "speaker",
    });
  result.push({
    key: "dialogue",
    source: "<d>[Chinese] </d>",
    label: "插入对白",
    kind: "dialogue",
    description: "保留原语言与字句",
  });
  return result;
}
