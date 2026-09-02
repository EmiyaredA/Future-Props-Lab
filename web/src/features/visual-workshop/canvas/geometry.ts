import type { VisualCanvasNode } from "@features/visual-workshop/api";

export type Viewport = { x: number; y: number; zoom: number };
export type NodeKind = VisualCanvasNode["kind"];

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };
export const NODE_SIZE: Record<NodeKind, { width: number; height: number }> = {
  text: { width: 300, height: 180 },
  image: { width: 320, height: 214 },
  video: { width: 320, height: 214 },
  audio: { width: 300, height: 132 },
};
export const ATTACHED_EDITOR_SIZE: Partial<
  Record<NodeKind, { width: number; height: number; gap: number }>
> = {
  image: { width: 980, height: 460, gap: 22 },
  video: { width: 980, height: 500, gap: 22 },
  audio: { width: 980, height: 450, gap: 22 },
};
export const NODE_DRAG_BLOCKER_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "audio",
  "[data-canvas-media-interactive='true']",
  "[contenteditable='true']",
  ".canvas-node-port",
  ".canvas-node-inspector",
  ".project-assistant-panel",
].join(",");

export function readViewport(projectId: string): Viewport {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(`fpl_canvas_viewport_${projectId}`) || "null",
    ) as Viewport | null;
    if (
      value &&
      Number.isFinite(value.x) &&
      Number.isFinite(value.y) &&
      value.zoom >= 0.25 &&
      value.zoom <= 2
    )
      return value;
  } catch {
    // Corrupt browser preferences fall back to a centered canvas.
  }
  return DEFAULT_VIEWPORT;
}

export function clampZoom(value: number) {
  return Math.min(2, Math.max(0.25, value));
}

export function nextNodeId(kind: NodeKind) {
  const random =
    globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${kind}-${random}`;
}

export function nodeLabel(kind: NodeKind) {
  return { text: "文本", image: "图片", video: "视频", audio: "音频" }[kind];
}

export function cloneNode(
  node: VisualCanvasNode,
  position: { x: number; y: number },
): VisualCanvasNode {
  return {
    ...node,
    id: nextNodeId(node.kind),
    title: `${node.title} 副本`,
    position,
  } as VisualCanvasNode;
}
