import { describe, expect, test } from "vitest";
import type {
  VisualCanvasEdge,
  VisualCanvasNode,
} from "@features/visual-workshop/api";
import {
  captureCanvasSelection,
  cloneCanvasSelection,
  canvasPasteError,
} from "@features/visual-workshop/canvas/canvasClipboard";

const nodes: VisualCanvasNode[] = [
  {
    id: "outside",
    kind: "image",
    title: "外部参考",
    asset_id: "external",
    position: { x: -100, y: 50 },
  },
  {
    id: "image",
    kind: "image",
    title: "原图",
    asset_id: "asset",
    generation_task_id: "task",
    generation_batch_id: "batch",
    position: { x: 100, y: 80 },
  },
  {
    id: "video",
    kind: "video",
    title: "视频",
    asset_id: "video-asset",
    generation_task_id: "video-task",
    position: { x: 420, y: 120 },
    generation_draft: {
      prompt: "参考",
      mode: "text",
      duration: 5,
      resolution: "720p",
      ratio: "16:9",
      watermark: true,
      generate_audio: false,
      reference_asset_ids: ["asset", "external", "manual"],
      prompt_reference_names: {
        asset: "原图",
        external: "外部参考",
        manual: "手动素材",
      },
    },
  },
  {
    id: "text",
    kind: "text",
    title: "说明",
    text: "保留正文",
    position: { x: 150, y: 400 },
  },
  {
    id: "audio",
    kind: "audio",
    title: "配乐",
    asset_id: "audio-asset",
    generation_task_id: "audio-task",
    position: { x: 500, y: 400 },
    generation_draft: {
      prompt: "安静的音乐",
      mode: "music",
      output_format: "mp3",
      prompt_influence: 0.5,
      smart_duration: true,
      style: "",
      theme: "",
    },
  },
];
const edges: VisualCanvasEdge[] = [
  { id: "internal", source_node_id: "image", target_node_id: "video" },
  { id: "external-edge", source_node_id: "outside", target_node_id: "video" },
];

describe("canvas selection snapshot", () => {
  test("captures internal edges and strips only discarded edge references", () => {
    const snapshot = captureCanvasSelection(nodes, edges, [
      "image",
      "video",
      "text",
      "audio",
      "missing",
    ])!;
    expect(snapshot.origin).toEqual({ x: 100, y: 80 });
    expect(snapshot.edges).toEqual([edges[0]]);
    expect(snapshot.nodes).toHaveLength(4);
    expect(snapshot.nodes[1]).toMatchObject({
      generation_draft: {
        reference_asset_ids: ["asset", "manual"],
        prompt_reference_names: { asset: "原图", manual: "手动素材" },
      },
    });
    expect(
      snapshot.nodes[1].kind === "video" &&
        snapshot.nodes[1].generation_draft?.prompt_reference_names,
    ).not.toHaveProperty("external");
    expect(nodes[2]).toMatchObject({
      generation_draft: {
        reference_asset_ids: ["asset", "external", "manual"],
      },
    });
  });

  test("keeps an asset reference supplied by a remaining internal edge", () => {
    const sharedNodes = structuredClone(nodes);
    if (sharedNodes[0].kind !== "text") sharedNodes[0].asset_id = "asset";
    const snapshot = captureCanvasSelection(sharedNodes, edges, [
      "image",
      "video",
    ])!;
    expect(snapshot.nodes[1]).toMatchObject({
      generation_draft: {
        reference_asset_ids: ["asset", "external", "manual"],
      },
    });
  });

  test("returns no replacement snapshot for an empty or stale selection", () => {
    expect(captureCanvasSelection(nodes, edges, [])).toBeUndefined();
    expect(captureCanvasSelection(nodes, edges, ["missing"])).toBeUndefined();
  });

  test("clones all node kinds independently, remaps edges and preserves layout", () => {
    const snapshot = captureCanvasSelection(nodes, edges, [
      "image",
      "video",
      "text",
      "audio",
    ])!;
    const result = cloneCanvasSelection(snapshot, { x: -50, y: 200 });
    expect(result.nodes.map((node) => node.position)).toEqual([
      { x: -50, y: 200 },
      { x: 270, y: 240 },
      { x: 0, y: 520 },
      { x: 350, y: 520 },
    ]);
    expect(result.nodes[0]).toMatchObject({
      title: "原图 副本",
      asset_id: "asset",
      generation_task_id: null,
      generation_batch_id: null,
    });
    expect(result.nodes[2]).toMatchObject({ text: "保留正文" });
    for (const node of result.nodes) {
      expect(snapshot.nodes.map((source) => source.id)).not.toContain(node.id);
      if (node.kind !== "text") expect(node.generation_task_id).toBeNull();
    }
    expect(result.edges[0]).toEqual({
      id: expect.not.stringMatching(/^internal$/),
      source_node_id: result.nodes[0].id,
      target_node_id: result.nodes[1].id,
    });
    if (result.nodes[1].kind === "video")
      result.nodes[1].generation_draft!.reference_asset_ids!.push("mutated");
    expect(
      cloneCanvasSelection(snapshot, { x: 0, y: 0 }).nodes[1],
    ).toMatchObject({
      generation_draft: { reference_asset_ids: ["asset", "manual"] },
    });
    if (nodes[2].kind === "video")
      nodes[2].generation_draft!.prompt = "changed after copy";
    expect(snapshot.nodes[1]).toMatchObject({
      generation_draft: { prompt: "参考" },
    });
  });

  test("limits copied titles by Unicode characters including the suffix", () => {
    const source: VisualCanvasNode = {
      id: "long",
      kind: "text",
      title: "😀".repeat(120),
      text: "",
      position: { x: 0, y: 0 },
    };
    const result = cloneCanvasSelection(
      captureCanvasSelection([source], [], ["long"])!,
      { x: 0, y: 0 },
    );
    expect(Array.from(result.nodes[0].title)).toHaveLength(120);
    expect(result.nodes[0].title.endsWith(" 副本")).toBe(true);
  });
});

test("checks node, edge and coordinate boundaries before adding anything", () => {
  const added = cloneCanvasSelection(
    captureCanvasSelection(nodes, edges, ["image", "video"])!,
    { x: 0, y: 0 },
  );
  expect(
    canvasPasteError(
      { nodes: Array(498).fill(nodes[0]), edges: Array(999).fill(edges[0]) },
      added,
    ),
  ).toBeUndefined();
  expect(
    canvasPasteError({ nodes: Array(499).fill(nodes[0]), edges: [] }, added),
  ).toContain("500");
  expect(
    canvasPasteError({ nodes: [], edges: Array(1000).fill(edges[0]) }, added),
  ).toContain("1000");
  for (const x of [-1_000_001, 1_000_001, Infinity, NaN]) {
    expect(
      canvasPasteError(
        { nodes: [], edges: [] },
        { nodes: [{ ...nodes[0], position: { x, y: 0 } }], edges: [] },
      ),
    ).toContain("坐标");
  }
  expect(
    canvasPasteError(
      { nodes: [], edges: [] },
      {
        nodes: [{ ...nodes[0], position: { x: -1_000_000, y: 1_000_000 } }],
        edges: [],
      },
    ),
  ).toBeUndefined();
});
