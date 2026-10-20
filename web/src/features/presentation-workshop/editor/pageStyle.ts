import type { Slide } from "../types";
import { slideTheme } from "../slideTheme";
export function applyPageStyle(slide: Slide, source: Slide | null): Slide {
  if (!source) return slide;
  const runs = source.elements.flatMap((e) =>
    e.paragraphs.flatMap((p) => p.runs),
  );
  const title = [...runs].sort((a, b) => b.size - a.size)[0],
    body = [...runs].sort((a, b) => a.size - b.size)[0];
  const accent =
    source.elements.find(
      (e) => e.kind !== "text" && e.kind !== "image" && e.kind !== "vector",
    )?.fill ?? slideTheme.blue;
  const colors: Record<string, string> = {
    [slideTheme.navy]: title?.color ?? slideTheme.navy,
    [slideTheme.muted]: body?.color ?? slideTheme.muted,
    [slideTheme.blue]: accent,
  };
  return {
    ...slide,
    background: source.background,
    background_style: source.background_style
      ? structuredClone(source.background_style)
      : null,
    elements: slide.elements.map((e) => ({
      ...e,
      fill: colors[e.fill] ?? e.fill,
      stroke: colors[e.stroke] ?? e.stroke,
      paragraphs: e.paragraphs.map((p) => ({
        ...p,
        runs: p.runs.map((r) => ({
          ...r,
          font: title?.font ?? r.font,
          color: colors[r.color] ?? r.color,
        })),
      })),
    })),
  };
}
