import { useState } from "react";
import { useMutation, useQueryClient, useQueries } from "@tanstack/react-query";
import { useWorkspacePermission } from "@platform/auth/WorkspacePermissions";
import {
  cancelGenerationTask,
  getGenerationTask,
  type GenerationTask,
  type GenerationBatch,
} from "../api";
import { visualWorkshopQueryKeys as keys } from "../queryKeys";

export function CancelQueuedTasks({ tasks }: { tasks: GenerationTask[] }) {
  const canWrite = useWorkspacePermission("content.write");
  const client = useQueryClient();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: keys.generationTasks });
    void client.invalidateQueries({ queryKey: keys.generationBatches });
    for (const task of tasks) {
      void client.invalidateQueries({ queryKey: keys.generationTask(task.id) });
    }
  };
  const cancel = useMutation({
    mutationFn: (task: GenerationTask) =>
      cancelGenerationTask(task.id, task.revision),
    onSuccess: (task) => {
      setError("");
      setNotice("已取消排队");
      client.setQueryData(keys.generationTask(task.id), task);
      invalidate();
    },
    onError: (cause) => {
      setNotice("");
      setError(
        cause instanceof Error ? cause.message : "取消未完成，请刷新后重试",
      );
      invalidate();
    },
  });
  const waiting = tasks.filter(
    (task) => task.can_cancel && task.status === "queued",
  );
  if (!canWrite || (!waiting.length && !error && !notice)) return null;
  return (
    <div className="generation-queue-actions" aria-label="等待生成的任务">
      {waiting.map((task) => (
        <button
          key={task.id}
          type="button"
          className="workshop-secondary"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate(task)}
          aria-label={`取消排队 ${task.id}`}
        >
          {cancel.isPending && cancel.variables?.id === task.id
            ? "正在取消…"
            : "取消排队"}
          {waiting.length > 1 ? ` · ${task.id.slice(0, 8)}` : ""}
        </button>
      ))}
      {notice ? <span role="status">{notice}</span> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

export function CancelQueuedBatch({
  batch,
}: {
  batch?: GenerationBatch | null;
}) {
  const active = batch?.status === "queued" || batch?.status === "processing";
  const children = useQueries({
    queries: (active ? batch.child_task_ids : []).map((id) => ({
      queryKey: keys.generationTask(id),
      queryFn: () => getGenerationTask(id),
      refetchInterval: (query: { state: { data?: GenerationTask } }) =>
        query.state.data?.status === "queued" ? 1500 : false,
    })),
  });
  return (
    <CancelQueuedTasks
      key={batch?.id}
      tasks={children.flatMap((child) => (child.data ? [child.data] : []))}
    />
  );
}
