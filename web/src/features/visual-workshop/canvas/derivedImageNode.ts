import type { ManagedFile } from "@features/files";
import type { VisualCanvasNode } from "@features/visual-workshop/api";
import { NODE_SIZE } from "./geometry";
import { placeNode } from "./canvasPlacement";

export function derivedImageNode(
  nodes: VisualCanvasNode[],
  sourceNodeId: string,
  asset: ManagedFile,
): VisualCanvasNode {
  // Stable across a failed canvas save, so retrying cannot append a second node.
  const id = `derived-image-${asset.id}`;
  const existing = nodes.find((node) => node.id === id);
  if (existing) return existing;
  const source = nodes.find((node) => node.id === sourceNodeId);
  if (!source || !["image", "video"].includes(source.kind))
    throw new Error("源节点已不存在，图片已保留在项目素材中。");
  const position = placeNode(nodes, "image", {
    x: source.position.x + NODE_SIZE[source.kind].width + 48,
    y: source.position.y,
  });
  return {
    id,
    kind: "image",
    title: asset.display_name,
    position,
    asset_id: asset.id,
  };
}
