import type { VisualCanvasNode } from "@features/visual-workshop/api";
import {
  ATTACHED_EDITOR_SIZE,
  NODE_SIZE,
  clampZoom,
  type Viewport,
} from "@features/visual-workshop/canvas/geometry";

export function fitCanvasViewport(
  nodes: VisualCanvasNode[],
  expandedId: string | undefined,
  bounds: DOMRect,
  panelBounds?: DOMRect,
): Viewport {
  let availableLeft = 0;
  let availableRight = bounds.width;
  if (panelBounds) {
    if (panelBounds.left < bounds.left + bounds.width / 2) {
      availableLeft = Math.min(
        bounds.width,
        Math.max(0, panelBounds.right - bounds.left + 24),
      );
    } else {
      availableRight = Math.max(
        0,
        Math.min(bounds.width, panelBounds.left - bounds.left - 24),
      );
    }
  }
  const attached = (node: VisualCanvasNode) =>
    node.id === expandedId ? ATTACHED_EDITOR_SIZE[node.kind] : undefined;
  const minX = Math.min(
    ...nodes.map((node) => {
      const editor = attached(node);
      return editor
        ? node.position.x -
            Math.max(0, (editor.width - NODE_SIZE[node.kind].width) / 2)
        : node.position.x;
    }),
  );
  const minY = Math.min(...nodes.map((node) => node.position.y));
  const maxX = Math.max(
    ...nodes.map((node) => {
      const editor = attached(node);
      return (
        node.position.x +
        NODE_SIZE[node.kind].width +
        (editor
          ? Math.max(0, (editor.width - NODE_SIZE[node.kind].width) / 2)
          : 0)
      );
    }),
  );
  const maxY = Math.max(
    ...nodes.map((node) => {
      const editor = attached(node);
      return (
        node.position.y +
        NODE_SIZE[node.kind].height +
        (editor ? editor.gap + editor.height : 0)
      );
    }),
  );
  const availableWidth = Math.max(1, availableRight - availableLeft);
  const padding = 120;
  const zoom = clampZoom(
    Math.min(
      1.4,
      (availableWidth - padding * 2) / Math.max(1, maxX - minX),
      (bounds.height - padding * 2) / Math.max(1, maxY - minY),
    ),
  );
  return {
    zoom,
    x: availableLeft + availableWidth / 2 - ((minX + maxX) / 2) * zoom,
    y: bounds.height / 2 - ((minY + maxY) / 2) * zoom,
  };
}
