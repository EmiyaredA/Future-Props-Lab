import { rotatedBounds, type Rect } from "../selectionGeometry";
import type { Slide, SlideElement } from "../types";
import { members, selectionIds, type Group } from "./model";

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

/** Prefer whole groups; a partial frame can select enclosed members in place. */
export function marqueeSelection(
  slide: Slide,
  area: Rect,
  scope: string | null = null,
): string[] {
  const groups = slide.groups ?? [];
  const byId = new Map(slide.elements.map((e) => [e.id, e]));
  const selected = new Set<string>();
  const encloses = (elements: SlideElement[]) => {
    const bounds = rotatedBounds(elements);
    return (
      bounds.x >= area.x - 1e-6 &&
      bounds.y >= area.y - 1e-6 &&
      bounds.x + bounds.width <= area.x + area.width + 1e-6 &&
      bounds.y + bounds.height <= area.y + area.height + 1e-6
    );
  };
  const selectElement = (element: SlideElement | undefined) => {
    if (element && !element.hidden && !element.locked && encloses([element]))
      selected.add(element.id);
  };
  const visitGroup = (group: Group) => {
    const elements = members(slide, group.id).flatMap(
      (id) => byId.get(id) ?? [],
    );
    const visible = elements.filter((e) => !e.hidden);
    if (!visible.length) return;
    if (encloses(visible)) {
      if (!elements.some((e) => e.locked))
        elements.forEach((e) => selected.add(e.id));
      return;
    }
    group.element_ids?.forEach((id) => selectElement(byId.get(id)));
    groups.filter((child) => child.parent_id === group.id).forEach(visitGroup);
  };
  const activeGroup = groups.find((g) => g.id === scope);
  if (activeGroup) {
    activeGroup.element_ids?.forEach((id) => selectElement(byId.get(id)));
  } else if (!scope) {
    const grouped = new Set(groups.flatMap((g) => g.element_ids ?? []));
    slide.elements.filter((e) => !grouped.has(e.id)).forEach(selectElement);
  }
  groups.filter((g) => (g.parent_id ?? null) === scope).forEach(visitGroup);
  return slide.elements.filter((e) => selected.has(e.id)).map((e) => e.id);
}
