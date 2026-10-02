import { newElement } from "./templates";
import type { CanvasScene } from "./model";
export function removeElements(
  scene: CanvasScene,
  ids: Set<string>,
): CanvasScene {
  return {
    ...scene,
    elements: scene.elements
      .filter((e) => !ids.has(e.id))
      .map((e) => {
        if (e.parentId && ids.has(e.parentId)) {
          const copy = { ...e };
          delete copy.parentId;
          return copy;
        }
        return e;
      }),
    edges: scene.edges.filter(
      (e) => !ids.has(e.source) && !ids.has(e.target) && !ids.has(e.id),
    ),
  };
}
export function groupElements(
  scene: CanvasScene,
  ids: Set<string>,
): CanvasScene {
  const selected = scene.elements.filter(
    (e) => ids.has(e.id) && e.kind !== "frame",
  );
  if (!selected.length) return scene;
  const x = Math.min(...selected.map((e) => e.x)) - 24,
    y = Math.min(...selected.map((e) => e.y)) - 44;
  const frame = {
    ...newElement("frame", x, y),
    width: Math.max(...selected.map((e) => e.x + e.width)) - x + 24,
    height: Math.max(...selected.map((e) => e.y + e.height)) - y + 24,
  };
  return {
    ...scene,
    elements: [
      frame,
      ...scene.elements.map((e) =>
        ids.has(e.id) && e.kind !== "frame" ? { ...e, parentId: frame.id } : e,
      ),
    ],
  };
}
export function duplicateElements(
  scene: CanvasScene,
  ids: Set<string>,
): CanvasScene {
  const selected = scene.elements.filter(
      (e) => ids.has(e.id) || (e.parentId && ids.has(e.parentId)),
    ),
    mapping = new Map(selected.map((e) => [e.id, crypto.randomUUID()]));
  const copies = selected.map((e) => {
    const copy = { ...e, id: mapping.get(e.id)!, x: e.x + 30, y: e.y + 30 };
    delete copy.parentId;
    if (e.parentId && mapping.has(e.parentId))
      copy.parentId = mapping.get(e.parentId);
    return copy;
  });
  return {
    ...scene,
    elements: [...scene.elements, ...copies],
    edges: [
      ...scene.edges,
      ...scene.edges
        .filter((e) => mapping.has(e.source) && mapping.has(e.target))
        .map((e) => ({
          ...e,
          id: crypto.randomUUID(),
          source: mapping.get(e.source)!,
          target: mapping.get(e.target)!,
        })),
    ],
  };
}
export function alignElements(
  scene: CanvasScene,
  ids: Set<string>,
  mode:
    | "left"
    | "right"
    | "top"
    | "bottom"
    | "centerX"
    | "centerY"
    | "horizontal"
    | "vertical",
): CanvasScene {
  const selected = scene.elements.filter(
    (e) => ids.has(e.id) && e.kind !== "frame",
  );
  if (selected.length < 2) return scene;
  const left = Math.min(...selected.map((e) => e.x)),
    right = Math.max(...selected.map((e) => e.x + e.width));
  const top = Math.min(...selected.map((e) => e.y)),
    bottom = Math.max(...selected.map((e) => e.y + e.height));
  const horizontal = mode === "horizontal";
  const sorted = [...selected].sort((a, b) =>
    horizontal ? a.x - b.x : a.y - b.y,
  );
  const span = horizontal
    ? sorted.at(-1)!.x + sorted.at(-1)!.width - sorted[0].x
    : sorted.at(-1)!.y + sorted.at(-1)!.height - sorted[0].y;
  const gap =
    (span -
      sorted.reduce((sum, e) => sum + (horizontal ? e.width : e.height), 0)) /
    (sorted.length - 1);
  return {
    ...scene,
    elements: scene.elements.map((e) => {
      if (!selected.includes(e)) return e;
      if (mode === "left") return { ...e, x: left };
      if (mode === "right") return { ...e, x: right - e.width };
      if (mode === "top") return { ...e, y: top };
      if (mode === "bottom") return { ...e, y: bottom - e.height };
      if (mode === "centerX") return { ...e, x: (left + right - e.width) / 2 };
      if (mode === "centerY") return { ...e, y: (top + bottom - e.height) / 2 };
      const index = sorted.indexOf(e),
        offset = sorted
          .slice(0, index)
          .reduce((sum, n) => sum + (horizontal ? n.width : n.height) + gap, 0);
      return {
        ...e,
        ...(horizontal
          ? { x: sorted[0].x + offset }
          : { y: sorted[0].y + offset }),
      };
    }),
  };
}
export function insertCanvasTemplate(
  scene: CanvasScene,
  template: CanvasScene,
): CanvasScene {
  const mapping = new Map(
    template.elements.map((e) => [e.id, crypto.randomUUID()]),
  );
  const offset = scene.elements.length
    ? Math.max(...scene.elements.map((e) => e.x + e.width)) + 60
    : 0;
  const copied = {
    ...template,
    elements: template.elements.map((e) => ({
      ...e,
      id: mapping.get(e.id)!,
      x: e.x + offset,
      ...(e.parentId ? { parentId: mapping.get(e.parentId)! } : {}),
    })),
    edges: template.edges.map((e) => ({
      ...e,
      id: crypto.randomUUID(),
      source: mapping.get(e.source)!,
      target: mapping.get(e.target)!,
    })),
  };
  const grouped = groupElements(
    copied,
    new Set(
      copied.elements
        .filter((e) => !e.parentId && e.kind !== "frame")
        .map((e) => e.id),
    ),
  );
  return {
    ...scene,
    elements: [...scene.elements, ...grouped.elements],
    edges: [...scene.edges, ...grouped.edges],
  };
}
