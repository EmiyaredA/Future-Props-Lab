import { rotatedBounds, type Rect } from "../selectionGeometry";
import type { Slide } from "../types";
import { members, selectionIds } from "./model";

export function groupAtHit(slide: Slide, id: string, scope: string | null) {
  return slide.groups?.find(
    (g) => (g.parent_id ?? null) === scope && members(slide, g.id).includes(id),
  );
}

// Resolve a press separately from the click: a drag must keep its original group.
export function selectionAtHit(
  slide: Slide,
  selected: string[],
  id: string | null,
  scope: string | null,
  additive: boolean,
) {
  const nextScope =
    id && scope && members(slide, scope).includes(id) ? scope : null;
  if (!id) return { scope: nextScope, ids: [], drill: null };
  const hit = selectionIds(slide, id, nextScope);
  const group = groupAtHit(slide, id, nextScope);
  const drill =
    !additive &&
    nextScope === scope &&
    group &&
    hit.length === selected.length &&
    hit.every((member) => selected.includes(member))
      ? { scope: group.id, ids: selectionIds(slide, id, group.id) }
      : null;
  const ids = additive
    ? selected.includes(id)
      ? selected.filter((member) => !hit.includes(member))
      : [...new Set([...selected, ...hit])]
    : nextScope === scope && selected.includes(id)
      ? selected
      : hit;
  return { scope: nextScope, ids, drill };
}

/** A marquee encloses complete logical objects at the active group level. */
export function marqueeSelection(
  slide: Slide,
  area: Rect,
  scope: string | null = null,
): string[] {
  const allowed = scope ? new Set(members(slide, scope)) : null;
  const selected = new Set<string>(),
    visited = new Set<string>();
  for (const element of slide.elements) {
    if (
      element.hidden ||
      element.locked ||
      (allowed && !allowed.has(element.id)) ||
      visited.has(element.id)
    )
      continue;
    const ids = selectionIds(slide, element.id, scope);
    ids.forEach((id) => visited.add(id));
    const unit = slide.elements.filter((e) => ids.includes(e.id));
    if (unit.some((e) => e.locked)) continue;
    const visible = unit.filter((e) => !e.hidden);
    if (!visible.length) continue;
    const bounds = rotatedBounds(visible);
    if (
      bounds.x >= area.x - 1e-6 &&
      bounds.y >= area.y - 1e-6 &&
      bounds.x + bounds.width <= area.x + area.width + 1e-6 &&
      bounds.y + bounds.height <= area.y + area.height + 1e-6
    )
      ids.forEach((id) => selected.add(id));
  }
  return slide.elements.filter((e) => selected.has(e.id)).map((e) => e.id);
}
