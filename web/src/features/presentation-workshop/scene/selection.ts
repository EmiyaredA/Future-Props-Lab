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
