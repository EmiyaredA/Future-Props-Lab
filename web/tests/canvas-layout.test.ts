import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import type {
  VisualCanvasEdge,
  VisualCanvasNode,
} from "@features/visual-workshop/api";
import { NODE_SIZE } from "@features/visual-workshop/canvas/geometry";
import { arrangeCanvasNodes } from "@features/visual-workshop/canvas/canvasLayout";
import {
  batchInsertionAnchor,
  canvasBounds,
  nodeRect,
  placeNode,
  placeNodeGroup,
  rectanglesOverlap,
  type PlacedNode,
} from "@features/visual-workshop/canvas/canvasPlacement";
import {
  revealCanvasBounds,
  visibleCanvasArea,
  worldVisibleArea,
} from "@features/visual-workshop/canvas/canvasVisibleArea";
import { derivedImageNode } from "@features/visual-workshop/canvas/derivedImageNode";
import type { ManagedFile } from "@features/files";

const fixture = JSON.parse(
  readFileSync("../tests/fixtures/visual_node_placement.json", "utf8"),
) as {
  sizes: typeof NODE_SIZE;
  cases: {
    name: string;
    nodes: PlacedNode[];
    kind: VisualCanvasNode["kind"];
    anchor: { x: number; y: number };
    expected: { x: number; y: number };
  }[];
};
const node = (
  id: string,
  kind: VisualCanvasNode["kind"] = "image",
  x = 0,
  y = 0,
): VisualCanvasNode =>
  ({
    id,
    kind,
    title: id,
    position: { x, y },
    ...(kind === "text" ? { text: "原文" } : {}),
  }) as VisualCanvasNode;
const edge = (source: string, target: string): VisualCanvasEdge => ({
  id: `${source}-${target}`,
  source_node_id: source,
  target_node_id: target,
});
function expectSeparated(nodes: PlacedNode[]) {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++)
      expect(rectanglesOverlap(nodeRect(nodes[i]), nodeRect(nodes[j]))).toBe(
        false,
      );
  }
}

test("browser and background placement share dimensions and deterministic results", () => {
  expect(NODE_SIZE).toEqual(fixture.sizes);
  for (const sample of fixture.cases) {
    expect(
      placeNode(sample.nodes, sample.kind, sample.anchor),
      sample.name,
    ).toEqual(sample.expected);
  }
});

test("repeated additions and batch media never cover existing cards", () => {
  const nodes = [node("original", "text", 100, 100)];
  const original = structuredClone(nodes[0]);
  for (let index = 0; index < 40; index++) {
    const kind = index % 2 ? "image" : "audio";
    const added = node(`new-${index}`, kind);
    added.position = placeNode(
      nodes,
      kind,
      batchInsertionAnchor({ x: 100, y: 100 }, index, 40),
    );
    nodes.push(added);
  }
  expectSeparated(nodes);
  expect(nodes[0]).toEqual(original);
});

test("dense placement uses a bounded fallback and rejects nonfinite input", () => {
  const nodes = Array.from({ length: 441 }, (_, index) =>
    node(
      String(index),
      "image",
      ((index % 21) - 10) * 352,
      (Math.floor(index / 21) - 10) * 246,
    ),
  );
  expect(placeNode(nodes, "image", { x: 0, y: 0 })).toEqual({ x: 3872, y: 0 });
  expect(() => placeNode([], "image", { x: NaN, y: 0 })).toThrow("坐标范围");
});

test("toolbar placement prefers free space inside the visible canvas", () => {
  const nodes = [node("occupied")];
  const area = { x: 0, y: 0, width: 1000, height: 230 };
  expect(placeNode(nodes, "image", { x: 0, y: 0 })).toEqual({ x: 0, y: 246 });
  expect(placeNode(nodes, "image", { x: 0, y: 0 }, area)).toEqual({
    x: 352,
    y: 0,
  });
});

test("paste shifts the group while preserving internal overlaps and relative offsets", () => {
  const nodes = [node("a", "image", 10, 20), node("b", "audio", 30, 40)];
  const blocker = node("outside", "video", 10, 20);
  const placed = placeNodeGroup(nodes, [blocker], { x: 10, y: 20 });
  expect(rectanglesOverlap(canvasBounds(placed), nodeRect(blocker))).toBe(
    false,
  );
  expect(placed[1].position.x - placed[0].position.x).toBe(20);
  expect(placed[1].position.y - placed[0].position.y).toBe(20);
  expect(rectanglesOverlap(nodeRect(placed[0]), nodeRect(placed[1]))).toBe(
    true,
  );
  expect(nodes[0].position).toEqual({ x: 10, y: 20 });
});

test("flow arranges branches, merges, independent flows and loose media without changing metadata", () => {
  const nodes = [
    node("root", "text"),
    node("a"),
    node("b"),
    node("merge", "video"),
    node("loose", "audio"),
    node("second"),
    node("second-end"),
  ];
  const edges = [
    edge("root", "a"),
    edge("root", "b"),
    {
      ...edge("a", "merge"),
      binding: "fixed" as const,
      output_id: "version-1",
    },
    edge("b", "merge"),
    edge("second", "second-end"),
  ];
  const originals = structuredClone(nodes);
  const result = arrangeCanvasNodes(nodes, edges, "flow");
  const byId = new Map(result.map((n) => [n.id, n]));
  expect(byId.get("a")!.position.x).toBe(byId.get("b")!.position.x);
  expect(byId.get("merge")!.position.x).toBeGreaterThan(
    byId.get("a")!.position.x,
  );
  expect(byId.get("second")!.position.y).toBeGreaterThan(
    byId.get("merge")!.position.y,
  );
  expect(byId.get("loose")!.position.x).toBeGreaterThan(
    byId.get("merge")!.position.x,
  );
  expectSeparated(result);
  expect(nodes).toEqual(originals);
  result.forEach((n, i) =>
    expect({ ...n, position: nodes[i].position }).toEqual(nodes[i]),
  );
  expect(edges[2].output_id).toBe("version-1");
  expect(arrangeCanvasNodes(result, edges, "flow")).toBe(result);
});

test("selected layout only changes the selected subgraph and avoids stationary nodes", () => {
  const nodes = [
    node("outside", "video"),
    node("a", "image", 10, 10),
    node("b", "text", 15, 15),
  ];
  const result = arrangeCanvasNodes(
    nodes,
    [edge("outside", "a"), edge("a", "b")],
    "flow",
    ["a", "b"],
  );
  expect(result[0]).toBe(nodes[0]);
  expect(result[2].position.x).toBeGreaterThan(result[1].position.x);
  expectSeparated(result);
  expect(arrangeCanvasNodes(nodes, [], "grid", ["a"])).toBe(nodes);
});

test("grid is stable, mixed sizes fit and coordinate boundaries remain valid", () => {
  const nodes = [
    node("a", "audio", 999990, 999990),
    node("b", "text", 999990, 999990),
    node("c", "video", 999990, 999990),
  ];
  const result = arrangeCanvasNodes(nodes, [], "grid");
  expectSeparated(result);
  result.forEach((n) => {
    expect(Math.abs(n.position.x)).toBeLessThanOrEqual(1_000_000);
    expect(Math.abs(n.position.y)).toBeLessThanOrEqual(1_000_000);
  });
  expect(arrangeCanvasNodes(result, [], "grid")).toBe(result);
});

test("derived results reuse free placement and retain their retry identity", () => {
  const nodes = [node("source"), node("blocker", "image", 368, 0)];
  const asset = { id: "asset", display_name: "派生图" } as ManagedFile;
  const added = derivedImageNode(nodes, "source", asset);
  expectSeparated([...nodes, added]);
  expect(derivedImageNode([...nodes, added], "source", asset)).toBe(added);
});

test("visible area excludes the actual header, drawer and controls at any zoom", () => {
  const bounds = new DOMRect(100, 50, 1000, 800);
  const area = visibleCanvasArea(bounds, [
    new DOMRect(100, 50, 1000, 76),
    new DOMRect(110, 140, 300, 690),
    new DOMRect(430, 760, 400, 58),
  ]);
  expect(area).toEqual({ x: 326, y: 92, width: 658, height: 602 });
  expect(visibleCanvasArea(bounds, [new DOMRect(124, 350, 60, 112)])).toEqual({
    x: 100,
    y: 16,
    width: 884,
    height: 768,
  });
  const viewport = { x: -100, y: 50, zoom: 0.5 };
  const world = worldVisibleArea(area, viewport);
  const card = { x: world.x + 10, y: world.y + 10, width: 320, height: 214 };
  expect(revealCanvasBounds(card, area, viewport)).toBe(viewport);
  const revealed = revealCanvasBounds(
    { ...card, x: world.x - 500 },
    area,
    viewport,
  );
  expect(revealed.zoom).toBe(0.5);
  expect(revealed.x).toBeGreaterThan(viewport.x);
});
