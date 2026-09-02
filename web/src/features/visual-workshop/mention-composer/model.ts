export const EMPTY_COMPOSER_TEXT = "\u200b";

export type MentionTextPart = { key: string; type: "text"; text: string };
export type MentionTokenPart = { key: string; type: "asset" };
export type MentionPart = MentionTextPart | MentionTokenPart;
export type MentionCaret = { key: string; offset: number };
export type MentionMatch = MentionCaret & { start: number; query: string };

export function normalizeMentionParts<P extends MentionPart>(
  parts: P[],
  createText: (text?: string) => Extract<P, MentionTextPart>,
  options: { leadingText?: boolean } = {},
): P[] {
  const normalized: P[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      const text = part.text.replaceAll(EMPTY_COMPOSER_TEXT, "");
      const previous = normalized.at(-1);
      if (previous?.type === "text") {
        normalized[normalized.length - 1] = {
          ...previous,
          text: previous.text + text,
        } as P;
      } else {
        normalized.push({ ...part, text } as P);
      }
      continue;
    }
    if (normalized.at(-1)?.type !== "text") normalized.push(createText() as P);
    normalized.push(part);
  }
  if (!normalized.length) normalized.push(createText() as P);
  if (options.leadingText && normalized[0].type !== "text")
    normalized.unshift(createText() as P);
  if (normalized.at(-1)?.type !== "text") normalized.push(createText() as P);
  return normalized;
}

export function mentionProjection<P extends MentionPart>(
  parts: P[],
  tokenText: (part: Extract<P, MentionTokenPart>) => string,
) {
  return parts
    .map((part) =>
      part.type === "text"
        ? part.text
        : tokenText(part as Extract<P, MentionTokenPart>),
    )
    .join("");
}

export function mentionPartLength<P extends MentionPart>(
  part: P,
  tokenText: (part: Extract<P, MentionTokenPart>) => string,
) {
  return part.type === "text"
    ? part.text.length
    : tokenText(part as Extract<P, MentionTokenPart>).length;
}

export function findMentionAtCaret<P extends MentionPart>(
  parts: P[],
  caret: MentionCaret | null,
): MentionMatch | null {
  if (!caret) return null;
  const part = parts.find(
    (candidate): candidate is Extract<P, MentionTextPart> =>
      candidate.key === caret.key && candidate.type === "text",
  );
  if (!part) return null;
  const prefix = part.text.slice(0, caret.offset);
  // A mention may follow natural-language punctuation, e.g. "参考：@素材".
  // Keep @ inside words/emails from opening the menu while accepting both
  // ASCII and CJK punctuation (and other non-word separators).
  const match = prefix.match(/(?:^|[^\p{L}\p{N}_@])@([^\s@]*)$/u);
  if (!match) return null;
  const query = match[1] ?? "";
  return { ...caret, start: caret.offset - query.length - 1, query };
}
