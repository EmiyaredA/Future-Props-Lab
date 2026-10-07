import type { VisualCanvasEdge, VisualCanvasNode } from "../api";
import { NODE_SIZE } from "./geometry";
import {
  canvasBounds,
  placeNodeGroup,
  type CanvasPoint,
} from "./canvasPlacement";

export type CanvasLayoutMode = "flow" | "grid";

function grid(
  nodes: VisualCanvasNode[],
  anchor: CanvasPoint,
): VisualCanvasNode[] {
  const columns = Math.ceil(Math.sqrt(nodes.length));
  const width = Math.max(...nodes.map((node) => NODE_SIZE[node.kind].width));
  const height = Math.max(...nodes.map((node) => NODE_SIZE[node.kind].height));
  return nodes.map((node, index) => ({
    ...node,
    position: {
      x: anchor.x + (index % columns) * (width + 64),
      y: anchor.y + Math.floor(index / columns) * (height + 48),
    },
  }));
}

function flow(
  nodes: VisualCanvasNode[],
  edges: VisualCanvasEdge[],
  anchor: CanvasPoint,
): VisualCanvasNode[] {
  const ids = new Set(nodes.map((node) => node.id));
  const internal = edges.filter(
    (edge) => ids.has(edge.source_node_id) && ids.has(edge.target_node_id),
  );
  const neighbors = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of internal) {
    neighbors.get(edge.source_node_id)!.add(edge.target_node_id);
    neighbors.get(edge.target_node_id)!.add(edge.source_node_id);
    outgoing.get(edge.source_node_id)!.push(edge.target_node_id);
    indegree.set(edge.target_node_id, indegree.get(edge.target_node_id)! + 1);
  }
  const queue = nodes
    .filter((node) => indegree.get(node.id) === 0)
    .map((node) => node.id);
  const rank = new Map(nodes.map((node) => [node.id, 0]));
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    for (const target of outgoing.get(id)!) {
      rank.set(target, Math.max(rank.get(target)!, rank.get(id)! + 1));
      indegree.set(target, indegree.get(target)! - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  if (queue.length !== nodes.length)
    throw new Error("画布连线包含依赖环，无法按连线整理");
  const visited = new Set<string>();
  const components: VisualCanvasNode[][] = [];
  const isolated: VisualCanvasNode[] = [];
  for (const node of nodes) {
    if (!neighbors.get(node.id)!.size) {
      isolated.push(node);
      continue;
    }
    if (visited.has(node.id)) continue;
    const members = [node.id];
    visited.add(node.id);
    for (let index = 0; index < members.length; index++) {
      for (const neighbor of neighbors.get(members[index])!) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          members.push(neighbor);
        }
      }
    }
    const memberIds = new Set(members);
    components.push(nodes.filter((item) => memberIds.has(item.id)));
  }
  const arranged: VisualCanvasNode[] = [];
  let nextY = anchor.y;
  let right = anchor.x;
  for (const component of components) {
    let nextX = anchor.x;
    const maxRank = Math.max(...component.map((node) => rank.get(node.id)!));
    const placed: VisualCanvasNode[] = [];
    for (let layer = 0; layer <= maxRank; layer++) {
      const members = component.filter((node) => rank.get(node.id) === layer);
      let y = nextY;
      for (const node of members) {
        placed.push({ ...node, position: { x: nextX, y } });
        y += NODE_SIZE[node.kind].height + 48;
      }
      nextX +=
        Math.max(...members.map((node) => NODE_SIZE[node.kind].width)) + 96;
    }
    const bounds = canvasBounds(placed);
    right = Math.max(right, bounds.x + bounds.width);
    nextY += bounds.height + 96;
    arranged.push(...placed);
  }
  if (isolated.length)
    arranged.push(
      ...grid(isolated, {
        x: components.length ? right + 96 : anchor.x,
        y: anchor.y,
      }),
    );
  return arranged;
}

export function arrangeCanvasNodes(
  nodes: VisualCanvasNode[],
  edges: VisualCanvasEdge[],
  mode: CanvasLayoutMode,
  targetIds?: string[],
): VisualCanvasNode[] {
  const target = targetIds
    ? new Set(targetIds)
    : new Set(nodes.map((node) => node.id));
  const selected = nodes.filter((node) => target.has(node.id));
  if (selected.length < 2) return nodes;
  const anchor = canvasBounds(selected);
  const arranged =
    mode === "grid" ? grid(selected, anchor) : flow(selected, edges, anchor);
  const placed = placeNodeGroup(
    arranged,
    nodes.filter((node) => !target.has(node.id)),
    anchor,
  );
  const positions = new Map(placed.map((node) => [node.id, node.position]));
  let changed = false;
  const result = nodes.map((node) => {
    const position = positions.get(node.id);
    if (
      !position ||
      (position.x === node.position.x && position.y === node.position.y)
    )
      return node;
    changed = true;
    return { ...node, position } as VisualCanvasNode;
  });
  return changed ? result : nodes;
}
