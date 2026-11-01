import { useAccountPermission } from "@platform/auth/AccountAccess";
import { useState } from "react";
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
  getGenerationBatches,
  getVisualWorkshopProjects,
  retryGenerationMaterialization,
  type GenerationTask,
  type GenerationTaskStatus,
} from "@features/visual-workshop/api";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { visualWorkshopQueryKeys } from "@features/visual-workshop/queryKeys";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { WorkshopAppChrome } from "@shared/ui/WorkshopAppChrome";
import "@features/visual-workshop/visual-workshop.css";
import { CancelQueuedTasks } from "./CancelQueuedTasks";
import { taskActivity } from "./generationActivityModel";
import { GenerationActivity, GenerationSpinner } from "./GenerationActivity";

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
  cancelled: "已取消",
};

function TaskPreview({ task }: { task: GenerationTask }) {
  const { url: source } = useApiBlobUrl(
    task.result_asset_id ? `/v1/files/${task.result_asset_id}/content` : null,
  );
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
  const canWrite = useAccountPermission("content.write");
  const client = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [kind, setKind] = useState<"" | "image" | "video">("");
  const [status, setStatus] = useState<"" | GenerationTaskStatus>("");
  const projects = useQuery({
    queryKey: visualWorkshopQueryKeys.projects,
    queryFn: getVisualWorkshopProjects,
  });
  const tasks = useQuery({
    queryKey: visualWorkshopQueryKeys.generationTaskList(
      projectId,
      kind,
      status,
    ),
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
  const batches = useQuery({
    queryKey: [
      ...visualWorkshopQueryKeys.generationBatches,
      projectId || "all",
    ],
    queryFn: () => getGenerationBatches(projectId || undefined),
    refetchInterval: (query) =>
      query.state.data?.items.some((batch) =>
        ["queued", "processing"].includes(batch.status),
      )
        ? 5_000
        : false,
  });
  const retry = useMutation({
    mutationFn: retryGenerationMaterialization,
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: visualWorkshopQueryKeys.generationTasks,
      }),
  });
  const projectNames = new Map(
    (projects.data?.items ?? []).map((project) => [project.id, project.title]),
  );

  return (
    <section className="workshop-page generation-tasks-page">
      <WorkshopAppChrome
        eyebrow="GENERATION QUEUE"
        title="生成任务"
        description="跟踪图片和视频生成进度，完成的结果会自动保存到对应项目素材库。"
        actions={
          <button
            className="workshop-secondary"
            onClick={() => void tasks.refetch()}
          >
            <RefreshCcw aria-hidden /> 刷新
          </button>
        }
      />
      <div className="generation-task-filters">
        <CustomSelect
          ariaLabel="按项目筛选"
          value={projectId}
          onChange={setProjectId}
          options={[
            { value: "", label: "全部项目" },
            ...(projects.data?.items ?? []).map((project) => ({
              value: project.id,
              label: project.title,
            })),
          ]}
        />
        <CustomSelect
          ariaLabel="按类型筛选"
          value={kind}
          onChange={(value) => setKind(value as typeof kind)}
          options={[
            { value: "", label: "全部类型" },
            { value: "image", label: "图片" },
            { value: "video", label: "视频" },
          ]}
        />
        <CustomSelect
          ariaLabel="按状态筛选"
          value={status}
          onChange={(value) => setStatus(value as typeof status)}
          options={[
            { value: "", label: "全部状态" },
            ...(
              Object.entries(STATUS_LABELS) as [GenerationTaskStatus, string][]
            ).map(([value, label]) => ({ value, label })),
          ]}
        />
        <span>共 {tasks.data?.total ?? 0} 个任务</span>
      </div>
      {batches.data?.items.length ? (
        <div className="generation-batch-summary" aria-label="宫格生成批次">
          {batches.data.items.slice(0, 3).map((batch) => (
            <div className="generation-batch-chip" key={batch.id}>
              <strong>
                {batch.grid_size === 4 ? "4 宫格" : "9 宫格"}
                {batch.batch_kind === "composition"
                  ? " · 节点合成"
                  : " · 新图生成"}
              </strong>
              <span>
                {batch.completed_count}/{batch.grid_size}
                {batch.cancelled_count
                  ? ` · ${batch.cancelled_count} 个取消`
                  : ""}
                {batch.failed_count ? ` · ${batch.failed_count} 个失败` : ""}
                {batch.grid_output === "composite"
                  ? " · 合成大图"
                  : " · 独立节点"}
              </span>
              <em className={batch.status}>
                {batch.status === "completed"
                  ? "已完成"
                  : batch.status === "failed"
                    ? "有失败"
                    : batch.status === "cancelled"
                      ? "已取消"
                      : batch.status === "queued"
                        ? "排队中"
                        : "处理中"}
              </em>
            </div>
          ))}
        </div>
      ) : null}
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
                      {ACTIVE_STATUSES.has(task.status) && (
                        <GenerationSpinner size={12} />
                      )}
                      {taskActivity(task)?.label ?? STATUS_LABELS[task.status]}
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
                {taskActivity(task) && (
                  <GenerationActivity
                    activity={taskActivity(task)!}
                    showTaskLink={false}
                  />
                )}
                {task.error_message ? (
                  <div className="generation-task-error">
                    {task.error_message}
                  </div>
                ) : null}
                <CancelQueuedTasks tasks={[task]} />
                <footer>
                  <button onClick={() => onOpenProject(task.project_id)}>
                    打开画布
                  </button>
                  {task.result_asset_id ? (
                    <button onClick={() => onOpenAssets(task.project_id)}>
                      <ExternalLink aria-hidden /> 打开素材
                    </button>
                  ) : null}
                  {canWrite && task.can_retry_materialization ? (
                    <button
                      disabled={retry.isPending}
                      onClick={() => retry.mutate(task.id)}
                    >
                      <RotateCcw aria-hidden /> 恢复结果
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
