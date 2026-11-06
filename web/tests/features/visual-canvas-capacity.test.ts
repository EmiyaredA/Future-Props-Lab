import { expect, test } from "vitest";
import type {
  VisualCanvasEdge,
  VisualCanvasNode,
} from "@features/visual-workshop/api";
import { canvasPasteError } from "@features/visual-workshop/canvas/canvasClipboard";
import schema from "../../src/generated/openapi.json";

const node: VisualCanvasNode = {
  id: "text",
  kind: "text",
  title: "参考",
  text: "",
  position: { x: 0, y: 0 },
};
const edge: VisualCanvasEdge = {
  id: "edge",
  source_node_id: "a",
  target_node_id: "b",
  binding: "final",
  purpose: "context",
};

test("paste uses the public canvas capacity and accepts the new bounded range", () => {
  const fields = schema.components.schemas.VisualCanvasDocumentPutIn.properties;
  const nodeLimit = fields.nodes.maxItems;
  const edgeLimit = fields.edges.maxItems;
  expect(nodeLimit).toBe(1000);
  expect(edgeLimit).toBe(2000);
  for (const size of [500, nodeLimit - 1]) {
    expect(
      canvasPasteError(
        { nodes: Array(size).fill(node), edges: [] },
        { nodes: [node], edges: [] },
      ),
    ).toBeUndefined();
  }
  expect(
    canvasPasteError(
      { nodes: Array(nodeLimit).fill(node), edges: [] },
      { nodes: [node], edges: [] },
    ),
  ).toContain(`${nodeLimit} 个节点上限`);
  expect(
    canvasPasteError(
      { nodes: [], edges: Array(edgeLimit - 1).fill(edge) },
      { nodes: [], edges: [edge] },
    ),
  ).toBeUndefined();
  expect(
    canvasPasteError(
      { nodes: [], edges: Array(edgeLimit).fill(edge) },
      { nodes: [], edges: [edge] },
    ),
  ).toContain(`${edgeLimit} 条连线上限`);
});
