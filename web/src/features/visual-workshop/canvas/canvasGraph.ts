import type {
  VisualCanvasEdge,
  VisualCanvasNode,
} from "@features/visual-workshop/api";

export function canConnectCanvasNodes(
  nodes: VisualCanvasNode[],
  edges: VisualCanvasEdge[],
  sourceNodeId: string,
  targetNodeId: string,
) {
  if (sourceNodeId === targetNodeId) return false;
  const source = nodes.find((node) => node.id === sourceNodeId);
  const target = nodes.find((node) => node.id === targetNodeId);
  if (!source || !target || source.kind === "text" || target.kind === "text")
    return false;
  if (target.kind === "image" && source.kind !== "image") return false;
  if (target.kind === "audio" && source.kind !== "audio") return false;
  if (target.kind === "audio" && target.generation_draft?.mode === "sfx")
    return false;
  if (
    edges.some(
      (edge) =>
        edge.source_node_id === sourceNodeId &&
        edge.target_node_id === targetNodeId,
    )
  )
    return false;
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = outgoing.get(edge.source_node_id) ?? [];
    targets.push(edge.target_node_id);
    outgoing.set(edge.source_node_id, targets);
  }
  const pending = [targetNodeId];
  const visited = new Set<string>();
  while (pending.length) {
    const nodeId = pending.pop();
    if (!nodeId || visited.has(nodeId)) continue;
    if (nodeId === sourceNodeId) return false;
    visited.add(nodeId);
    pending.push(...(outgoing.get(nodeId) ?? []));
  }
  return true;
}
