import { QueryFeedback } from "@shared/ui/QueryFeedback";
import { useQuery } from "@tanstack/react-query";
import { Film, RefreshCcw } from "lucide-react";
import {
  listVideoEditorProjects,
  listVideoEditorRenders,
  listVideoEditorSegmentExports,
} from "./api";
import { SegmentExportDownloads } from "./SegmentExportDownloads";
import type { VideoEditorTask } from "./types";
import { videoEditorQueryKeys } from "./queryKeys";
import "./video-editor.css";

export function VideoEditorTasksPage({
  onOpenProject,
}: {
  onOpenProject: (projectId: string) => void;
}) {
  const projects = useQuery({
    queryKey: videoEditorQueryKeys.projects,
    queryFn: listVideoEditorProjects,
  });
  const tasks = useQuery({
    queryKey: [
      ...videoEditorQueryKeys.allTasks,
      projects.data?.items.map((project) => project.id),
    ],
    enabled: Boolean(projects.data),
    queryFn: async () => {
      const lists = await Promise.all(
        (projects.data?.items ?? []).flatMap((project) => [
          listVideoEditorRenders(project.id),
          listVideoEditorSegmentExports(project.id),
        ]),
      );
      return lists
        .flatMap((list) => list.items)
        .filter(
          (task) => task.kind === "render" || task.kind === "segment_export",
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    refetchInterval: 1500,
  });
  return (
    <section className="workshop-page ve-tasks-page">
      <header className="workshop-page-header">
        <div>
          <h1>渲染任务</h1>
          <p>查看完整渲染和分段导出的进度，完成后可下载文件。</p>
        </div>
        <button onClick={() => void tasks.refetch()}>
          <RefreshCcw aria-hidden /> 刷新
        </button>
      </header>
      <QueryFeedback
        error={projects.error ?? tasks.error}
        pending={projects.isLoading || tasks.isLoading}
        onRetry={() => {
          void projects.refetch();
          void tasks.refetch();
        }}
      />
      <div className="ve-task-list">
        {(tasks.data ?? []).map((task: VideoEditorTask) => (
          <article key={task.id}>
            <Film aria-hidden />
            <div>
              <strong>
                {task.kind === "segment_export"
                  ? task.resultDetail?.importRequested === false
                    ? "分段导出"
                    : "分段导出并导入"
                  : String(task.resultDetail?.outputFilename ?? "视频导出")}
              </strong>
              <small>
                {
                  {
                    queued: "排队中",
                    running: "处理中",
                    completed: "已完成",
                    failed: "失败",
                    cancelled: "已取消",
                  }[task.status]
                }{" "}
                · {task.progress}%
              </small>
              {task.error ? <p role="alert">{task.error}</p> : null}
              <span className="ve-task-progress">
                <i style={{ width: `${task.progress}%` }} />
              </span>
            </div>
            {task.kind === "segment_export" && task.status === "completed" ? (
              <SegmentExportDownloads task={task} />
            ) : task.outputAssetId ? (
              <a href={`/v1/files/${task.outputAssetId}/download`}>下载</a>
            ) : (
              <button onClick={() => onOpenProject(task.projectId)}>
                查看项目
              </button>
            )}
          </article>
        ))}
        {!projects.isLoading &&
        !projects.isError &&
        !tasks.isLoading &&
        !tasks.isError &&
        !tasks.data?.length ? (
          <div className="ve-state">还没有正式渲染任务。</div>
        ) : null}
      </div>
    </section>
  );
}
