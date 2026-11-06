import { describe, expect, it } from "vitest";
import {
  canConnectCanvasNodes,
  removeDisconnectedEdgeReferences,
} from "@features/visual-workshop/canvas/canvasGraph";
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

  it("removes references supplied by deleted edges while retaining other links", () => {
    const referenceNodes: VisualCanvasNode[] = [
      {
        id: "source-image",
        kind: "image",
        title: "图片来源",
        position: { x: 0, y: 0 },
        asset_id: "asset-image",
      },
      {
        id: "source-video",
        kind: "video",
        title: "视频来源",
        position: { x: 0, y: 200 },
        asset_id: "asset-video",
      },
      {
        id: "source-image-2",
        kind: "image",
        title: "图片来源副本",
        position: { x: 0, y: 100 },
        asset_id: "asset-image",
      },
      {
        id: "source-audio",
        kind: "audio",
        title: "音频来源",
        position: { x: 0, y: 400 },
        asset_id: "asset-audio",
      },
      {
        id: "target-video",
        kind: "video",
        title: "目标视频",
        position: { x: 300, y: 0 },
        generation_draft: {
          mode: "reference",
          prompt: "",
          duration: 5,
          resolution: "720p",
          ratio: "16:9",
          watermark: true,
          generate_audio: false,
          reference_asset_ids: ["asset-image", "manual-image"],
          video_asset_ids: ["asset-video"],
          audio_asset_ids: ["asset-audio", "manual-audio"],
          prompt_reference_names: {
            "asset-image": "图片来源",
            "asset-video": "视频来源",
            "asset-audio": "音频来源",
            "manual-image": "手动图片",
            "manual-audio": "手动音频",
          },
        },
      },
      {
        id: "target-image",
        kind: "image",
        title: "目标图片",
        position: { x: 300, y: 300 },
        generation_draft: {
          prompt: "",
          size: "1024x1024",
          image_count: 1,
          reference_asset_id: "asset-image",
          prompt_reference_names: { "asset-image": "图片来源" },
        },
      },
    ];
    const edges: VisualCanvasEdge[] = [
      {
        id: "image-a",
        source_node_id: "source-image",
        target_node_id: "target-video",
      },
      {
        id: "image-b",
        source_node_id: "source-image",
        target_node_id: "target-image",
      },
      {
        id: "image-c",
        source_node_id: "source-image-2",
        target_node_id: "target-video",
      },
      {
        id: "video",
        source_node_id: "source-video",
        target_node_id: "target-video",
      },
      {
        id: "audio",
        source_node_id: "source-audio",
        target_node_id: "target-video",
      },
    ];

    const cleaned = removeDisconnectedEdgeReferences(referenceNodes, edges, [
      "image-a",
      "image-c",
      "video",
      "audio",
    ]);
    const targetVideo = cleaned.find(
      (node) => node.id === "target-video",
    ) as Extract<VisualCanvasNode, { kind: "video" }>;
    expect(targetVideo?.generation_draft).toMatchObject({
      reference_asset_ids: ["manual-image"],
      video_asset_ids: [],
      audio_asset_ids: ["manual-audio"],
      prompt_reference_names: {
        "manual-image": "手动图片",
        "manual-audio": "手动音频",
      },
    });
    const targetImage = cleaned.find(
      (node) => node.id === "target-image",
    ) as Extract<VisualCanvasNode, { kind: "image" }>;
    expect(targetImage.generation_draft).toMatchObject({
      reference_asset_id: "asset-image",
    });

    const retained = removeDisconnectedEdgeReferences(referenceNodes, edges, [
      "image-a",
    ]);
    const retainedVideo = retained.find(
      (node) => node.id === "target-video",
    ) as Extract<VisualCanvasNode, { kind: "video" }>;
    expect(retainedVideo.generation_draft).toMatchObject({
      reference_asset_ids: ["asset-image", "manual-image"],
      video_asset_ids: ["asset-video"],
    });
  });
});
