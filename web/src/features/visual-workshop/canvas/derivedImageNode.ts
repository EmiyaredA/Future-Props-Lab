import type { ManagedFile } from "@features/files";
import type { VisualCanvasNode } from "@features/visual-workshop/api";
import { NODE_SIZE } from "./geometry";

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
  const position = {
    x: source.position.x + NODE_SIZE[source.kind].width + 48,
    y: source.position.y,
  };
  const size = NODE_SIZE.image;
  while (true) {
    const collisions = nodes.filter((node) => {
      const other = NODE_SIZE[node.kind];
      return (
        position.x < node.position.x + other.width + 24 &&
        position.x + size.width + 24 > node.position.x &&
        position.y < node.position.y + other.height + 24 &&
        position.y + size.height + 24 > node.position.y
      );
    });
    if (!collisions.length) break;
    position.y = Math.max(
      ...collisions.map(
        (node) => node.position.y + NODE_SIZE[node.kind].height + 48,
      ),
    );
  }
  return {
    id,
    kind: "image",
    title: asset.display_name,
    position,
    asset_id: asset.id,
  };
}
