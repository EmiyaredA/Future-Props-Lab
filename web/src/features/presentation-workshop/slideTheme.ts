import type { Slide, SlideElement } from "./types";

export const slideTheme = {
  background: "#FBFCFD",
  navy: "#142D40",
  muted: "#64748B",
  blue: "#087F9C",
  teal: "#11A6A0",
  fill: "#EEF7F9",
  border: "#B9DADD",
  white: "#FFFFFF",
} as const;

const replacements: Record<string, string> = {
  "#FFFFFF": slideTheme.background,
  "#FBF9F4": slideTheme.background,
  "#132338": slideTheme.navy,
  "#24344B": slideTheme.navy,
  "#52627A": slideTheme.muted,
  "#7D8BA0": slideTheme.muted,
  "#6476DC": slideTheme.blue,
  "#4556BA": slideTheme.blue,
  "#4A7D9A": slideTheme.blue,
  "#365F62": slideTheme.teal,
  "#D5AE75": slideTheme.teal,
  "#B5C1D1": slideTheme.border,
  "#EDF0F8": slideTheme.fill,
  "#EFF5FA": slideTheme.fill,
};

// Existing theme colors are fixed points, including white text on dark covers.
const targets = new Set<string>(Object.values(slideTheme));
export function suggestedColor(color: string, background = false): string {
  const key = color.toUpperCase();
  if (background && key === "#FFFFFF") return slideTheme.background;
  return targets.has(key) ? key : (replacements[key] ?? key);
}

function native(element: SlideElement) {
  return !element.locked && !["image", "vector"].includes(element.kind);
}

/** Only colors that the operation is allowed to change appear in the mapping. */
export function pageColors(slide: Slide): string[] {
  return [
    ...new Set(
      [
        slide.background,
        ...slide.elements
          .filter(native)
          .flatMap((e) =>
            e.kind === "text"
              ? e.paragraphs.flatMap((p) => p.runs.map((r) => r.color))
              : [e.fill, e.stroke],
          ),
        ...(slide.connections ?? [])
          .filter(
            (c) =>
              !slide.elements.some(
                (e) => e.locked && [c.source_id, c.target_id].includes(e.id),
              ),
          )
          .map((c) => c.color),
      ].map((c) => c.toUpperCase()),
    ),
  ];
}

export function themeMapping(slide: Slide): Record<string, string> {
  return Object.fromEntries(
    pageColors(slide).map((color) => [
      color,
      suggestedColor(color, color === slide.background.toUpperCase()),
    ]),
  );
}

/** A pure data edit: never changes geometry, identities, source or media. */
export function applySlideTheme(
  slide: Slide,
  mapping: Record<string, string>,
): Slide {
  const color = (value: string) => mapping[value.toUpperCase()] ?? value;
  const locked = new Set(
    slide.elements.filter((e) => e.locked).map((e) => e.id),
  );
  return {
    ...slide,
    background: color(slide.background),
    elements: slide.elements.map((e) => {
      if (!native(e)) return e;
      if (e.kind === "text")
        return {
          ...e,
          paragraphs: e.paragraphs.map((p) => ({
            ...p,
            runs: p.runs.map((r) => ({ ...r, color: color(r.color) })),
          })),
        };
      return {
        ...e,
        fill: color(e.fill),
        stroke: color(e.stroke),
        ...(e.kind === "roundRect" ? { corner_radius: 12 } : {}),
      };
    }),
    connections: slide.connections?.map((c) =>
      (c.source_id != null && locked.has(c.source_id)) ||
      (c.target_id != null && locked.has(c.target_id))
        ? c
        : { ...c, color: color(c.color) },
    ),
  };
}
