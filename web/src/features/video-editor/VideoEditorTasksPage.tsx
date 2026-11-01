import { useState } from "react";
import { QueryFeedback } from "@shared/ui/QueryFeedback";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { WorkshopAppChrome } from "@shared/ui/WorkshopAppChrome";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  Clock3,
  Download,
  Film,
  Layers3,
  LoaderCircle,
  RefreshCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  cancelVideoEditorClipMerge,
  deleteVideoEditorRender,
  listVideoEditorProjects,
  listVideoEditorRenders,
  listVideoEditorClipMerges,
  listVideoEditorSegmentExports,
} from "./api";
import { SegmentExportDownloads } from "./SegmentExportDownloads";
import type { VideoEditorTask } from "./types";
import { videoEditorQueryKeys } from "./queryKeys";
import "./video-editor.css";
import "./video-editor-tasks.css";

const statuses = {
  queued: { label: "排队中", icon: Clock3 },
  running: { label: "处理中", icon: LoaderCircle },
  completed: { label: "已完成", icon: Check },
  failed: { label: "失败", icon: CircleAlert },
  cancelled: { label: "已取消", icon: X },
};
const filters = [
  { id: "all", label: "全部任务" },
  { id: "active", label: "进行中" },
  { id: "completed", label: "已完成" },
  { id: "other", label: "失败 / 取消" },
] as const;
const isActive = (task: VideoEditorTask) =>
  ["queued", "running"].includes(task.status);
function taskTitle(task: VideoEditorTask) {
  if (task.kind === "clip_merge")
    return `片段合并：${task.resultDetail?.name ?? "视频"}`;
  return task.kind === "segment_export"
    ? task.resultDetail?.importRequested === false
      ? "分段导出"
      : "分段导出并导入"
    : String(task.resultDetail?.outputFilename ?? "视频导出");
}
function taskDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
}

export function VideoEditorTasksPage({
  onOpenProject,
}: {
  onOpenProject: (projectId: string) => void;
}) {
  const [filter, setFilter] = useState<(typeof filters)[number]["id"]>("all");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<VideoEditorTask | null>(
    null,
  );
  const canWrite = useAccountPermission("content.write");
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: deleteVideoEditorRender,
    onSuccess: async (_result, task) => {
      setDeleteTarget(null);
      await Promise.all(
        [
          videoEditorQueryKeys.allTasks,
          videoEditorQueryKeys.renders(task.projectId),
          videoEditorQueryKeys.assets(task.projectId),
          videoEditorQueryKeys.timeline(task.projectId),
          videoEditorQueryKeys.importSources,
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
  });
  const cancelMerge = useMutation({
    mutationFn: (task: VideoEditorTask) =>
      cancelVideoEditorClipMerge(task.projectId, task.id),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: videoEditorQueryKeys.allTasks,
      }),
  });
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
          listVideoEditorClipMerges(project.id),
        ]),
      );
      return lists
        .flatMap((list) => list.items)
        .filter(
          (task) =>
            task.kind === "render" ||
            task.kind === "segment_export" ||
            task.kind === "clip_merge",
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    refetchInterval: 1500,
  });
  const all = tasks.data ?? [];
  const projectNames = new Map(
    projects.data?.items.map((project) => [project.id, project.title]),
  );
  const matchesFilter = (task: VideoEditorTask, value = filter) =>
    value === "all" ||
    (value === "active"
      ? isActive(task)
      : value === "completed"
        ? task.status === "completed"
        : ["failed", "cancelled"].includes(task.status));
  const visible = all.filter(
    (task) =>
      matchesFilter(task) &&
      `${taskTitle(task)} ${projectNames.get(task.projectId) ?? ""}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const pending = projects.isLoading || tasks.isLoading;
  const error = projects.error ?? tasks.error;
  const refresh = async () => {
    setRefreshing(true);
    try {
      await projects.refetch();
      await tasks.refetch();
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <section className="workshop-page ve-tasks-page">
      <WorkshopAppChrome
        eyebrow={
          <div className="ve-tasks-eyebrow">
            <Film aria-hidden /> 导出中心
          </div>
        }
        title="渲染任务"
        description="跟进成片与分段导出，完成后即可下载。"
        actions={
          <div className="ve-tasks-header-actions">
            {!error && !pending ? (
              <span className="ve-tasks-live">
                <i aria-hidden /> 进度自动更新
              </span>
            ) : null}
            <button
              className="ve-task-button"
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              <RefreshCcw
                className={refreshing ? "spinning" : undefined}
                aria-hidden
              />{" "}
              {refreshing ? "刷新中…" : "刷新"}
            </button>
          </div>
        }
      />
      <div className="ve-tasks-toolbar">
        <div
          className="ve-tasks-filters"
          role="group"
          aria-label="按任务状态筛选"
        >
          {filters.map((item) => (
            <button
              key={item.id}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              <span>
                {all.filter((task) => matchesFilter(task, item.id)).length}
              </span>
            </button>
          ))}
        </div>
        <label className="ve-tasks-search">
          <Search aria-hidden />
          <input
            aria-label="搜索渲染任务"
            placeholder="搜索文件或项目名称"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      <QueryFeedback
        error={error}
        pending={pending}
        onRetry={() => void refresh()}
      />
      <div className="ve-task-list">
        {visible.map((task) => {
          const StatusIcon = statuses[task.status].icon;
          const Icon = task.kind === "segment_export" ? Layers3 : Film;
          const active = isActive(task);
          const progress = Math.max(0, Math.min(100, task.progress));
          const title = taskTitle(task);
          return (
            <article
              key={task.id}
              className={`ve-task-card ${task.status}`}
              aria-label={title}
            >
              <div className="ve-task-main">
                <div className="ve-task-icon">
                  <Icon aria-hidden />
                </div>
                <div className="ve-task-info">
                  <h2 title={title}>{title}</h2>
                  <div className="ve-task-meta">
                    <span title={projectNames.get(task.projectId)}>
                      {projectNames.get(task.projectId) ?? "剪辑项目"}
                    </span>
                    <span>
                      {task.kind === "segment_export"
                        ? "分段"
                        : task.kind === "clip_merge"
                          ? "合并"
                          : "成片"}
                    </span>
                    <time dateTime={task.createdAt}>
                      {taskDate(task.createdAt)}
                    </time>
                  </div>
                </div>
                <span className={`ve-task-status ${task.status}`}>
                  <StatusIcon aria-hidden />
                  {statuses[task.status].label}
                </span>
              </div>
              {active ? (
                <div className="ve-task-progress-area">
                  <div>
                    <span>
                      {task.status === "queued"
                        ? "等待开始渲染"
                        : "正在生成视频"}
                    </span>
                    <strong>{progress}%</strong>
                  </div>
                  <div
                    className="ve-task-progress"
                    role="progressbar"
                    aria-label={`${title}进度`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                  >
                    <i style={{ width: `${progress}%` }} />
                  </div>
                </div>
              ) : null}
              {task.error ? (
                <p className="ve-task-error" role="alert">
                  <CircleAlert aria-hidden />
                  {task.error}
                </p>
              ) : null}
              {cancelMerge.error && cancelMerge.variables?.id === task.id ? (
                <p role="alert">{cancelMerge.error.message}</p>
              ) : null}
              <div className="ve-task-actions">
                {canWrite && task.kind === "clip_merge" && active ? (
                  <button
                    className="ve-task-button"
                    disabled={cancelMerge.isPending}
                    onClick={() => cancelMerge.mutate(task)}
                  >
                    取消合并
                  </button>
                ) : null}
                <button
                  className="ve-task-button secondary"
                  onClick={() => onOpenProject(task.projectId)}
                >
                  查看项目
                  <ArrowUpRight aria-hidden />
                </button>
                {task.kind === "segment_export" &&
                task.status === "completed" ? (
                  <SegmentExportDownloads task={task} />
                ) : task.outputAssetId && task.status === "completed" ? (
                  <a
                    className="ve-task-button primary"
                    href={`/v1/files/${task.outputAssetId}/download`}
                  >
                    <Download aria-hidden />
                    下载视频
                  </a>
                ) : null}
                {canWrite && task.kind === "render" && !active ? (
                  <button
                    className="ve-task-button danger"
                    aria-label={`删除“${title}”`}
                    disabled={remove.isPending}
                    onClick={() => {
                      remove.reset();
                      setDeleteTarget(task);
                    }}
                  >
                    <Trash2 aria-hidden />
                    删除
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
        {!pending && !error && !visible.length ? (
          <div className="ve-tasks-empty">
            <Film aria-hidden />
            <h2>{all.length ? "没有匹配的任务" : "还没有渲染任务"}</h2>
            <p>
              {all.length
                ? "试试其他状态，或更换文件与项目关键词。"
                : "在剪辑工程中导出视频后，可在这里查看进度和下载成片。"}
            </p>
            {all.length ? (
              <button
                className="ve-task-button"
                onClick={() => {
                  setFilter("all");
                  setSearch("");
                }}
              >
                查看全部任务
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除导出视频？"
        description={
          <>
            将删除“{deleteTarget ? taskTitle(deleteTarget) : ""}
            ”的任务记录和导出文件，此操作不可恢复。剪辑工程和源素材会保留。
            {remove.error ? (
              <span role="alert">{remove.error.message}</span>
            ) : null}
          </>
        }
        confirmLabel="确认删除"
        pending={remove.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget && canWrite) remove.mutate(deleteTarget);
        }}
      />
    </section>
  );
}
