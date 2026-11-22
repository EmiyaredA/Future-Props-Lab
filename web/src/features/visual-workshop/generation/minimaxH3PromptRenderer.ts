import type {
  PromptRenderAdapter,
  PromptRenderBlock,
  PromptRenderSection,
  PromptRenderToken,
} from "./promptRendering";

const fields = {
  subject_definitions: "主体定义",
  summary: "摘要",
  retention_analysis: "保留分析",
  detailed_description: "详细描述",
  integrated_multimodal_description: "音画描述",
  overall_soundscape: "环境声与音效",
  non_diegetic_music: "背景音乐",
} as const;

function canonicalField(field: string): keyof typeof fields {
  return (
    field === "subject_definition" ? "subject_definitions" : field
  ) as keyof typeof fields;
}

const relationshipMarkers = new Set([
  "fully_preserved",
  "partially_preserved",
  "attribute_transfer",
  "weak_reference",
  "fully_copy",
  "partially_copy",
  "reference",
]);

function dialogueTokens(text: string): PromptRenderToken[] {
  const tokens: PromptRenderToken[] = [];
  let cursor = 0;
  for (const match of text.matchAll(
    /<\/?(?:d|scenetrans|cutoff)>|(?<=<d>)\[[^\]\r\n]+\]/g,
  )) {
    if (match.index > cursor)
      tokens.push({ kind: "text", text: text.slice(cursor, match.index) });
    tokens.push({
      kind: match[0].startsWith("[") ? "language" : "marker",
      text: match[0],
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length)
    tokens.push({ kind: "text", text: text.slice(cursor) });
  return tokens;
}

function tokenize(text: string): PromptRenderToken[] {
  const pattern =
    /<d>[\s\S]*?(?:<\/d>|$)|<(Subject|Picture|Video|Audio) [1-9]\d*>|\b(Picture) [1-9]\d*\b|\[Shot [1-9]\d*(?:,[^\]\r\n]+)?\]|\b\d{2}:\d{2}(?:\.\d+)?\b|<\/?(?:d|scenetrans|cutoff)>|\(S[1-9]\d*(?:,\s*S[1-9]\d*)*\)|\b(?:fully_preserved|partially_preserved|attribute_transfer|weak_reference|fully_copy|partially_copy|reference)\b|\[(?:keyframe completion|reference generation|video editing|video continuation|audio reuse|audio reference)(?: \+ (?:keyframe completion|reference generation|video editing|video continuation|audio reuse|audio reference))*\]/g;
  const tokens: PromptRenderToken[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor)
      tokens.push({ kind: "text", text: text.slice(cursor, match.index) });
    const value = match[0];
    const referenceType = match[1] ?? match[2];
    const kind: PromptRenderToken["kind"] = value.startsWith("<d>")
      ? "dialogue"
      : referenceType
        ? (referenceType.toLowerCase() as
            "subject" | "picture" | "video" | "audio")
        : value.startsWith("[Shot")
          ? "shot"
          : /^\d/.test(value)
            ? "time"
            : value.startsWith("<")
              ? "marker"
              : value.startsWith("(S")
                ? "speaker"
                : relationshipMarkers.has(value)
                  ? "relationship"
                  : "task";
    // "reference" is a relationship only after a retention entry's colon.
    if (value === "reference" && !/:\s*$/.test(text.slice(0, match.index)))
      tokens.push({ kind: "text", text: value });
    else
      tokens.push({
        kind,
        text: value,
        ...(kind === "dialogue" ? { children: dialogueTokens(value) } : {}),
      });
    cursor = match.index + value.length;
  }
  if (cursor < text.length)
    tokens.push({ kind: "text", text: text.slice(cursor) });
  return tokens;
}

function blocks(text: string, shots: boolean): PromptRenderBlock[] {
  const tokens = tokenize(text);
  if (!shots) return [{ kind: "paragraph", tokens }];
  const result: PromptRenderBlock[] = [];
  let current: PromptRenderBlock = { kind: "paragraph", tokens: [] };
  let preceding = "";
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1]?.text ?? "";
    // References within a sentence stay inline; dialogue is an atomic token.
    const startsShot =
      token.kind === "shot" &&
      (/^[\s]*$/.test(preceding) ||
        /[\r\n][ \t]*$/.test(preceding) ||
        /[.!?][ \t]+$/.test(preceding) ||
        /^[ \t]+At[ \t]+\d{2}:\d{2}/.test(next));
    if (startsShot) {
      if (current.tokens.length) result.push(current);
      current = { kind: "shot", tokens: [] };
    }
    current.tokens.push(token);
    preceding += token.text;
  }
  if (current.tokens.length || !result.length) result.push(current);
  return result;
}

export const minimaxH3PromptRenderer: PromptRenderAdapter = {
  id: "minimax-h3",
  label: "MiniMax H3",
  shortLabel: "H3",
  parse(prompt) {
    const dialogueRanges = [...prompt.matchAll(/<d>[\s\S]*?(?:<\/d>|$)/g)].map(
      (match) => [match.index, match.index + match[0].length],
    );
    const headings = [
      ...prompt.matchAll(
        // Standalone field names also occur in saved H3 rewrites. This is a
        // display parser, so accept both forms without normalizing the source.
        /^[ \t]*(subject_definitions?|summary|retention_analysis|detailed_description|integrated_multimodal_description|overall_soundscape|non_diegetic_music)[ \t]*(?:[:：]|(?=\r?$))/gm,
      ),
    ].filter(
      (match) =>
        !dialogueRanges.some(
          ([start, end]) => match.index >= start && match.index < end,
        ),
    );
    if (
      !headings.some((match) =>
        [
          "subject_definitions",
          "detailed_description",
          "integrated_multimodal_description",
        ].includes(canonicalField(match[1])),
      )
    )
      return null;
    const sections: PromptRenderSection[] = [];
    const preamble = prompt.slice(0, headings[0].index);
    const alignment =
      /^(?:[ \t]*\r?\n)*[ \t]*(?:How the reference pictures align with the target video[^\r\n]*|For the target video,[^\r\n]*<Picture [1-9]\d*>[^\r\n]*fully referenced\.)[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)*/.exec(
        preamble,
      )?.[0] ?? "";
    if (alignment)
      sections.push({
        heading: "",
        hidden: true,
        blocks: blocks(alignment, false),
      });
    if (preamble.length > alignment.length)
      sections.push({
        heading: "",
        blocks: blocks(preamble.slice(alignment.length), false),
      });
    for (let index = 0; index < headings.length; index += 1) {
      const match = headings[index];
      const field = canonicalField(match[1]);
      const text = prompt.slice(
        match.index + match[0].length,
        headings[index + 1]?.index ?? prompt.length,
      );
      sections.push({
        field,
        title: fields[field],
        heading: match[0],
        hideHeading: field === "integrated_multimodal_description",
        blocks: blocks(
          text,
          field === "detailed_description" ||
            field === "integrated_multimodal_description",
        ),
      });
    }
    return { sections };
  },
};
