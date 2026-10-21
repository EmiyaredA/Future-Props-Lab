import { layoutGraph } from "./elkLayout";
import type { ElkNode } from "elkjs/lib/elk-api";
import type { Slide } from "../types";
import { members, type Connection } from "../scene/model";

export async function layoutScene(
  slide: Slide,
  groupId?: string,
): Promise<Slide> {
  const allowed = new Set(
    groupId ? members(slide, groupId) : slide.elements.map((e) => e.id),
  );
  const edges = (slide.connections ?? []).filter(
    (c) =>
      !!c.source_id &&
      !!c.target_id &&
      allowed.has(c.source_id) &&
      allowed.has(c.target_id),
  );
  if (!edges.length) throw new Error("此区域没有节点连接，无法自动布局");
  const nodeIds = new Set(edges.flatMap((c) => [c.source_id, c.target_id]));
  const nodes = slide.elements.filter((e) => nodeIds.has(e.id));
  const groups = slide.groups ?? [];
  const owners = new Map(
    nodes.map((e) => [
      e.id,
      groups.find((g) => (g.element_ids ?? []).includes(e.id)),
    ]),
  );
  const moving = new Set(
    nodes.flatMap((e) => {
      const owner = owners.get(e.id);
      return owner &&
        (owner.element_ids ?? []).filter((id) => nodeIds.has(id)).length === 1
        ? (owner.element_ids ?? [])
        : [e.id];
    }),
  );
  if (slide.elements.some((e) => moving.has(e.id) && e.locked))
    throw new Error("请先解锁参与布局的节点及组内成员");
  const options = {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    "elk.spacing.nodeNode": "40",
    "elk.layered.spacing.nodeNodeBetweenLayers": "65",
    "elk.padding": "[top=12,left=12,bottom=12,right=12]",
  };
  const graphInput: ElkNode = {
    id: "layout-root",
    layoutOptions: options,
    children: [],
    edges: edges.map((c) => ({
      id: c.id,
      sources: [`${c.source_id}:${c.source_anchor ?? "right"}`],
      targets: [`${c.target_id}:${c.target_anchor ?? "left"}`],
    })),
  };
  // A group containing child node groups is a compound ELK node. Leaf groups
  // remain a single rectangle plus its editable text and decoration.
  const containers = new Map<string, ElkNode>();
  for (const g of groups) {
    const count = members(slide, g.id).filter((id) => nodeIds.has(id)).length;
    if (g.id !== groupId && count > 1)
      containers.set(g.id, {
        id: `group:${g.id}`,
        layoutOptions: options,
        children: [],
      });
  }
  const parentContainer = (parent?: string | null): ElkNode => {
    while (parent) {
      const container = containers.get(parent);
      if (container) return container;
      parent = groups.find((g) => g.id === parent)?.parent_id;
    }
    return graphInput;
  };
  for (const g of groups) {
    const container = containers.get(g.id);
    if (container) parentContainer(g.parent_id).children!.push(container);
  }
  const sides = { left: "WEST", right: "EAST", top: "NORTH", bottom: "SOUTH" };
  for (const e of nodes)
    parentContainer(owners.get(e.id)?.id).children!.push({
      id: e.id,
      width: e.width,
      height: e.height,
      layoutOptions: { "elk.portConstraints": "FIXED_SIDE" },
      ports: Object.entries(sides).map(([port, side]) => ({
        id: `${e.id}:${port}`,
        width: 0,
        height: 0,
        layoutOptions: { "elk.port.side": side },
      })),
    });
  const graph = await layoutGraph(graphInput);
  if ((graph.width ?? 0) > 1120 || (graph.height ?? 0) > 530)
    throw new Error("布局超出页面可用区域，请减少节点或拆页");
  const dx = (1280 - (graph.width ?? 0)) / 2,
    dy = 135 + (530 - (graph.height ?? 0)) / 2;
  const positions = new Map<string, { x: number; y: number }>();
  const routed = new Map<string, { x: number; y: number }[]>();
  const collect = (node: ElkNode, x: number, y: number) => {
    const p = { x: x + (node.x ?? 0), y: y + (node.y ?? 0) };
    positions.set(node.id, p);
    for (const child of node.children ?? []) collect(child, p.x, p.y);
  };
  collect(graph, dx, dy);
  const routes = (node: ElkNode) => {
    for (const edge of node.edges ?? []) {
      const origin = positions.get(edge.container ?? node.id) ?? {
        x: dx,
        y: dy,
      };
      const sections = edge.sections ?? [];
      if (sections.length > 1)
        throw new Error("此复合关系的路由尚不能完整转换，请简化分组后重试");
      routed.set(
        edge.id!,
        (sections[0]?.bendPoints ?? []).map((p) => ({
          x: origin.x + p.x,
          y: origin.y + p.y,
        })),
      );
    }
    for (const child of node.children ?? []) routes(child);
  };
  routes(graph);
  const deltas = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const p = positions.get(node.id)!;
    const owner = owners.get(node.id);
    const ids =
      owner &&
      (owner.element_ids ?? []).filter((id) => nodeIds.has(id)).length === 1
        ? (owner.element_ids ?? [])
        : [node.id];
    for (const id of ids) deltas.set(id, { x: p.x - node.x, y: p.y - node.y });
  }
  return {
    ...slide,
    elements: slide.elements.map((e) => {
      const d = deltas.get(e.id);
      return d ? { ...e, x: e.x + d.x, y: e.y + d.y } : e;
    }),
    connections: (slide.connections ?? []).map((c): Connection =>
      routed.has(c.id)
        ? { ...c, style: "step", waypoints: routed.get(c.id)! }
        : c,
    ),
  };
}
