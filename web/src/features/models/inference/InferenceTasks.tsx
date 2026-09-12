import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";
import { useWorkspacePermission } from "@platform/auth/WorkspacePermissions";
import { modelQueryKeys } from "@features/models/queryKeys";
import "./inference-tasks.css";

type Task = components["schemas"]["InferenceTaskOut"];
const states: Record<Task["status"], string> = {
  queued: "等待执行",
  submitting: "正在提交",
  pending: "生成中",
  processing: "保存结果",
  running: "识别中",
  completed: "已完成",
  failed: "失败",
};

export function InferenceTasks({ workspaceId }: { workspaceId: string }) {
  const [offset, setOffset] = useState(0);
  const [notice, setNotice] = useState("");
  const queryClient = useQueryClient();
  const canWrite = useWorkspacePermission("content.write");
  const canCall = useWorkspacePermission("models.use");
  const query = useQuery({
    queryKey: modelQueryKeys.inferenceTasks(workspaceId, offset),
    queryFn: async () =>
      unwrap(
        await api.GET("/v1/model-inference/tasks", {
          params: { query: { offset, limit: 10 } },
        }),
      ),
    refetchInterval: 5000,
  });
  const action = useMutation({
    mutationFn: async ({
      task,
      kind,
    }: {
      task: Task;
      kind: "save" | "retry" | "download";
    }) => {
      if (kind === "save") {
        await unwrap(
          await api.POST(
            "/v1/model-inference/tasks/{task_id}/save-to-library",
            {
              params: { path: { task_id: task.id } },
            },
          ),
        );
        setNotice("结果已保存到公共文件库。");
      } else if (kind === "retry") {
        await unwrap(
          await api.POST(
            "/v1/model-inference/tasks/{task_id}/retry-materialization",
            {
              params: { path: { task_id: task.id } },
              body: { expected_revision: task.revision },
            },
          ),
        );
        setNotice("正在重新保存已有结果。");
      } else {
        const blob = await unwrap(
          await api.GET("/v1/model-inference/tasks/{task_id}/content", {
            params: { path: { task_id: task.id } },
            parseAs: "blob",
          }),
        );
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = task.result_filename;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: modelQueryKeys.inference }),
  });
  return (
    <section className="inference-tasks card" aria-label="独立模型任务">
      <header>
        <div>
          <h2>独立模型任务</h2>
          <p>查看自动化创建的任务，下载结果或转存到公共文件库。</p>
        </div>
        <button className="btn" onClick={() => void query.refetch()}>
          刷新
        </button>
      </header>
      {(query.error || action.error) && (
        <p role="alert">{(query.error || action.error)?.message}</p>
      )}
      {notice && <p role="status">{notice}</p>}
      {query.isPending && <p role="status">正在读取任务…</p>}
      {query.data?.total === 0 && (
        <p>还没有独立调用任务。可从文档中心的 Python SDK 教程开始。</p>
      )}
      <ul>
        {query.data?.items.map((task) => (
          <li key={task.id}>
            <div className="inference-task-summary">
              <strong>{task.model_slug}</strong>
              <span>
                {states[task.status]} · {task.progress}%
              </span>
              <code>{task.id}</code>
            </div>
            {task.error_message && <p>{task.error_message}</p>}
            <details>
              <summary>输入与结果</summary>
              <pre>
                {JSON.stringify(
                  { input: task.request_payload, result: task.result },
                  null,
                  2,
                )}
              </pre>
            </details>
            <div className="inference-task-actions">
              {task.result_available && (
                <button
                  className="btn"
                  disabled={action.isPending}
                  onClick={() => action.mutate({ task, kind: "download" })}
                >
                  下载结果
                </button>
              )}
              {task.result_available && canWrite && (
                <button
                  className="btn"
                  disabled={action.isPending}
                  onClick={() => action.mutate({ task, kind: "save" })}
                >
                  存入文件库
                </button>
              )}
              {task.can_retry_materialization && canCall && (
                <button
                  className="btn"
                  disabled={action.isPending}
                  onClick={() => action.mutate({ task, kind: "retry" })}
                >
                  重试保存结果
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <footer>
        <button
          className="btn"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 10))}
        >
          上一页
        </button>
        <span>共 {query.data?.total ?? 0} 项</span>
        <button
          className="btn"
          disabled={offset + 10 >= (query.data?.total ?? 0)}
          onClick={() => setOffset(offset + 10)}
        >
          下一页
        </button>
      </footer>
    </section>
  );
}
