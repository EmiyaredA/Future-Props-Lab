import { describe, expect, it } from "vitest";
import { canConnectCanvasNodes } from "@features/visual-workshop/canvas/canvasGraph";
import type {
  VisualCanvasEdge,
  VisualCanvasNode,
} from "@features/visual-workshop/api";

const nodes: VisualCanvasNode[] = [
  { id: "image", kind: "image", title: "参考图", position: { x: 0, y: 0 } },
  { id: "video-a", kind: "video", title: "镜头 A", position: { x: 200, y: 0 } },
  { id: "video-b", kind: "video", title: "镜头 B", position: { x: 400, y: 0 } },
  {
    id: "sfx",
    kind: "audio",
    title: "音效",
    position: { x: 600, y: 0 },
    generation_draft: {
      mode: "sfx",
      prompt: "",
      output_format: "mp3",
      prompt_influence: 0.5,
      smart_duration: true,
      style: "",
      theme: "",
    },
  },
];

describe("visual canvas graph rules", () => {
  it("accepts compatible media references and rejects duplicates and cycles", () => {
    const edges: VisualCanvasEdge[] = [
      { id: "e1", source_node_id: "image", target_node_id: "video-a" },
      { id: "e2", source_node_id: "video-a", target_node_id: "video-b" },
    ];
    expect(canConnectCanvasNodes(nodes, edges, "image", "video-b")).toBe(true);
    expect(canConnectCanvasNodes(nodes, edges, "image", "video-a")).toBe(false);
    expect(canConnectCanvasNodes(nodes, edges, "video-b", "video-a")).toBe(
      false,
    );
    expect(canConnectCanvasNodes(nodes, edges, "video-a", "image")).toBe(false);
    expect(canConnectCanvasNodes(nodes, edges, "video-a", "sfx")).toBe(false);
  });
});
