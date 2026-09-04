import type {
  VisualCanvasEdge,
  VisualCanvasNode,
} from "@features/visual-workshop/api";

type ReferenceArrayField =
  "reference_asset_ids" | "video_asset_ids" | "audio_asset_ids";

type ReferenceField = "reference_asset_id" | ReferenceArrayField;

function referenceFieldForEdge(
  source: VisualCanvasNode,
  target: VisualCanvasNode,
): ReferenceField | undefined {
  if (source.kind === "text" || target.kind === "text") return undefined;
  if (target.kind === "image" && source.kind === "image")
    return "reference_asset_id";
  if (target.kind === "audio" && source.kind === "audio")
    return "reference_asset_ids";
  if (target.kind !== "video") return undefined;
  if (source.kind === "image") return "reference_asset_ids";
  if (source.kind === "video") return "video_asset_ids";
  return "audio_asset_ids";
}

function draftAssetIds(draft: Record<string, unknown>) {
  return [
    draft.reference_asset_id,
    draft.first_frame_asset_id,
    draft.last_frame_asset_id,
    ...(Array.isArray(draft.reference_asset_ids)
      ? draft.reference_asset_ids
      : []),
    ...(Array.isArray(draft.video_asset_ids) ? draft.video_asset_ids : []),
    ...(Array.isArray(draft.audio_asset_ids) ? draft.audio_asset_ids : []),
  ].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

/** Remove persisted references that were supplied by deleted canvas edges. */
export function removeDisconnectedEdgeReferences(
  nodes: VisualCanvasNode[],
  edges: VisualCanvasEdge[],
  removedEdgeIds: Iterable<string>,
): VisualCanvasNode[] {
  const removed = new Set(removedEdgeIds);
  if (!removed.size) return nodes;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const remaining = edges.filter((edge) => !removed.has(edge.id));
  const removals = new Map<string, Map<ReferenceField, Set<string>>>();

  const addAsset = (
    targetId: string,
    field: ReferenceField,
    assetId: string,
    into: Map<string, Map<ReferenceField, Set<string>>>,
  ) => {
    const fields = into.get(targetId) ?? new Map<ReferenceField, Set<string>>();
    const assets = fields.get(field) ?? new Set<string>();
    assets.add(assetId);
    fields.set(field, assets);
    into.set(targetId, fields);
  };

  const remainingAssets = new Map<string, Set<string>>();
  for (const edge of remaining) {
    const source = nodeById.get(edge.source_node_id);
    const target = nodeById.get(edge.target_node_id);
    const assetId = source?.kind !== "text" ? source?.asset_id : undefined;
    const field =
      source && target ? referenceFieldForEdge(source, target) : undefined;
    if (!assetId || !field || !target) continue;
    const key = `${target.id}:${field}`;
    const assets = remainingAssets.get(key) ?? new Set<string>();
    assets.add(assetId);
    remainingAssets.set(key, assets);
  }

  for (const edge of edges) {
    if (!removed.has(edge.id)) continue;
    const source = nodeById.get(edge.source_node_id);
    const target = nodeById.get(edge.target_node_id);
    const assetId = source?.kind !== "text" ? source?.asset_id : undefined;
    const field =
      source && target ? referenceFieldForEdge(source, target) : undefined;
    if (!assetId || !field || !target) continue;
    if (remainingAssets.get(`${target.id}:${field}`)?.has(assetId)) continue;
    addAsset(target.id, field, assetId, removals);
  }

  if (!removals.size) return nodes;
  return nodes.map((node) => {
    const fields = removals.get(node.id);
    if (node.kind === "text" || !fields || !node.generation_draft) return node;
    const draft = { ...node.generation_draft } as Record<string, unknown>;
    for (const [field, assetIds] of fields) {
      if (field === "reference_asset_id") {
        if (assetIds.has(draft.reference_asset_id as string))
          draft.reference_asset_id = null;
        continue;
      }
      const values = Array.isArray(draft[field]) ? draft[field] : [];
      draft[field] = values.filter(
        (value): value is string =>
          typeof value === "string" && !assetIds.has(value),
      );
    }
    if (
      draft.prompt_reference_names &&
      typeof draft.prompt_reference_names === "object"
    ) {
      const names = {
        ...(draft.prompt_reference_names as Record<string, string>),
      };
      for (const assetId of new Set(
        [...fields.values()].flatMap((ids) => [...ids]),
      )) {
        if (!draftAssetIds(draft).includes(assetId)) delete names[assetId];
      }
      draft.prompt_reference_names = names;
    }
    return { ...node, generation_draft: draft } as VisualCanvasNode;
  });
}

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
