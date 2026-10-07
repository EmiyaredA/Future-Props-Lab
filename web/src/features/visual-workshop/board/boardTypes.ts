import type { useVisualCanvasController } from "../canvas/useVisualCanvasController";
import type { GenerationTask, GenerationBatch, VisualCanvasNode } from "../api";

export type BoardController = ReturnType<typeof useVisualCanvasController>;
export const nodeTypeNames = {
  text: "文本",
  image: "图像",
  audio: "音频",
  video: "视频",
};
export const boardStatuses = ["待准备", "可生成", "生成中", "已完成"] as const;
export type BoardStatus = (typeof boardStatuses)[number];

export function nodeStatus(
  node: VisualCanvasNode,
  tasks: GenerationTask[],
  upstreamReady: boolean,
  batches: GenerationBatch[] = [],
): BoardStatus {
  const batch =
    node.kind === "image"
      ? (batches.find(
          (batch) =>
            batch.generation_node_id === node.id &&
            ["queued", "processing"].includes(batch.status),
        ) ?? batches.find((batch) => batch.id === node.generation_batch_id))
      : undefined;
  if (batch && ["queued", "processing"].includes(batch.status)) return "生成中";
  if (batch?.status === "failed") return upstreamReady ? "可生成" : "待准备";
  if (
    tasks.some(
      (task) =>
        task.canvas_node_id === node.id &&
        ["queued", "submitting", "pending", "processing"].includes(task.status),
    )
  )
    return "生成中";
  const task =
    node.kind === "text"
      ? undefined
      : tasks.find((task) => task.id === node.generation_task_id);
  if (
    task &&
    ["queued", "submitting", "pending", "processing"].includes(task.status)
  )
    return "生成中";
  if (task?.status === "failed") return upstreamReady ? "可生成" : "待准备";
  if (node.final_output_id || (node.kind !== "text" && node.asset_id))
    return "已完成";
  if (node.kind === "text") return node.text?.trim() ? "可生成" : "待准备";
  return node.generation_draft?.model_id &&
    node.generation_draft.prompt?.trim() &&
    upstreamReady
    ? "可生成"
    : "待准备";
}
