import type { Shot } from "./api";
/** Offsets are a fast path; an exact, unique quote can survive edits before it. */
export function locateExcerpt(
  text: string,
  source: NonNullable<Shot["source"]>,
) {
  const quote = source.excerpt ?? "";
  if (!quote) return undefined;
  if (
    source.start != null &&
    source.end != null &&
    text.slice(source.start, source.end) === quote
  )
    return { start: source.start, end: source.end };
  const start = text.indexOf(quote);
  return start >= 0 && text.indexOf(quote, start + 1) < 0
    ? { start, end: start + quote.length }
    : undefined;
}
