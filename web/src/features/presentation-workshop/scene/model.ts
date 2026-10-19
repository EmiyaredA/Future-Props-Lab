import type { Slide } from "../types";
import { followConnection } from "./connectionGeometry";
export { anchor, connectionPoints } from "./connectionGeometry";

export type Group = NonNullable<Slide["groups"]>[number];
export type Connection = NonNullable<Slide["connections"]>[number];
export type Infographic = NonNullable<Slide["infographics"]>[number];
export type Anchor = Connection["source_anchor"];
export type Fragment = Pick<
  Slide,
  "elements" | "groups" | "connections" | "infographics"
>;

export function completeScene(slide: Slide): Slide {
  return {
    ...slide,
    groups: slide.groups ?? [],
    connections: slide.connections ?? [],
    infographics: slide.infographics ?? [],
    reference: slide.reference ?? null,
  };
}

export function members(slide: Slide, groupId: string): string[] {
  const groups = new Set([groupId]);
  for (let pass = 0; pass < (slide.groups?.length ?? 0); pass++) {
    for (const group of slide.groups ?? [])
      if (group.parent_id && groups.has(group.parent_id)) groups.add(group.id);
  }
  return (slide.groups ?? [])
    .filter((g) => groups.has(g.id))
    .flatMap((g) => g.element_ids ?? []);
}

export function selectedGroup(
  slide: Slide,
  ids: string[],
  scope: string | null = null,
): Group | undefined {
  return (slide.groups ?? []).find(
    (g) =>
      (g.parent_id ?? null) === scope &&
      members(slide, g.id).length > 0 &&
      members(slide, g.id).every((id) => ids.includes(id)),
  );
}

export function selectionIds(
  slide: Slide,
  id: string,
  scope: string | null = null,
): string[] {
  const group = (slide.groups ?? []).find(
    (g) => (g.parent_id ?? null) === scope && members(slide, g.id).includes(id),
  );
  return group ? members(slide, group.id) : [id];
}

export function groupSelection(
  slide: Slide,
  ids: string[],
  identity: string,
  scope: string | null,
): Slide {
  const eligible = new Set(
    ids.filter((id) => slide.elements.some((e) => e.id === id && !e.locked)),
  );
  if (
    eligible.size < 2 ||
    slide.elements.some((e) => ids.includes(e.id) && e.locked)
  )
    return slide;
  const children = (slide.groups ?? []).filter(
    (g) =>
      (g.parent_id ?? null) === scope &&
      members(slide, g.id).every((id) => eligible.has(id)),
  );
  const childMembers = new Set(children.flatMap((g) => members(slide, g.id)));
  if (
    (slide.groups ?? []).some(
      (g) =>
        g.id !== scope &&
        (g.element_ids ?? []).some(
          (id) => eligible.has(id) && !childMembers.has(id),
        ),
    )
  )
    return slide;
  return {
    ...slide,
    groups: [
      ...(slide.groups ?? []).map((g) =>
        children.includes(g)
          ? { ...g, parent_id: identity }
          : g.id === scope
            ? {
                ...g,
                element_ids: (g.element_ids ?? []).filter(
                  (id) => !eligible.has(id),
                ),
              }
            : g,
      ),
      {
        id: identity,
        name: "分组",
        parent_id: scope,
        element_ids: [...eligible].filter((id) => !childMembers.has(id)),
      },
    ],
  };
}

export function ungroup(slide: Slide, id: string): Slide {
  const group = (slide.groups ?? []).find((g) => g.id === id);
  if (!group) return slide;
  return {
    ...slide,
    groups: (slide.groups ?? [])
      .filter((g) => g.id !== id)
      .map((g) =>
        g.id === group.parent_id
          ? {
              ...g,
              element_ids: [
                ...(g.element_ids ?? []),
                ...(group.element_ids ?? []),
              ],
            }
          : g.parent_id === id
            ? { ...g, parent_id: group.parent_id }
            : g,
      ),
    infographics: (slide.infographics ?? []).filter((i) => i.group_id !== id),
  };
}

export function cleanScene(slide: Slide): Slide {
  const ids = new Set(slide.elements.map((e) => e.id));
  const groups = (slide.groups ?? []).map((g) => ({
    ...g,
    element_ids: (g.element_ids ?? []).filter((id) => ids.has(id)),
  }));
  const active = new Set(
    groups.filter((g) => g.element_ids.length).map((g) => g.id),
  );
  for (let pass = 0; pass < groups.length; pass++) {
    for (const g of groups)
      if (active.has(g.id) && g.parent_id) active.add(g.parent_id);
  }
  return {
    ...slide,
    groups: groups.filter((g) => active.has(g.id)),
    connections: (slide.connections ?? []).filter(
      (c) => ids.has(c.source_id) && ids.has(c.target_id),
    ),
    infographics: (slide.infographics ?? []).filter((i) =>
      active.has(i.group_id),
    ),
  };
}

export function updateScene(before: Slide, after: Slide): Slide {
  const remaining = new Set(after.elements.map((e) => e.id));
  return cleanScene({
    ...after,
    connections: (after.connections ?? []).map((c) => {
      const old = before.connections?.find((edge) => edge.id === c.id);
      const removedBelow =
        old && c.layer === old.layer
          ? before.elements
              .slice(0, old.layer ?? 0)
              .filter((e) => !remaining.has(e.id)).length
          : 0;
      const next = removedBelow
        ? { ...c, layer: (c.layer ?? 0) - removedBelow }
        : c;
      return c.waypoints === old?.waypoints
        ? followConnection(before, after, next)
        : next;
    }),
  });
}

export function cloneFragment(
  slide: Slide,
  ids: string[],
  makeId: () => string,
  offset = 24,
): Fragment {
  const selected = new Set(ids);
  const groups = (slide.groups ?? []).filter(
    (g) =>
      members(slide, g.id).length &&
      members(slide, g.id).every((id) => selected.has(id)),
  );
  const groupIds = new Set(groups.map((g) => g.id));
  const edges = (slide.connections ?? []).filter(
    (c) => selected.has(c.source_id) && selected.has(c.target_id),
  );
  const infos = (slide.infographics ?? []).filter((i) =>
    groupIds.has(i.group_id),
  );
  const mapping = new Map(
    [
      ...ids,
      ...groups.map((g) => g.id),
      ...edges.map((c) => c.id),
      ...infos.map((i) => i.id),
    ].map((id) => [id, makeId()]),
  );
  const remap = (id: string) => mapping.get(id)!;
  return {
    elements: slide.elements
      .filter((e) => selected.has(e.id))
      .map((e) => ({
        ...structuredClone(e),
        id: remap(e.id),
        x: e.x + offset,
        y: e.y + offset,
      })),
    groups: groups.map((g) => ({
      ...g,
      id: remap(g.id),
      parent_id:
        g.parent_id && groupIds.has(g.parent_id) ? remap(g.parent_id) : null,
      element_ids: (g.element_ids ?? []).map(remap),
    })),
    connections: edges.map((c) => ({
      ...c,
      layer: slide.elements
        .slice(0, c.layer ?? 0)
        .filter((e) => selected.has(e.id)).length,
      id: remap(c.id),
      source_id: remap(c.source_id),
      target_id: remap(c.target_id),
      waypoints: (c.waypoints ?? []).map((p) => ({
        x: p.x + offset,
        y: p.y + offset,
      })),
    })),
    infographics: infos.map((i) => ({
      ...i,
      id: remap(i.id),
      group_id: remap(i.group_id),
    })),
  };
}

export function appendFragment(slide: Slide, fragment: Fragment): Slide {
  if (slide.elements.length + fragment.elements.length > 200)
    throw new Error("每页最多 200 个元素，请拆分信息图");
  return {
    ...slide,
    elements: [...slide.elements, ...fragment.elements],
    groups: [...(slide.groups ?? []), ...(fragment.groups ?? [])],
    connections: [
      ...(slide.connections ?? []),
      ...(fragment.connections ?? []).map((edge) => ({
        ...edge,
        layer:
          slide.elements.length +
          Math.min(fragment.elements.length, edge.layer ?? 0),
      })),
    ],
    infographics: [
      ...(slide.infographics ?? []),
      ...(fragment.infographics ?? []),
    ],
  };
}

export function withoutGroup(slide: Slide, id: string): Slide {
  const ids = new Set(members(slide, id));
  return cleanScene({
    ...slide,
    elements: slide.elements.filter((e) => !ids.has(e.id)),
  });
}
