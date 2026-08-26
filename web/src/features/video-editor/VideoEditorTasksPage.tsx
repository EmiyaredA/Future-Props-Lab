import { useQuery } from "@tanstack/react-query";
import { Film, RefreshCcw } from "lucide-react";
import { listVideoEditorProjects, listVideoEditorRenders } from "./api";
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
    queryKey: videoEditorQueryKeys.allRenders(projects.data?.items),
    enabled: Boolean(projects.data),
    queryFn: async () => {
      const lists = await Promise.all(
        (projects.data?.items ?? []).map((project) =>
          listVideoEditorRenders(project.id),
        ),
      );
      return lists
        .flatMap((list) => list.items)
        .filter((task) => task.kind === "render");
    },
    refetchInterval: 1500,
  });
  return (
    <section className="workshop-page ve-tasks-page">
      <header className="workshop-page-header">
        <div>
          <h1>渲染任务</h1>
          <p>每个任务都保存不可变时间轴快照，后续编辑不会改变历史成片。</p>
        </div>
        <button onClick={() => void tasks.refetch()}>
          <RefreshCcw aria-hidden /> 刷新
        </button>
      </header>
      <div className="ve-task-list">
        {(tasks.data ?? []).map((task: VideoEditorTask) => (
          <article key={task.id}>
            <Film aria-hidden />
            <div>
              <strong>
                {String(task.resultDetail?.outputFilename ?? "视频导出")}
              </strong>
              <small>
                {task.status} · {task.progress}%
              </small>
              <span>
                <i style={{ width: `${task.progress}%` }} />
              </span>
            </div>
            {task.outputAssetId ? (
              <a href={`/v1/files/${task.outputAssetId}/download`}>下载</a>
            ) : (
              <button onClick={() => onOpenProject(task.projectId)}>
                查看项目
              </button>
            )}
          </article>
        ))}
        {!tasks.isLoading && !tasks.data?.length ? (
          <div className="ve-state">还没有正式渲染任务。</div>
        ) : null}
      </div>
    </section>
  );
}
