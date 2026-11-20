import type {
  VisualCanvasEdge,
  VisualCanvasGroup,
  VisualCanvasNode,
} from "../api";
import {
  canvasBounds,
  findFreePosition,
  nodeRect,
  placeNodeGroup,
  type CanvasPoint,
} from "./canvasPlacement";

export type CanvasLayoutMode = "flow" | "grid";

type LayoutUnit = {
  id: string;
  position: CanvasPoint;
  width: number;
  height: number;
};

function grid(nodes: LayoutUnit[], anchor: CanvasPoint): LayoutUnit[] {
  const columns = Math.ceil(Math.sqrt(nodes.length));
  const width = Math.max(...nodes.map((node) => node.width));
  const height = Math.max(...nodes.map((node) => node.height));
  return nodes.map((node, index) => ({
    ...node,
    position: {
      x: anchor.x + (index % columns) * (width + 64),
      y: anchor.y + Math.floor(index / columns) * (height + 48),
    },
  }));
}

function flow(
  nodes: LayoutUnit[],
  edges: VisualCanvasEdge[],
  anchor: CanvasPoint,
): LayoutUnit[] {
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
  const components: LayoutUnit[][] = [];
  const isolated: LayoutUnit[] = [];
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
  const arranged: LayoutUnit[] = [];
  let nextY = anchor.y;
  let right = anchor.x;
  for (const component of components) {
    let nextX = anchor.x;
    const maxRank = Math.max(...component.map((node) => rank.get(node.id)!));
    const placed: LayoutUnit[] = [];
    for (let layer = 0; layer <= maxRank; layer++) {
      const members = component.filter((node) => rank.get(node.id) === layer);
      let y = nextY;
      for (const node of members) {
        placed.push({ ...node, position: { x: nextX, y } });
        y += node.height + 48;
      }
      nextX += Math.max(...members.map((node) => node.width)) + 96;
    }
    right = Math.max(
      right,
      ...placed.map((item) => item.position.x + item.width),
    );
    nextY =
      Math.max(...placed.map((item) => item.position.y + item.height)) + 96;
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
  groups: VisualCanvasGroup[] = [],
): VisualCanvasNode[] {
  const target = new Set(targetIds ?? nodes.map((node) => node.id));
  const groupByNode = new Map(
    groups.flatMap((group) =>
      group.node_ids.map((id) => [id, group.id] as const),
    ),
  );
  for (const group of groups) {
    if (group.node_ids.some((id) => target.has(id))) {
      for (const id of group.node_ids) target.add(id);
    }
  }
  const selected = nodes.filter((node) => target.has(node.id));
  const members = new Map<string, VisualCanvasNode[]>();
  for (const node of selected) {
    const unit = groupByNode.get(node.id) ?? node.id;
    const existing = members.get(unit);
    if (existing) existing.push(node);
    else members.set(unit, [node]);
  }
  if (members.size < 2) return nodes;
  const units = [...members].map(([id, items]) => {
    const { x, y, width, height } = canvasBounds(items);
    return { id, position: { x, y }, width, height };
  });
  const anchor = canvasBounds(selected);
  const unitEdges = edges.flatMap((edge) => {
    const source = groupByNode.get(edge.source_node_id) ?? edge.source_node_id;
    const target = groupByNode.get(edge.target_node_id) ?? edge.target_node_id;
    return source === target
      ? []
      : [{ ...edge, source_node_id: source, target_node_id: target }];
  });
  let arranged: LayoutUnit[];
  if (mode === "grid") arranged = grid(units, anchor);
  else {
    try {
      arranged = flow(units, unitEdges, anchor);
    } catch (error) {
      if (!groups.length) throw error;
      // Collapsing a group can create a cycle between otherwise acyclic units.
      arranged = grid(units, anchor);
    }
  }
  const positions = new Map<string, CanvasPoint>();
  if (groups.length) {
    const obstacles = nodes
      .filter((node) => !target.has(node.id))
      .map(nodeRect);
    const originals = new Map(units.map(({ id, position }) => [id, position]));
    for (const unit of arranged) {
      const next = findFreePosition(obstacles, unit, unit.position);
      obstacles.push({ ...next, width: unit.width, height: unit.height });
      const origin = originals.get(unit.id)!;
      for (const node of members.get(unit.id)!) {
        positions.set(node.id, {
          x: node.position.x - origin.x + next.x,
          y: node.position.y - origin.y + next.y,
        });
      }
    }
  } else {
    const arrangedPositions = new Map(
      arranged.map((unit) => [unit.id, unit.position]),
    );
    const placed = placeNodeGroup(
      selected.map((node) => ({
        ...node,
        position: arrangedPositions.get(node.id)!,
      })),
      nodes.filter((node) => !target.has(node.id)),
      anchor,
    );
    for (const node of placed) positions.set(node.id, node.position);
  }
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
