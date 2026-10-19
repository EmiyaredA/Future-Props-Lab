import type { Slide } from "../types";
import { newId } from "../templates";
import { slideTheme } from "../slideTheme";
import type { Connection } from "./model";

export function newConnection(slide: Slide, selected: string[]): Connection {
  const nodes = slide.elements.filter((e) => e.kind !== "line");
  const source =
    selected.find((id) => nodes.some((e) => e.id === id)) ?? nodes[0]?.id ?? "";
  const target =
    selected.find((id) => id !== source && nodes.some((e) => e.id === id)) ??
    nodes.find((e) => e.id !== source)?.id ??
    "";
  return {
    id: newId(),
    source_id: source,
    target_id: target,
    source_anchor: "right",
    target_anchor: "left",
    style: "step",
    label: "",
    color: slideTheme.teal,
    width: 1.5,
    layer: 0,
    arrow: true,
    waypoints: [],
  };
}

export function validConnection(slide: Slide, edge: Connection): boolean {
  return (
    edge.source_id !== edge.target_id &&
    [edge.source_id, edge.target_id].every((id) =>
      slide.elements.some((e) => e.id === id && e.kind !== "line"),
    )
  );
}

export function patchConnection(
  edge: Connection,
  patch: Partial<Connection>,
): Connection {
  const reroute = (
    [
      "source_id",
      "target_id",
      "source_anchor",
      "target_anchor",
      "style",
    ] as const
  ).some((key) => key in patch && patch[key] !== edge[key]);
  return { ...edge, ...patch, ...(reroute ? { waypoints: [] } : {}) };
}
