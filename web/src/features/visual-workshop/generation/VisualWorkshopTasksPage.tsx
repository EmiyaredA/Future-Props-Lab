import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  FileImage,
  LoaderCircle,
  RefreshCcw,
  RotateCcw,
  TriangleAlert,
  Video,
} from "lucide-react";
import {
  getGenerationTasks,
  getVisualWorkshopProjects,
  retryGenerationMaterialization,
  type GenerationTask,
  type GenerationTaskStatus,
} from "@features/visual-workshop/api";
import { fetchApiBlob } from "@platform/api/client";
import "@features/visual-workshop/visual-workshop.css";

const ACTIVE_STATUSES = new Set<GenerationTaskStatus>([
  "queued",
  "submitting",
  "pending",
  "processing",
]);
const STATUS_LABELS: Record<GenerationTaskStatus, string> = {
  queued: "排队中",
  submitting: "提交中",
  pending: "等待生成",
  processing: "生成中",
  completed: "已完成",
  failed: "失败",
};

function TaskPreview({ task }: { task: GenerationTask }) {
  const [source, setSource] = useState("");
  useEffect(() => {
    if (!task.result_asset_id) {
      setSource("");
      return;
    }
    let objectUrl = "";
    let active = true;
    void fetchApiBlob(`/v1/files/${task.result_asset_id}/content`)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setSource(objectUrl);
      })
      .catch(() => setSource(""));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [task.result_asset_id]);
  if (!source)
    return (
      <div className={`generation-task-placeholder ${task.kind}`}>
        {task.kind === "image" ? (
          <FileImage aria-hidden />
        ) : (
          <Video aria-hidden />
        )}
      </div>
    );
  return task.kind === "image" ? (
    <img className="generation-task-preview" src={source} alt="生成结果预览" />
  ) : (
    <video
      className="generation-task-preview"
      src={source}
      controls
      preload="metadata"
    />
  );
}

export function VisualWorkshopTasksPage({
  onOpenProject,
  onOpenAssets,
}: {
  onOpenProject: (projectId: string) => void;
  onOpenAssets: (projectId: string) => void;
}) {
  const client = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [kind, setKind] = useState<"" | "image" | "video">("");
  const [status, setStatus] = useState<"" | GenerationTaskStatus>("");
  const projects = useQuery({
    queryKey: ["visual-workshop-projects"],
    queryFn: getVisualWorkshopProjects,
  });
  const tasks = useQuery({
    queryKey: ["visual-generation-tasks", projectId, kind, status],
    queryFn: () =>
      getGenerationTasks({
        projectId: projectId || undefined,
        kind: kind || undefined,
        status: status || undefined,
      }),
    refetchInterval: (query) =>
      query.state.data?.items.some((task) => ACTIVE_STATUSES.has(task.status))
        ? 5_000
        : false,
  });
  const retry = useMutation({
    mutationFn: retryGenerationMaterialization,
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["visual-generation-tasks"] }),
  });
  const projectNames = new Map(
    (projects.data?.items ?? []).map((project) => [project.id, project.title]),
  );

  return (
    <section className="workshop-page generation-tasks-page">
      <header className="workshop-page-header">
        <div>
          <span>GENERATION QUEUE</span>
          <h1>生成任务</h1>
          <p>跟踪图片和视频生成进度，完成的结果会自动保存到对应项目素材库。</p>
        </div>
        <button
          className="workshop-secondary"
          onClick={() => void tasks.refetch()}
        >
          <RefreshCcw aria-hidden /> 刷新
        </button>
      </header>
      <div className="generation-task-filters">
        <select
          aria-label="按项目筛选"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">全部项目</option>
          {(projects.data?.items ?? []).map((project) => (
            <option value={project.id} key={project.id}>
              {project.title}
            </option>
          ))}
        </select>
        <select
          aria-label="按类型筛选"
          value={kind}
          onChange={(event) => setKind(event.target.value as typeof kind)}
        >
          <option value="">全部类型</option>
          <option value="image">图片</option>
          <option value="video">视频</option>
        </select>
        <select
          aria-label="按状态筛选"
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
        >
          <option value="">全部状态</option>
          {(
            Object.entries(STATUS_LABELS) as [GenerationTaskStatus, string][]
          ).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
        <span>共 {tasks.data?.total ?? 0} 个任务</span>
      </div>
      {tasks.isLoading ? (
        <div className="workshop-state">
          <LoaderCircle className="spinning" aria-hidden />
          <strong>正在读取生成任务</strong>
        </div>
      ) : tasks.isError ? (
        <div className="workshop-state">
          <TriangleAlert aria-hidden />
          <strong>生成任务暂时无法读取</strong>
          <button onClick={() => void tasks.refetch()}>重新加载</button>
        </div>
      ) : tasks.data?.items.length ? (
        <div className="generation-task-list">
          {tasks.data.items.map((task) => (
            <article className="generation-task-card" key={task.id}>
              <TaskPreview task={task} />
              <div className="generation-task-copy">
                <header>
                  <div>
                    <span className={`generation-task-status ${task.status}`}>
                      {STATUS_LABELS[task.status]}
                    </span>
                    <strong>{task.model_slug}</strong>
                  </div>
                  <small>
                    {new Date(task.created_at).toLocaleString("zh-CN")}
                  </small>
                </header>
                <p>{String(task.request_payload.prompt || "未填写提示词")}</p>
                <div className="generation-task-meta">
                  <span>
                    {projectNames.get(task.project_id) ?? task.project_id}
                  </span>
                  <span>{task.kind === "image" ? "图片生成" : "视频生成"}</span>
                  <span>{task.provider_name}</span>
                </div>
                {ACTIVE_STATUSES.has(task.status) ? (
                  <div
                    className="generation-progress"
                    aria-label={`进度 ${task.progress}%`}
                  >
                    <i style={{ width: `${task.progress}%` }} />
                    <span>{task.progress}%</span>
                  </div>
                ) : null}
                {task.error_message ? (
                  <div className="generation-task-error">
                    {task.error_message}
                  </div>
                ) : null}
                <footer>
                  <button onClick={() => onOpenProject(task.project_id)}>
                    打开画布
                  </button>
                  {task.result_asset_id ? (
                    <button onClick={() => onOpenAssets(task.project_id)}>
                      <ExternalLink aria-hidden /> 打开素材
                    </button>
                  ) : null}
                  {task.can_retry_materialization ? (
                    <button
                      disabled={retry.isPending}
                      onClick={() => retry.mutate(task.id)}
                    >
                      <RotateCcw aria-hidden /> 重试保存
                    </button>
                  ) : null}
                </footer>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="workshop-state">
          <FileImage aria-hidden />
          <strong>暂无符合条件的生成任务</strong>
          <p>进入项目画布，点击左侧“AI 生成”即可创建。</p>
        </div>
      )}
    </section>
  );
}
