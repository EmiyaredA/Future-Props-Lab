import type {
  VisualCanvasEdge,
  VisualCanvasNode,
} from "@features/visual-workshop/api";
import { removeDisconnectedEdgeReferences } from "./canvasGraph";
import { nextNodeId } from "./geometry";

export type CanvasPoint = { x: number; y: number };
export type CanvasClipboardSnapshot = {
  nodes: VisualCanvasNode[];
  edges: VisualCanvasEdge[];
  origin: CanvasPoint;
};

export function captureCanvasSelection(
  nodes: VisualCanvasNode[],
  edges: VisualCanvasEdge[],
  selectedIds: string[],
): CanvasClipboardSnapshot | undefined {
  const selected = new Set(selectedIds);
  const internalEdges = edges.filter(
    (edge) =>
      selected.has(edge.source_node_id) && selected.has(edge.target_node_id),
  );
  const internalIds = new Set(internalEdges.map((edge) => edge.id));
  const copiedNodes = removeDisconnectedEdgeReferences(
    nodes,
    edges,
    edges.filter((edge) => !internalIds.has(edge.id)).map((edge) => edge.id),
  ).filter((node) => selected.has(node.id));
  if (!copiedNodes.length) return;
  return structuredClone({
    nodes: copiedNodes,
    edges: internalEdges,
    origin: {
      x: Math.min(...copiedNodes.map((node) => node.position.x)),
      y: Math.min(...copiedNodes.map((node) => node.position.y)),
    },
  });
}

export function cloneCanvasSelection(
  snapshot: CanvasClipboardSnapshot,
  position: CanvasPoint,
): Pick<CanvasClipboardSnapshot, "nodes" | "edges"> {
  const copy = structuredClone(snapshot);
  const ids = new Map(
    copy.nodes.map((node) => [node.id, nextNodeId(node.kind)]),
  );
  const nodes = copy.nodes.map((node): VisualCanvasNode => {
    const base = {
      ...node,
      approved: false,
      id: ids.get(node.id)!,
      title: `${Array.from(node.title).slice(0, 117).join("")} 副本`,
      position: {
        x: position.x + node.position.x - copy.origin.x,
        y: position.y + node.position.y - copy.origin.y,
      },
    };
    if (base.kind === "text") return base;
    return {
      ...base,
      generation_task_id: null,
      ...(base.kind === "image" ? { generation_batch_id: null } : {}),
    };
  });
  const edges = copy.edges.map((edge) => ({
    ...edge,
    id: `edge-${crypto.randomUUID()}`,
    // A fixed version retains its owner; the copy continues referencing that exact output.
    source_node_id:
      edge.binding === "fixed"
        ? edge.source_node_id
        : ids.get(edge.source_node_id)!,
    target_node_id: ids.get(edge.target_node_id)!,
  }));
  return { nodes, edges };
}

export function canvasPasteError(
  current: { nodes: VisualCanvasNode[]; edges: VisualCanvasEdge[] },
  added: { nodes: VisualCanvasNode[]; edges: VisualCanvasEdge[] },
): string | undefined {
  if (current.nodes.length + added.nodes.length > 1000)
    return "粘贴后将超过画布的 1000 个节点上限";
  if (current.edges.length + added.edges.length > 2000)
    return "粘贴后将超过画布的 2000 条连线上限";
  if (
    added.nodes.some((node) =>
      [node.position.x, node.position.y].some(
        (value) => !Number.isFinite(value) || Math.abs(value) > 1_000_000,
      ),
    )
  )
    return "粘贴位置超出画布坐标范围";
}
