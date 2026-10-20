import type { SlideElement } from "../types";
export function applyFormat(
  source: SlideElement,
  target: SlideElement,
): SlideElement {
  if (target.locked) return target;
  const first = source.paragraphs[0];
  const run = first?.runs[0];
  return {
    ...target,
    fill: source.fill,
    fill_opacity: source.fill_opacity,
    stroke: source.stroke,
    stroke_width: source.stroke_width,
    stroke_dash: source.stroke_dash,
    opacity: source.opacity,
    shadow: source.shadow ? structuredClone(source.shadow) : null,
    ...(source.kind === target.kind
      ? {
          paint: source.paint ? structuredClone(source.paint) : null,
          text_layout: source.text_layout
            ? structuredClone(source.text_layout)
            : null,
          image_effects: source.image_effects
            ? structuredClone(source.image_effects)
            : null,
        }
      : {}),
    paragraphs: target.paragraphs.map((p) => ({
      ...p,
      ...(first
        ? {
            align: first.align,
            line_height: first.line_height,
            indent: first.indent,
            space_before: first.space_before,
            space_after: first.space_after,
            first_line_indent: first.first_line_indent,
          }
        : {}),
      runs: p.runs.map((r) => (run ? { ...run, text: r.text } : r)),
    })),
  };
}
