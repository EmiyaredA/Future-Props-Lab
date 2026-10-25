import type { Definition } from "../model";
/** Persist theme-token changes in native prototypes; distinct local colors/fonts survive. */
export function themeChange(
  source: Definition,
  patch: Partial<Pick<Definition, "font" | "foreground" | "accent">>,
): Definition {
  const d = structuredClone(source);
  const color = (value: string) =>
    value === source.foreground
      ? (patch.foreground ?? value)
      : value === source.accent
        ? (patch.accent ?? value)
        : value;
  for (const scene of [
    d.global_scene,
    ...Object.values(d.layouts).flatMap((l) => [l.scene, l.defaults]),
  ])
    for (const e of scene?.elements ?? []) {
      e.fill = color(e.fill);
      e.stroke = color(e.stroke);
      for (const p of e.paragraphs)
        for (const r of p.runs) {
          if (r.font === source.font && patch.font) r.font = patch.font;
          r.color = color(r.color);
        }
    }
  for (const l of Object.values(d.layouts))
    for (const slot of [l.chapter, l.title, l.number, l.toc]) {
      if (slot.style.font === source.font && patch.font)
        slot.style.font = patch.font;
      slot.style.color = color(slot.style.color);
    }
  return { ...d, ...patch };
}
