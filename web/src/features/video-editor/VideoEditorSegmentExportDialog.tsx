import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  CircleCheck,
  CircleX,
  Film,
  Layers3,
  LoaderCircle,
  Volume2,
  X,
} from "lucide-react";
import {
  getVisualWorkshopProjects,
  visualWorkshopQueryKeys,
} from "@features/visual-workshop";
import {
  createVideoEditorSegmentExport,
  getVideoEditorSegmentExport,
} from "./api";
import { formatTime } from "./editorModel";
import { videoEditorQueryKeys } from "./queryKeys";
import type {
  VideoEditorAsset,
  VideoEditorClip,
  VideoEditorSegmentExportItem,
  VideoEditorTask,
  VideoEditorTimeline,
} from "./types";

type SegmentConfig = VideoEditorSegmentExportItem;
type ConfigKey = "resolution" | "fps" | "quality" | "audioMode";

const taskStatusLabels: Record<VideoEditorTask["status"], string> = {
  queued: "排队中",
  running: "正在导出并导入",
  completed: "导入完成",
  failed: "导入失败",
  cancelled: "已取消",
};

const segmentStatusLabels: Record<string, string> = {
  queued: "排队中",
  encoded: "已编码，正在导入",
  completed: "已完成",
};

const choices = {
  resolution: [
    ["source", "源尺寸"],
    ["720p", "720p"],
    ["1080p", "1080p"],
  ],
  fps: [
    ["source", "源帧率"],
    [30, "30 FPS"],
    [60, "60 FPS"],
  ],
  quality: [
    ["high", "高质量"],
    ["balanced", "均衡"],
    ["small", "小文件"],
  ],
  audioMode: [
    ["keep", "保留音频"],
    ["mute", "静音"],
  ],
} satisfies Record<ConfigKey, readonly (readonly [string | number, string])[]>;

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | number;
  options: readonly (readonly [string | number, string])[];
  onChange: (value: string | number) => void;
}) {
  const current =
    options.find(([item]) => item === value)?.[1] ?? String(value);
  return (
    <details className="ve-segment-choice">
      <summary aria-label={label}>
        {current} <ChevronDown aria-hidden />
      </summary>
      <div>
        {options.map(([option, text]) => (
          <button
            type="button"
            key={String(option)}
            onClick={(event) => {
              onChange(option);
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            {value === option ? <Check aria-hidden /> : <span />}
            {text}
          </button>
        ))}
      </div>
    </details>
  );
}

export function VideoEditorSegmentExportDialog({
  projectId,
  timeline,
  assets,
  selectedClipIds,
  onClose,
}: {
  projectId: string;
  timeline: VideoEditorTimeline;
  assets: VideoEditorAsset[];
  selectedClipIds: string[];
  onClose: () => void;
}) {
  const client = useQueryClient();
  const clips = useMemo(
    () =>
      (timeline.document.tracks ?? [])
        .flatMap((track) => track.clips ?? [])
        .filter((clip): clip is VideoEditorClip => clip.kind === "video")
        .sort((a, b) => a.timelineStartUs - b.timelineStartUs),
    [timeline],
  );
  const selectedVideoIds = selectedClipIds.filter((id) =>
    clips.some((clip) => clip.id === id),
  );
  const [scope, setScope] = useState<"selected" | "all">(
    selectedVideoIds.length ? "selected" : "all",
  );
  const activeClips =
    scope === "selected"
      ? clips.filter((clip) => selectedVideoIds.includes(clip.id))
      : clips;
  const [batch, setBatch] = useState<Omit<SegmentConfig, "clipId" | "name">>({
    resolution: "source",
    fps: "source",
    quality: "balanced",
    audioMode: "keep",
  });
  const [configs, setConfigs] = useState<Record<string, SegmentConfig>>(() =>
    Object.fromEntries(
      clips.map((clip, index) => [
        clip.id,
        {
          clipId: clip.id,
          name: clip.name || `视频片段 ${index + 1}`,
          resolution: "source",
          fps: "source",
          quality: "balanced",
          audioMode: "keep",
        },
      ]),
    ),
  );
  const projects = useQuery({
    queryKey: visualWorkshopQueryKeys.projectsForSegmentTarget,
    queryFn: getVisualWorkshopProjects,
  });
  const availableProjects = (projects.data?.items ?? []).filter(
    (project) => project.kind === "canvas",
  );
  const [targetMode, setTargetMode] = useState<"existing" | "new">("existing");
  const [targetProjectId, setTargetProjectId] = useState<string>();
  const [newProjectTitle, setNewProjectTitle] = useState("分段视频工坊");
  const [requestId] = useState(() => crypto.randomUUID());
  const [createdTask, setCreatedTask] = useState<VideoEditorTask>();
  const targetId = targetProjectId ?? availableProjects[0]?.id;
  const task = useQuery({
    queryKey: videoEditorQueryKeys.segmentExport(
      projectId,
      createdTask?.id ?? "pending",
    ),
    enabled: Boolean(createdTask),
    queryFn: () =>
      getVideoEditorSegmentExport(projectId, createdTask?.id ?? ""),
    refetchInterval: (query) => {
      const status = query.state.data?.status ?? createdTask?.status;
      return status === "queued" || status === "running" ? 1000 : false;
    },
  });
  const trackedTask = task.data ?? createdTask;
  const taskActive =
    trackedTask?.status === "queued" || trackedTask?.status === "running";
  const mutation = useMutation({
    mutationFn: () =>
      createVideoEditorSegmentExport(
        projectId,
        {
          expectedRevision: timeline.revision,
          target:
            targetMode === "existing"
              ? { projectId: targetId }
              : { newProjectTitle: newProjectTitle.trim() },
          segments: activeClips.map((clip) => ({
            ...configs[clip.id],
            name: configs[clip.id].name.trim(),
          })),
        },
        requestId,
      ),
    onSuccess: (result) => {
      setCreatedTask(result);
      void client.invalidateQueries({
        queryKey: videoEditorQueryKeys.segmentExports(projectId),
      });
    },
  });
  const patchConfig = (clipId: string, patch: Partial<SegmentConfig>) =>
    setConfigs((current) => ({
      ...current,
      [clipId]: { ...current[clipId], ...patch },
    }));
  const applyBatch = () =>
    setConfigs((current) => ({
      ...current,
      ...Object.fromEntries(
        activeClips.map((clip) => [clip.id, { ...current[clip.id], ...batch }]),
      ),
    }));
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const canSubmit =
    !createdTask &&
    activeClips.length > 0 &&
    activeClips.every((clip) => configs[clip.id].name.trim()) &&
    (targetMode === "existing"
      ? Boolean(targetId)
      : Boolean(newProjectTitle.trim()));

  return (
    <div className="ve-dialog-backdrop ve-segment-backdrop">
      <section className="ve-segment-dialog" role="dialog" aria-modal="true">
        <header>
          <div>
            <Layers3 aria-hidden />
            <div>
              <h2>分段导入视频制作工坊</h2>
              <p>逐段命名并设置输出规格，完成后创建独立视频节点</p>
            </div>
          </div>
          <button aria-label="关闭" onClick={onClose}>
            <X aria-hidden />
          </button>
        </header>
        <div className="ve-segment-scope" role="tablist">
          <button
            className={scope === "selected" ? "active" : ""}
            disabled={!selectedVideoIds.length}
            onClick={() => setScope("selected")}
          >
            所选片段 <span>{selectedVideoIds.length}</span>
          </button>
          <button
            className={scope === "all" ? "active" : ""}
            onClick={() => setScope("all")}
          >
            全部片段 <span>{clips.length}</span>
          </button>
        </div>
        <div className="ve-segment-batch">
          <strong>批量默认值</strong>
          {(Object.keys(choices) as ConfigKey[]).map((key) => (
            <Choice
              key={key}
              label={`批量${key}`}
              value={batch[key]}
              options={choices[key]}
              onChange={(value) =>
                setBatch((current) => ({ ...current, [key]: value }))
              }
            />
          ))}
          <button className="apply" onClick={applyBatch}>
            应用到当前片段
          </button>
        </div>
        <div className="ve-segment-list">
          {activeClips.map((clip, index) => {
            const config = configs[clip.id];
            const asset = clip.assetId
              ? assetById.get(clip.assetId)
              : undefined;
            return (
              <article key={clip.id}>
                <div className="ve-segment-thumb">
                  {asset?.thumbnailUrl ? (
                    <img src={asset.thumbnailUrl} alt="" />
                  ) : (
                    <Film aria-hidden />
                  )}
                  <span>{index + 1}</span>
                </div>
                <div className="ve-segment-main">
                  <label>
                    视频名称
                    <input
                      maxLength={120}
                      value={config.name}
                      onChange={(event) =>
                        patchConfig(clip.id, { name: event.target.value })
                      }
                    />
                  </label>
                  <small>
                    源范围 {formatTime(clip.sourceInUs)} –{" "}
                    {formatTime(
                      clip.sourceInUs +
                        Math.floor(clip.durationUs * (clip.playbackRate ?? 1)),
                    )}{" "}
                    · 时长 {formatTime(clip.durationUs)}
                  </small>
                  <div className="ve-segment-configs">
                    {(Object.keys(choices) as ConfigKey[]).map((key) => (
                      <Choice
                        key={key}
                        label={`${config.name}${key}`}
                        value={config[key]}
                        options={choices[key]}
                        onChange={(value) =>
                          patchConfig(clip.id, { [key]: value })
                        }
                      />
                    ))}
                  </div>
                </div>
                <div className="ve-segment-filename">
                  <Volume2 aria-hidden />
                  <small>输出文件</small>
                  <strong>{config.name || "未命名"}.mp4</strong>
                </div>
              </article>
            );
          })}
        </div>
        <div className="ve-segment-target">
          <strong>导入目标</strong>
          <div className="ve-target-modes">
            <button
              className={targetMode === "existing" ? "active" : ""}
              onClick={() => setTargetMode("existing")}
            >
              已有画布项目
            </button>
            <button
              className={targetMode === "new" ? "active" : ""}
              onClick={() => setTargetMode("new")}
            >
              新建画布项目
            </button>
          </div>
          {targetMode === "existing" ? (
            <div className="ve-target-projects">
              {availableProjects.map((project) => (
                <button
                  key={project.id}
                  className={targetId === project.id ? "active" : ""}
                  onClick={() => setTargetProjectId(project.id)}
                >
                  {project.title}
                </button>
              ))}
              {!availableProjects.length ? (
                <span>暂无画布项目，可选择新建</span>
              ) : null}
            </div>
          ) : (
            <input
              aria-label="新画布项目名称"
              maxLength={120}
              value={newProjectTitle}
              onChange={(event) => setNewProjectTitle(event.target.value)}
            />
          )}
        </div>
        {mutation.isError ? (
          <p className="ve-segment-error">
            {mutation.error instanceof Error
              ? mutation.error.message
              : "任务创建失败"}
          </p>
        ) : null}
        {trackedTask ? (
          <div className="ve-segment-progress" aria-live="polite">
            <div className="ve-segment-progress-heading">
              {taskActive ? (
                <LoaderCircle
                  className="ve-segment-progress-spinner"
                  aria-hidden
                />
              ) : trackedTask.status === "completed" ? (
                <CircleCheck aria-hidden />
              ) : (
                <CircleX aria-hidden />
              )}
              <div>
                <strong>{taskStatusLabels[trackedTask.status]}</strong>
                <small>
                  {taskActive
                    ? "任务会在后台继续运行，关闭窗口不会中断。"
                    : trackedTask.status === "completed"
                      ? "所有视频片段已导入目标画布。"
                      : trackedTask.error || "可以关闭窗口后稍后重试。"}
                </small>
              </div>
              <b>{trackedTask.progress}%</b>
            </div>
            <div
              className="ve-segment-progress-bar"
              role="progressbar"
              aria-label="分段导入进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={trackedTask.progress}
            >
              <i style={{ width: `${trackedTask.progress}%` }} />
            </div>
            {Array.isArray(trackedTask.resultDetail?.segments) ? (
              <div className="ve-segment-progress-items">
                {(
                  trackedTask.resultDetail.segments as Array<
                    Record<string, unknown>
                  >
                ).map((segment, index) => (
                  <span key={String(segment.clipId ?? index)}>
                    <em>{String(segment.name || `片段 ${index + 1}`)}</em>
                    {segmentStatusLabels[String(segment.status)] || "处理中"}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <footer>
          <span>
            {createdTask
              ? `任务编号 ${createdTask.id.slice(0, 8)}`
              : `将创建 ${activeClips.length} 个独立视频节点，不自动连线`}
          </span>
          <button onClick={onClose}>
            {taskActive ? "后台运行并关闭" : "关闭"}
          </button>
          <button
            className="primary"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending
              ? "正在创建任务…"
              : createdTask
                ? "任务已提交"
                : "开始导出并导入"}
          </button>
        </footer>
      </section>
    </div>
  );
}
