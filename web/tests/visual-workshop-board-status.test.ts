import { expect, test } from "vitest";
import { nodeStatus } from "@features/visual-workshop/board/boardTypes";
import type {
  GenerationBatch,
  VisualCanvasNode,
} from "@features/visual-workshop/api";

test("an older composition still running keeps its node in generating despite a newer finished run", () => {
  const node: VisualCanvasNode = {
    id: "root",
    kind: "image",
    title: "人设",
    position: { x: 0, y: 0 },
    asset_id: "latest-asset",
    final_output_id: "v3",
    final_version: 3,
    generation_batch_id: "latest",
  };
  const batch = (
    id: string,
    status: GenerationBatch["status"],
  ): GenerationBatch => ({
    id,
    project_id: "project",
    batch_kind: "generation",
    grid_size: 4,
    grid_output: "composite",
    child_task_ids: [],
    completed_at: null,
    error_message: null,
    generation_node_id: "root",
    status,
    completed_count: status === "completed" ? 4 : 1,
    cancelled_count: 0,
    failed_count: 0,
    revision: 1,
    created_at: "2026-10-07T00:00:00Z",
    updated_at: "2026-10-07T00:00:00Z",
    result_asset_id: null,
  });
  expect(
    nodeStatus(node, [], true, [
      batch("latest", "completed"),
      batch("older", "processing"),
    ]),
  ).toBe("生成中");
  expect(
    nodeStatus(node, [], true, [
      batch("latest", "completed"),
      batch("older", "completed"),
    ]),
  ).toBe("已完成");
  expect(node.asset_id).toBe("latest-asset");
});
