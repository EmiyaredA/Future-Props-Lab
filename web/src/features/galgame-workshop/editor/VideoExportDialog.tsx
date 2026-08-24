import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CheckSquare2,
  Film,
  LoaderCircle,
  Square,
  X,
} from "lucide-react";
import {
  cancelGalgameVideoExport,
  createGalgameVideoExport,
  listGalgameVideoExports,
  previewGalgameVideoExport,
  type GalgameVideoExportBranchSelection,
  type GalgameVideoExportPreset,
  type GalgameVideoExportTask,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { formatTimecode } from "@features/galgame-workshop/editor/timeline";
import { VideoClipTimecodeInput } from "@features/galgame-workshop/editor/VideoClipTimecodeInput";
import {
  DEFAULT_VIDEO_CLIP_DURATION_MS,
  defaultVideoClipRange,
  MAX_VIDEO_CLIP_DURATION_MS,
  type VideoClipRange,
} from "@features/galgame-workshop/editor/videoExportRange";
import { VideoCaptureFrameEditor } from "@features/galgame-workshop/editor/VideoCaptureFrameEditor";
import { VideoEditorHandoffPanel } from "@features/galgame-workshop/editor/VideoEditorHandoffPanel";
import { DeterministicExportFrame } from "@features/galgame-workshop/editor/DeterministicExportFrame";
import {
  ActiveVideoExportStatus,
  VideoExportStartButton,
  VideoExportHistory,
} from "@features/galgame-workshop/editor/VideoExportTaskProgress";
import { useDebouncedValue } from "@features/galgame-workshop/editor/useDebouncedValue";
import {
  FULL_CAPTURE_FRAME,
  normalizeCaptureFrame,
  type CaptureFrame,
} from "@features/galgame-workshop/editor/videoCaptureFrame";
import "@features/galgame-workshop/editor/video-export.css";

const PRESETS: Array<{
  id: GalgameVideoExportPreset;
  label: string;
  detail: string;
}> = [
  { id: "1080p30", label: "1080p / 30", detail: "推荐 · 画质与速度平衡" },
  { id: "720p30", label: "720p / 30", detail: "文件更小、导出更快" },
  { id: "1080p60", label: "1080p / 60", detail: "更流畅、性能要求更高" },
  { id: "720p60", label: "720p / 60", detail: "流畅预览、文件更小" },
];

function languageLabel(locale: string) {
  const language = locale.toLocaleLowerCase();
  if (language.startsWith("zh")) return `中文 · ${locale}`;
  if (language.startsWith("ja")) return `日语 · ${locale}`;
  if (language.startsWith("en")) return `英语 · ${locale}`;
  return locale;
}

function formatDuration(milliseconds: number) {
  const seconds = Math.round(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours, minutes, rest]
    .map((value, index) =>
      index === 0 ? String(value) : String(value).padStart(2, "0"),
    )
    .join(":");
}

export function VideoExportDialog({
  open,
  projectId,
  storyRevision,
  document,
  currentFragmentId,
  currentTimelinePositionMs,
  languageOptions,
  onClose,
}: {
  open: boolean;
  projectId: string;
  storyRevision: number;
  document: GalgameStoryProject;
  currentFragmentId?: string;
  currentTimelinePositionMs?: number;
  languageOptions: string[];
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [preset, setPreset] = useState<GalgameVideoExportPreset>("1080p30");
  const captureStorageKey = `fpl:galgame-video-capture:v1:${projectId}`;
  const [captureFrame, setCaptureFrame] = useState<CaptureFrame>(() => {
    try {
      const stored = localStorage.getItem(captureStorageKey);
      return stored
        ? normalizeCaptureFrame(JSON.parse(stored) as Partial<CaptureFrame>)
        : FULL_CAPTURE_FRAME;
    } catch {
      return FULL_CAPTURE_FRAME;
    }
  });
  const [scope, setScope] = useState<"route" | "fragments" | "clip">("route");
  const preferredLocale =
    languageOptions.find((item) => item.toLocaleLowerCase().startsWith("zh")) ??
    languageOptions[0] ??
    "zh";
  const [locale, setLocale] = useState(preferredLocale);
  const [branchSelections, setBranchSelections] = useState<
    GalgameVideoExportBranchSelection[]
  >([]);
  const [selectedFragmentIds, setSelectedFragmentIds] = useState<string[]>([]);
  const fragmentOptions = useMemo(
    () =>
      [...(document.chapters ?? [])]
        .sort((left, right) => left.order - right.order)
        .map((chapter) => ({
          chapter,
          fragments: chapter.fragments ?? [],
        })),
    [document.chapters],
  );
  const currentFragment = useMemo(
    () =>
      fragmentOptions
        .flatMap(({ fragments }) => fragments)
        .find((fragment) => fragment.id === currentFragmentId),
    [currentFragmentId, fragmentOptions],
  );
  const currentTimelineDurationMs = currentFragment?.timeline?.durationMs;
  const currentPlayheadMs = currentTimelinePositionMs ?? 0;
  const currentPlayheadRef = useRef(currentPlayheadMs);
  currentPlayheadRef.current = currentPlayheadMs;
  const [clipRange, setClipRange] = useState<VideoClipRange>({
    startMs: 0,
    endMs: DEFAULT_VIDEO_CLIP_DURATION_MS,
  });
  const orderedFragmentIds = useMemo(() => {
    const selected = new Set(selectedFragmentIds);
    return fragmentOptions.flatMap(({ fragments }) =>
      fragments
        .filter((fragment) => selected.has(fragment.id))
        .map((fragment) => fragment.id),
    );
  }, [fragmentOptions, selectedFragmentIds]);
  const [error, setError] = useState("");
  const [submissionStatus, setSubmissionStatus] = useState("");
  const [lastCreatedTask, setLastCreatedTask] =
    useState<GalgameVideoExportTask>();
  useEffect(() => {
    if (!open) return;
    setScope("route");
    setBranchSelections([]);
    setSelectedFragmentIds(currentFragmentId ? [currentFragmentId] : []);
    setClipRange(
      defaultVideoClipRange(
        currentTimelineDurationMs ?? 0,
        currentPlayheadRef.current,
      ),
    );
    setError("");
    setSubmissionStatus("");
    setLocale(preferredLocale);
  }, [
    currentFragmentId,
    currentTimelineDurationMs,
    open,
    preferredLocale,
    storyRevision,
  ]);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);
  useEffect(() => {
    try {
      localStorage.setItem(captureStorageKey, JSON.stringify(captureFrame));
    } catch {
      // Browser privacy modes may disable local preferences.
    }
  }, [captureFrame, captureStorageKey]);
  const clipError = useMemo(() => {
    if (currentTimelineDurationMs == null)
      return "当前 Fragment 没有时间轴，无法快速试片";
    if (clipRange.startMs < 0) return "开始时间不能早于 00:00.000";
    if (clipRange.endMs > currentTimelineDurationMs)
      return "结束时间不能超过 Fragment 时长";
    if (clipRange.startMs >= clipRange.endMs) return "结束时间必须晚于开始时间";
    if (clipRange.endMs - clipRange.startMs > MAX_VIDEO_CLIP_DURATION_MS)
      return "快速试片最长为 5 分钟";
    return "";
  }, [clipRange, currentTimelineDurationMs]);
  const previewBody = useMemo(
    () => ({
      expectedStoryRevision: storyRevision,
      locale,
      preset,
      scope,
      ...(scope === "fragments" ? { fragmentIds: orderedFragmentIds } : {}),
      ...(scope === "clip" && currentFragmentId
        ? {
            clipRange: {
              fragmentId: currentFragmentId,
              startMs: clipRange.startMs,
              endMs: clipRange.endMs,
            },
          }
        : {}),
      branchSelections: scope === "route" ? branchSelections : [],
      captureFrame,
    }),
    [
      branchSelections,
      captureFrame,
      clipRange.endMs,
      clipRange.startMs,
      currentFragmentId,
      locale,
      orderedFragmentIds,
      preset,
      scope,
      storyRevision,
    ],
  );
  const checkedPreviewBody = useDebouncedValue(previewBody, 300);
  const previewUpdating = checkedPreviewBody !== previewBody;
  const preview = useQuery({
    queryKey: ["galgame-video-export-preview", projectId, checkedPreviewBody],
    queryFn: () => previewGalgameVideoExport(projectId, checkedPreviewBody),
    enabled:
      open &&
      (scope === "route" ||
        (scope === "fragments" && orderedFragmentIds.length > 0) ||
        (scope === "clip" && !clipError)),
    retry: false,
  });
  const tasks = useQuery({
    queryKey: ["galgame-video-exports", projectId],
    queryFn: () => listGalgameVideoExports(projectId),
    enabled: open,
    refetchInterval: (query) =>
      query.state.data?.items.some((item) =>
        ["queued", "running"].includes(item.status),
      )
        ? 1500
        : false,
  });
  const create = useMutation({
    mutationFn: async () => {
      if (previewUpdating || !preview.data?.ready)
        throw new Error("请等待最新导出设置检查完成");
      return createGalgameVideoExport(projectId, {
        ...checkedPreviewBody,
        requestId: `export-${crypto.randomUUID()}`,
        previewFingerprint: preview.data.previewFingerprint,
      });
    },
    onMutate: () => {
      setError("");
      setSubmissionStatus("正在创建导出任务…");
    },
    onSuccess: (task) => {
      setError("");
      setSubmissionStatus("导出任务已创建，正在后台处理。");
      setLastCreatedTask(task);
      client.setQueryData(
        ["galgame-video-exports", projectId],
        (current: { items: (typeof task)[] } | undefined) => ({
          items: [
            task,
            ...(current?.items ?? []).filter((item) => item.id !== task.id),
          ],
        }),
      );
      void client.invalidateQueries({
        queryKey: ["galgame-video-exports", projectId],
      });
    },
    onError: (reason) => {
      setSubmissionStatus("");
      setError(reason instanceof Error ? reason.message : "无法开始视频导出");
    },
  });
  const cancel = useMutation({
    mutationFn: (exportId: string) =>
      cancelGalgameVideoExport(projectId, exportId),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: ["galgame-video-exports", projectId],
      }),
  });
  const exportChecking = previewUpdating || preview.isFetching;
  const exportReady = !exportChecking && Boolean(preview.data?.ready);
  const requestExport = () => {
    if (create.isPending) return;
    if (exportChecking) {
      setError("");
      setSubmissionStatus("正在检查导出设置，完成后请再次点击。");
      return;
    }
    if (!preview.data?.ready) {
      setError("");
      setSubmissionStatus("请先处理上方导出检查中的问题。");
      return;
    }
    create.mutate();
  };
  if (!open) return null;
  const decision = preview.data?.nextDecision;
  const listedTasks = tasks.data?.items ?? [];
  const listedCreatedTask = lastCreatedTask
    ? listedTasks.find((task) => task.id === lastCreatedTask.id)
    : undefined;
  const latestTask = listedCreatedTask ?? lastCreatedTask ?? listedTasks[0];
  const visibleTasks =
    lastCreatedTask && !listedCreatedTask
      ? [lastCreatedTask, ...listedTasks]
      : listedTasks;
  return (
    <div className="galgame-video-export-backdrop" role="presentation">
      <section
        className="galgame-video-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="导出 Galgame 视频"
      >
        <header>
          <span>
            <Film aria-hidden />
            <span>
              <strong>导出视频</strong>
              <small>导出完整路线、选中片段或时间轴上的一小段</small>
            </span>
          </span>
          <button type="button" onClick={onClose} aria-label="关闭视频导出">
            <X aria-hidden />
          </button>
        </header>
        <ActiveVideoExportStatus
          task={latestTask}
          submitting={create.isPending}
        />
        <div className="galgame-video-export-content">
          <VideoCaptureFrameEditor
            document={document}
            fragment={currentFragment}
            timelinePositionMs={currentPlayheadMs}
            value={captureFrame}
            onChange={setCaptureFrame}
          />
          <DeterministicExportFrame
            projectId={projectId}
            request={checkedPreviewBody}
            fingerprint={
              !previewUpdating && preview.data?.ready
                ? preview.data.previewFingerprint
                : undefined
            }
          />
          <section>
            <h3>导出范围</h3>
            <div
              className="galgame-video-scope"
              role="group"
              aria-label="导出范围"
            >
              <button
                type="button"
                className={scope === "route" ? "active" : ""}
                onClick={() => {
                  setScope("route");
                  setBranchSelections([]);
                }}
              >
                <strong>完整路线</strong>
                <small>从项目入口播放到结局</small>
              </button>
              <button
                type="button"
                className={scope === "fragments" ? "active" : ""}
                onClick={() => {
                  setScope("fragments");
                  setBranchSelections([]);
                  if (!selectedFragmentIds.length && currentFragmentId)
                    setSelectedFragmentIds([currentFragmentId]);
                }}
              >
                <strong>选择片段</strong>
                <small>单选或多选后合并为一个视频</small>
              </button>
              <button
                type="button"
                className={scope === "clip" ? "active" : ""}
                disabled={currentTimelineDurationMs == null}
                aria-describedby={
                  currentTimelineDurationMs == null
                    ? "galgame-video-clip-unavailable"
                    : undefined
                }
                onClick={() => {
                  setScope("clip");
                  setBranchSelections([]);
                  setClipRange(
                    defaultVideoClipRange(
                      currentTimelineDurationMs ?? 0,
                      currentPlayheadMs,
                    ),
                  );
                }}
              >
                <strong>快速试片</strong>
                <small>从当前播放头导出一小段看效果</small>
              </button>
            </div>
            {currentTimelineDurationMs == null ? (
              <p
                className="galgame-video-scope-note"
                id="galgame-video-clip-unavailable"
              >
                当前 Fragment 没有时间轴，无法使用快速试片。
              </p>
            ) : null}
          </section>
          {scope === "fragments" ? (
            <section>
              <div className="galgame-video-fragment-heading">
                <h3>片段</h3>
                <span>
                  <button
                    type="button"
                    disabled={!currentFragmentId}
                    onClick={() => {
                      if (currentFragmentId)
                        setSelectedFragmentIds([currentFragmentId]);
                    }}
                  >
                    仅当前片段
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedFragmentIds(
                        fragmentOptions.flatMap(({ fragments }) =>
                          fragments.map((fragment) => fragment.id),
                        ),
                      )
                    }
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedFragmentIds([])}
                  >
                    清空
                  </button>
                </span>
              </div>
              <div className="galgame-video-fragment-list">
                {fragmentOptions.map(({ chapter, fragments }) => (
                  <section key={chapter.id}>
                    <header>
                      <strong>{chapter.title}</strong>
                      <small>{fragments.length} 个片段</small>
                    </header>
                    {fragments.map((fragment) => {
                      const checked = selectedFragmentIds.includes(fragment.id);
                      return (
                        <button
                          key={fragment.id}
                          type="button"
                          role="checkbox"
                          aria-checked={checked}
                          className={checked ? "selected" : ""}
                          onClick={() =>
                            setSelectedFragmentIds((current) =>
                              current.includes(fragment.id)
                                ? current.filter((id) => id !== fragment.id)
                                : [...current, fragment.id],
                            )
                          }
                        >
                          {checked ? (
                            <CheckSquare2 aria-hidden />
                          ) : (
                            <Square aria-hidden />
                          )}
                          <span>
                            <strong>{fragment.title}</strong>
                            <small>
                              {fragment.timeline
                                ? formatDuration(fragment.timeline.durationMs)
                                : `${fragment.blocks?.length ?? 0} 个 Block`}
                            </small>
                          </span>
                        </button>
                      );
                    })}
                  </section>
                ))}
              </div>
              <p className="galgame-video-fragment-summary">
                已选择 {orderedFragmentIds.length}{" "}
                个片段，将按故事中的先后顺序合并导出。
              </p>
            </section>
          ) : null}
          {scope === "clip" && currentTimelineDurationMs != null ? (
            <section className="galgame-video-clip-editor">
              <div className="galgame-video-clip-heading">
                <span>
                  <h3>快速试片区间</h3>
                  <small>
                    {currentFragment?.title} · 总时长{" "}
                    {formatTimecode(currentTimelineDurationMs)}
                  </small>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setClipRange(
                      defaultVideoClipRange(
                        currentTimelineDurationMs,
                        currentPlayheadMs,
                      ),
                    )
                  }
                >
                  重新使用当前播放头
                </button>
              </div>
              <div className="galgame-video-clip-sliders">
                <div className="galgame-video-clip-track" aria-hidden />
                <div
                  className="galgame-video-clip-selection"
                  aria-hidden
                  style={{
                    left: `${(Math.max(0, Math.min(currentTimelineDurationMs, clipRange.startMs)) / currentTimelineDurationMs) * 100}%`,
                    width: `${(Math.max(0, Math.min(currentTimelineDurationMs, clipRange.endMs) - Math.max(0, clipRange.startMs)) / currentTimelineDurationMs) * 100}%`,
                  }}
                />
                <input
                  type="range"
                  min="0"
                  max={currentTimelineDurationMs}
                  step="100"
                  value={Math.min(currentTimelineDurationMs, clipRange.startMs)}
                  aria-label="快速试片开始位置"
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setClipRange((current) => ({
                      ...current,
                      startMs: Math.min(value, current.endMs - 100),
                    }));
                  }}
                />
                <input
                  type="range"
                  min="0"
                  max={currentTimelineDurationMs}
                  step="100"
                  value={Math.max(0, clipRange.endMs)}
                  aria-label="快速试片结束位置"
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setClipRange((current) => ({
                      ...current,
                      endMs: Math.max(value, current.startMs + 100),
                    }));
                  }}
                />
              </div>
              <div className="galgame-video-clip-timecodes">
                <VideoClipTimecodeInput
                  label="开始时间"
                  value={clipRange.startMs}
                  onCommit={(startMs) =>
                    setClipRange((current) => ({ ...current, startMs }))
                  }
                />
                <span aria-hidden>—</span>
                <VideoClipTimecodeInput
                  label="结束时间"
                  value={clipRange.endMs}
                  onCommit={(endMs) =>
                    setClipRange((current) => ({ ...current, endMs }))
                  }
                />
              </div>
              <div className="galgame-video-clip-shortcuts">
                <span>从开始点向后：</span>
                {[5_000, 10_000, 30_000].map((durationMs) => (
                  <button
                    key={durationMs}
                    type="button"
                    onClick={() =>
                      setClipRange((current) => ({
                        startMs: current.startMs,
                        endMs: Math.min(
                          currentTimelineDurationMs,
                          current.startMs + durationMs,
                        ),
                      }))
                    }
                  >
                    {durationMs / 1000} 秒
                  </button>
                ))}
                <strong>
                  成片{" "}
                  {formatTimecode(
                    Math.max(0, clipRange.endMs - clipRange.startMs),
                  )}
                </strong>
              </div>
              {clipError ? (
                <p className="galgame-video-clip-error">{clipError}</p>
              ) : (
                <p className="galgame-video-clip-note">
                  将从区间前最多预热 500ms；预热内容不会进入成片。
                </p>
              )}
            </section>
          ) : null}
          <section>
            <h3>语言</h3>
            <div className="galgame-video-languages">
              {languageOptions.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={locale === item ? "active" : ""}
                  onClick={() => setLocale(item)}
                >
                  {languageLabel(item)}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h3>画质</h3>
            <div className="galgame-video-presets">
              {PRESETS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={preset === item.id ? "active" : ""}
                  onClick={() => setPreset(item.id)}
                >
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </button>
              ))}
            </div>
          </section>
          <section>
            <h3>{scope === "route" ? "路线" : "导出检查"}</h3>
            {scope === "fragments" && !orderedFragmentIds.length ? (
              <div className="galgame-video-export-issues">
                <p>请至少选择一个片段</p>
              </div>
            ) : scope === "clip" && clipError ? (
              <div className="galgame-video-export-issues">
                <p>{clipError}</p>
              </div>
            ) : previewUpdating || preview.isFetching ? (
              <p className="galgame-video-export-loading">
                <LoaderCircle className="spinning" aria-hidden />
                正在检查最新导出设置…
              </p>
            ) : decision ? (
              <div className="galgame-video-decision">
                <strong>{decision.prompt || "请选择路线"}</strong>
                <div>
                  {decision.choices.map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      onClick={() =>
                        setBranchSelections((current) => [
                          ...current.filter(
                            (item) =>
                              item.branchBlockId !== decision.branchBlockId,
                          ),
                          {
                            branchBlockId: decision.branchBlockId,
                            choiceId: choice.id,
                          },
                        ])
                      }
                    >
                      {choice.text || "未命名选项"}
                    </button>
                  ))}
                </div>
              </div>
            ) : preview.data?.ready ? (
              <div className="galgame-video-route-ready">
                <Check aria-hidden />
                <span>
                  <strong>{preview.data.route.endingLabel}</strong>
                  <small>
                    {scope === "fragments"
                      ? `已选择 ${preview.data.route.fragmentIds.length} 个片段`
                      : scope === "clip"
                        ? `${formatTimecode(clipRange.startMs)}–${formatTimecode(clipRange.endMs)}`
                        : preview.data.route.branchBlockIds.length
                          ? `已选择 ${preview.data.route.branchBlockIds.length} 个分支`
                          : "当前路线没有分支选项"}
                  </small>
                </span>
                <time>
                  {formatDuration(preview.data.route.estimatedDurationMs)}
                  {!preview.data.route.exactDuration ? "（预计）" : ""}
                </time>
                {branchSelections.length ? (
                  <button type="button" onClick={() => setBranchSelections([])}>
                    重选路线
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="galgame-video-export-issues">
                {(preview.data?.blockers ?? []).map((issue) => (
                  <p key={`${issue.code}-${issue.path}`}>{issue.message}</p>
                ))}
                {preview.error ? <p>{preview.error.message}</p> : null}
              </div>
            )}
            {(preview.data?.warnings ?? []).map((issue) => (
              <p
                className="galgame-video-export-warning"
                key={`${issue.code}-${issue.path}`}
              >
                {issue.message}
              </p>
            ))}
          </section>
          {error ? (
            <p className="galgame-video-export-error-text" role="alert">
              {error}
            </p>
          ) : null}
          <VideoExportStartButton
            checking={exportChecking}
            ready={exportReady}
            submitting={create.isPending}
            onClick={requestExport}
          />
          {submissionStatus ? (
            <p className="galgame-video-export-submission" role="status">
              {submissionStatus}
            </p>
          ) : null}
          <VideoEditorHandoffPanel
            projectId={projectId}
            request={checkedPreviewBody}
            fingerprint={
              previewUpdating ? undefined : preview.data?.previewFingerprint
            }
            disabled={previewUpdating || !preview.data?.ready}
          />
          <VideoExportHistory
            projectId={projectId}
            tasks={visibleTasks}
            loading={tasks.isFetching && !visibleTasks.length}
            refreshing={tasks.isFetching && Boolean(visibleTasks.length)}
            error={tasks.isError ? tasks.error.message : undefined}
            onRetry={() => void tasks.refetch()}
            onCancel={(taskId) => cancel.mutate(taskId)}
          />
        </div>
      </section>
    </div>
  );
}
