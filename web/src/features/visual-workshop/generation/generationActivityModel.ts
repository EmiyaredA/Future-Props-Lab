import type { GenerationBatch, GenerationTask, VisualCanvasNode } from "../api";
import type { TaskExecutionInfo } from "@shared/ui/taskExecutionPresentation";

const activeTaskStatuses = new Set<GenerationTask["status"]>([
  "queued",
  "submitting",
  "pending",
  "processing",
]);

export type GenerationActivity = {
  id: string;
  label: string;
  createdAt: string;
  progress?: number;
  executionInfo?: TaskExecutionInfo | null;
};

export function taskActivity(
  task?: GenerationTask | null,
): GenerationActivity | undefined {
  if (!task || !activeTaskStatuses.has(task.status)) return;
  const progress = Number.isFinite(task.progress)
    ? Math.max(0, Math.min(100, task.progress))
    : 0;
  const kind = { image: "图片", video: "视频", audio: "音频" }[task.kind];
  return {
    id: task.id,
    createdAt: task.created_at,
    executionInfo: task.execution_info,
    label:
      task.status === "queued"
        ? "排队中"
        : task.status === "submitting"
          ? "正在提交"
          : task.status === "processing" && progress === 100
            ? "正在保存输出"
            : task.execution_info?.phase === "queued"
              ? "上游排队中"
              : task.execution_info?.phase === "finalizing"
                ? "正在整理视频"
                : task.execution_info?.phase === "unknown"
                  ? "等待上游状态"
                  : `正在生成${kind}`,
    progress:
      !task.execution_info && progress > 0 && progress < 100
        ? progress
        : undefined,
  };
}

export function batchActivity(
  batch?: GenerationBatch | null,
): GenerationActivity | undefined {
  if (!batch || !["queued", "processing"].includes(batch.status)) return;
  return {
    id: batch.id,
    createdAt: batch.created_at,
    label:
      batch.status === "queued"
        ? "排队中"
        : batch.completed_count >= batch.grid_size
          ? "正在整理输出"
          : "正在生成图片",
    progress:
      batch.completed_count > 0 && batch.completed_count < batch.grid_size
        ? Math.round((100 * batch.completed_count) / batch.grid_size)
        : undefined,
  };
}

export function nodeGenerationActivity(
  node: VisualCanvasNode,
  tasks: GenerationTask[],
  batches: GenerationBatch[] = [],
): GenerationActivity | undefined {
  if (node.kind === "text") return;
  const latest = <T extends { created_at: string }>(items: T[]) =>
    items.reduce<T | undefined>(
      (current, item) =>
        !current || item.created_at > current.created_at ? item : current,
      undefined,
    );
  const batch =
    node.kind === "image"
      ? latest(
          batches.filter(
            (batch) =>
              (batch.generation_node_id === node.id ||
                batch.id === node.generation_batch_id) &&
              batchActivity(batch),
          ),
        )
      : undefined;
  return (
    batchActivity(batch) ??
    taskActivity(
      latest(
        tasks.filter(
          (task) =>
            (task.canvas_node_id === node.id ||
              task.id === node.generation_task_id) &&
            taskActivity(task),
        ),
      ),
    )
  );
}
