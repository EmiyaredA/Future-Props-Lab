import type { Slide } from "../types";
import type { Connection } from "./model";

export type OrderMode = "front" | "forward" | "backward" | "back";
export type SceneItem =
  | { kind: "element"; id: string }
  | { kind: "connection"; id: string; edge: Connection };

/** Back to front. Missing layers preserve the original connections-first order. */
export function sceneOrder(slide: Slide): SceneItem[] {
  const edges = new Map<number, Connection[]>();
  for (const edge of slide.connections ?? []) {
    const layer = Math.min(edge.layer ?? 0, slide.elements.length);
    const bucket = edges.get(layer) ?? [];
    bucket.push(edge);
    edges.set(layer, bucket);
  }
  const result: SceneItem[] = [];
  for (let i = 0; i <= slide.elements.length; i++) {
    for (const edge of edges.get(i) ?? [])
      result.push({ kind: "connection", id: edge.id, edge });
    if (i < slide.elements.length)
      result.push({ kind: "element", id: slide.elements[i].id });
  }
  return result;
}

export function orderScene(
  slide: Slide,
  ids: string[],
  mode: OrderMode,
): Slide {
  const selected = new Set(ids);
  const original = sceneOrder(slide);
  let items = [...original];
  const chosen = (item: SceneItem) => selected.has(item.id);
  if (mode === "front")
    items = [...items.filter((i) => !chosen(i)), ...items.filter(chosen)];
  if (mode === "back")
    items = [...items.filter(chosen), ...items.filter((i) => !chosen(i))];
  if (mode === "forward")
    for (let i = items.length - 2; i >= 0; i--)
      if (chosen(items[i]) && !chosen(items[i + 1]))
        [items[i], items[i + 1]] = [items[i + 1], items[i]];
  if (mode === "backward")
    for (let i = 1; i < items.length; i++)
      if (chosen(items[i]) && !chosen(items[i - 1]))
        [items[i], items[i - 1]] = [items[i - 1], items[i]];
  if (items.every((item, i) => item === original[i])) return slide;
  const byId = new Map(slide.elements.map((e) => [e.id, e]));
  const elements: Slide["elements"] = [];
  const connections: Connection[] = [];
  for (const item of items) {
    if (item.kind === "element") elements.push(byId.get(item.id)!);
    else connections.push({ ...item.edge, layer: elements.length });
  }
  return { ...slide, elements, connections };
}
