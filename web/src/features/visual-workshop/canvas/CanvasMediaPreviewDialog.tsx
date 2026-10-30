import { taskActivity } from "../generation/generationActivityModel";
import { executionDetails } from "@shared/ui/taskExecutionPresentation";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Crop,
  Download,
  Image,
  LoaderCircle,
  Music,
  Video,
  X,
} from "lucide-react";
import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import {
  fileQueryKeys,
  getFiles,
  getFolders,
  type ManagedFile,
} from "@features/files";
import {
  getGenerationTasks,
  visualAssetDownloadPath,
  type GenerationTask,
  type VisualCanvasNode,
} from "@features/visual-workshop/api";
import { visualWorkshopQueryKeys } from "@features/visual-workshop/queryKeys";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { GenerationSpinner } from "../generation/GenerationActivity";

import { CanvasImageCrop } from "./CanvasImageCrop";

type MediaNode = Exclude<VisualCanvasNode, { kind: "text" }>;
type MediaMetrics = { duration?: number; width?: number; height?: number };
type ReferenceGroup = { kind: MediaNode["kind"]; label: string; ids: string[] };

const ACTIVE_STATUSES = new Set([
  "queued",
  "submitting",
  "pending",
  "processing",
]);
const STATUS_LABELS: Record<GenerationTask["status"], string> = {
  queued: "排队中",
  submitting: "正在提交",
  pending: "等待处理",
  processing: "生成中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

function formatBytes(value?: number) {
  if (value == null) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

function formatDuration(value?: number) {
  if (value == null || !Number.isFinite(value)) return "—";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function taskReferences(task?: GenerationTask): ReferenceGroup[] {
  const payload = task?.request_payload ?? {};
  const imageIds = [
    payload.reference_asset_id,
    payload.first_frame_asset_id,
    payload.last_frame_asset_id,
    ...(Array.isArray(payload.reference_asset_ids)
      ? payload.reference_asset_ids
      : []),
  ].filter(
    (value): value is string => typeof value === "string" && Boolean(value),
  );
  const videoIds = Array.isArray(payload.video_asset_ids)
    ? payload.video_asset_ids.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const audioIds = Array.isArray(payload.audio_asset_ids)
    ? payload.audio_asset_ids.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const groups: ReferenceGroup[] = [
    { kind: "image", label: "参考图片", ids: [...new Set(imageIds)] },
    { kind: "video", label: "参考视频", ids: [...new Set(videoIds)] },
    { kind: "audio", label: "参考音频", ids: [...new Set(audioIds)] },
  ];
  return groups.filter((group) => group.ids.length);
}

function taskParameters(task?: GenerationTask) {
  if (!task) return [];
  const payload = task.request_payload;
  const entries: Array<[string, unknown]> =
    task.kind === "image"
      ? [
          ["尺寸", payload.size],
          ["种子", payload.seed],
        ]
      : task.kind === "video"
        ? [
            ["生成方式", payload.mode],
            [
              "目标时长",
              payload.duration === -1
                ? "自动时长"
                : payload.duration
                  ? `${payload.duration} 秒`
                  : null,
            ],
            ["分辨率", payload.resolution],
            ["画面比例", payload.ratio],
            [
              "生成声音",
              payload.generate_audio == null
                ? null
                : payload.generate_audio
                  ? "是"
                  : "否",
            ],
            [
              "水印",
              payload.watermark == null
                ? null
                : payload.watermark
                  ? "开启"
                  : "关闭",
            ],
          ]
        : [
            ["生成方式", payload.mode === "sfx" ? "音效" : "音乐"],
            [
              "目标时长",
              payload.duration
                ? `${payload.duration} 秒`
                : payload.smart_duration
                  ? "智能时长"
                  : null,
            ],
            ["主题", payload.theme],
            ["风格", payload.style],
            ["输出格式", payload.output_format],
          ];
  return entries.filter((entry): entry is [string, string | number] =>
    ["string", "number"].includes(typeof entry[1]),
  );
}

function useProjectFiles(projectId: string) {
  const folders = useQuery({
    queryKey: fileQueryKeys.folders(projectId),
    queryFn: () => getFolders(projectId),
  });
  const folderIds = useMemo(
    () => [
      undefined,
      ...(folders.data?.items.map((folder) => folder.id) ?? []),
    ],
    [folders.data?.items],
  );
  const files = useQueries({
    queries: folderIds.map((folderId) => ({
      queryKey: fileQueryKeys.list({
        projectId,
        folderId,
        includeReferences: true,
      }),
      queryFn: () => getFiles({ projectId, folderId, includeReferences: true }),
      enabled: !folders.isLoading,
    })),
  });
  return useMemo(() => {
    const result = new Map<string, ManagedFile>();
    files.forEach((query) =>
      query.data?.items.forEach((file) => result.set(file.id, file)),
    );
    return result;
  }, [files]);
}

function AssetPreview({
  assetId,
  kind,
  name,
  onMetrics,
}: {
  assetId?: string | null;
  kind: MediaNode["kind"];
  name: string;
  onMetrics: (metrics: MediaMetrics) => void;
}) {
  const { url, error } = useApiBlobUrl(
    assetId ? `/v1/files/${encodeURIComponent(assetId)}/content` : null,
  );
  if (!assetId)
    return (
      <div className="canvas-media-dialog-state">当前记录没有可预览素材</div>
    );
  if (error)
    return (
      <div className="canvas-media-dialog-state is-error">
        <AlertTriangle aria-hidden /> 素材已删除或暂时无法读取
      </div>
    );
  if (!url)
    return (
      <div className="canvas-media-dialog-state">
        <LoaderCircle className="spinning" aria-hidden /> 正在加载预览…
      </div>
    );
  if (kind === "image")
    return (
      <img
        src={url}
        alt={name}
        onLoad={(event) =>
          onMetrics({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          })
        }
      />
    );
  if (kind === "video")
    return (
      <video
        key={url}
        src={url}
        controls
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) =>
          onMetrics({
            duration: event.currentTarget.duration,
            width: event.currentTarget.videoWidth,
            height: event.currentTarget.videoHeight,
          })
        }
      />
    );
  return (
    <div className="canvas-media-dialog-audio">
      <Music aria-hidden />
      <strong>{name}</strong>
      <audio
        key={url}
        src={url}
        controls
        preload="metadata"
        onLoadedMetadata={(event) =>
          onMetrics({ duration: event.currentTarget.duration })
        }
      />
    </div>
  );
}

function ReferencePreview({
  assetId,
  kind,
  name,
}: {
  assetId: string;
  kind: MediaNode["kind"];
  name: string;
}) {
  const { url, error } = useApiBlobUrl(
    `/v1/files/${encodeURIComponent(assetId)}/content`,
  );
  const Icon = kind === "image" ? Image : kind === "video" ? Video : Music;
  return (
    <span className="canvas-media-reference" title={name}>
      {url && kind === "image" ? <img src={url} alt="" /> : null}
      {url && kind === "video" ? (
        <video src={url} muted preload="metadata" />
      ) : null}
      {!url || kind === "audio" ? <Icon aria-hidden /> : null}
      {error ? <i>缺失</i> : null}
    </span>
  );
}

function HistoryPreview({ task }: { task: GenerationTask }) {
  const { url } = useApiBlobUrl(
    task.result_asset_id
      ? `/v1/files/${encodeURIComponent(task.result_asset_id)}/content`
      : null,
  );
  const Icon =
    task.kind === "image" ? Image : task.kind === "video" ? Video : Music;
  return (
    <span className={`canvas-media-history-preview ${task.status}`}>
      {url && task.kind === "image" ? <img src={url} alt="" /> : null}
      {url && task.kind === "video" ? (
        <video src={url} muted preload="metadata" />
      ) : null}
      {!url || task.kind === "audio" ? <Icon aria-hidden /> : null}
      {ACTIVE_STATUSES.has(task.status) ? (
        <LoaderCircle className="spinning" aria-hidden />
      ) : null}
      {task.status === "failed" ? <AlertTriangle aria-hidden /> : null}
    </span>
  );
}

function InfoSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="canvas-media-info-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function CanvasMediaPreviewDialog({
  projectId,
  node,
  onClose,
  onSetCurrent,
  onAddCroppedImage,
}: {
  projectId: string;
  node: MediaNode;
  onClose: () => void;
  onAddCroppedImage?: (asset: ManagedFile) => Promise<void>;
  onSetCurrent: (assetId: string, taskId: string) => void;
}) {
  const [cropAsset, setCropAsset] = useState<{ id: string; title: string }>();
  const cropButton = useRef<HTMLButtonElement>(null);
  const closeActions = useRef({ onClose, cropping: Boolean(cropAsset) });
  useEffect(() => {
    closeActions.current = { onClose, cropping: Boolean(cropAsset) };
  }, [onClose, cropAsset]);
  const cancelCrop = () => {
    setCropAsset(undefined);
    requestAnimationFrame(() => cropButton.current?.focus());
  };
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const initialized = useRef(false);
  const [selectedKey, setSelectedKey] = useState("current");
  const [metrics, setMetrics] = useState<MediaMetrics>({});
  const [copied, setCopied] = useState(false);
  const files = useProjectFiles(projectId);
  const history = useInfiniteQuery({
    queryKey: visualWorkshopQueryKeys.generationTaskHistory(projectId, node.id),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      getGenerationTasks({
        projectId,
        canvasNodeId: node.id,
        kind: node.kind,
        page: pageParam,
        pageSize: 24,
      }),
    getNextPageParam: (last, pages) =>
      pages.reduce((total, page) => total + page.items.length, 0) < last.total
        ? pages.length + 1
        : undefined,
    refetchInterval: (query) => {
      const pages = query.state.data?.pages ?? [];
      return pages.some((page) =>
        page.items.some((task) => ACTIVE_STATUSES.has(task.status)),
      )
        ? 1500
        : false;
    },
  });
  const tasks = useMemo(
    () => history.data?.pages.flatMap((page) => page.items) ?? [],
    [history.data?.pages],
  );
  const currentTask = tasks.find(
    (task) => task.result_asset_id === node.asset_id,
  );
  const selectedTask = tasks.find((task) => task.id === selectedKey);
  const manualCurrent = Boolean(node.asset_id && !currentTask);
  const selectedAssetId =
    selectedTask?.result_asset_id ??
    (selectedKey === "current" ? node.asset_id : null);
  const selectedFile = selectedAssetId ? files.get(selectedAssetId) : undefined;
  const selectedDownloadName =
    selectedAssetId === node.asset_id ? node.title : selectedFile?.display_name;
  const selectionKeys = [
    ...(manualCurrent ? ["current"] : []),
    ...tasks.map((task) => task.id),
  ];
  const selectedIndex = Math.max(0, selectionKeys.indexOf(selectedKey));
  const references = taskReferences(selectedTask);
  const parameters = taskParameters(selectedTask);
  const prompt = selectedTask?.request_payload.prompt;

  useEffect(() => {
    if (initialized.current || history.isLoading) return;
    initialized.current = true;
    if (currentTask) setSelectedKey(currentTask.id);
    else if (
      !node.asset_id &&
      node.generation_task_id &&
      tasks.some((task) => task.id === node.generation_task_id)
    )
      setSelectedKey(node.generation_task_id);
    else if (!node.asset_id && tasks[0]) setSelectedKey(tasks[0].id);
  }, [
    currentTask,
    history.isLoading,
    node.asset_id,
    node.generation_task_id,
    tasks,
  ]);

  useEffect(() => {
    setMetrics({});
  }, [selectedAssetId]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (closeActions.current.cropping) return;
        closeActions.current.onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], video[controls], audio[controls], [tabindex='0'], input:not(:disabled)",
        ),
      ];
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    const initialFocus = requestAnimationFrame(() =>
      dialogRef.current
        ?.querySelector<HTMLElement>("[data-dialog-close]")
        ?.focus(),
    );
    return () => {
      cancelAnimationFrame(initialFocus);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, []);

  const moveSelection = (offset: number) => {
    const next = selectionKeys[selectedIndex + offset];
    if (next) setSelectedKey(next);
  };

  return createPortal(
    <div
      className="canvas-media-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !cropAsset) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="canvas-media-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <div>
            <span>
              {node.kind === "image"
                ? "图片预览"
                : node.kind === "video"
                  ? "视频预览"
                  : "音频预览"}
            </span>
            <h2 id={titleId}>{node.title}</h2>
          </div>
          {!cropAsset ? (
            <div>
              {node.kind === "image" && selectedAssetId && onAddCroppedImage ? (
                <button
                  ref={cropButton}
                  title="裁剪图片"
                  aria-label="裁剪图片"
                  onClick={() =>
                    setCropAsset({
                      id: selectedAssetId,
                      title: selectedDownloadName || node.title,
                    })
                  }
                >
                  <Crop aria-hidden />
                </button>
              ) : null}
              {selectedAssetId ? (
                <a
                  href={visualAssetDownloadPath(
                    selectedAssetId,
                    selectedDownloadName,
                  )}
                  title="下载当前预览素材"
                  aria-label="下载当前预览素材"
                >
                  <Download aria-hidden />
                </a>
              ) : null}
              <button
                data-dialog-close
                aria-label="关闭媒体预览"
                onClick={onClose}
              >
                <X aria-hidden />
              </button>
            </div>
          ) : null}
        </header>
        {cropAsset && onAddCroppedImage ? (
          <CanvasImageCrop
            projectId={projectId}
            assetId={cropAsset.id}
            title={cropAsset.title}
            onCancel={cancelCrop}
            onSaved={onClose}
            onAdd={onAddCroppedImage}
          />
        ) : (
          <>
            <div className="canvas-media-dialog-layout">
              <main className={`canvas-media-dialog-stage is-${node.kind}`}>
                <button
                  className="canvas-media-dialog-previous"
                  aria-label="上一个生成记录"
                  disabled={selectedIndex <= 0}
                  onClick={() => moveSelection(-1)}
                >
                  <ChevronLeft aria-hidden />
                </button>
                <AssetPreview
                  assetId={selectedAssetId}
                  kind={node.kind}
                  name={node.title}
                  onMetrics={setMetrics}
                />
                <button
                  className="canvas-media-dialog-next"
                  aria-label="下一个生成记录"
                  disabled={selectedIndex >= selectionKeys.length - 1}
                  onClick={() => moveSelection(1)}
                >
                  <ChevronRight aria-hidden />
                </button>
              </main>
              <aside className="canvas-media-dialog-info">
                {selectedTask ? (
                  <>
                    <div className="canvas-media-task-heading">
                      <span
                        className={`canvas-media-task-status ${selectedTask.status}`}
                      >
                        {ACTIVE_STATUSES.has(selectedTask.status) && (
                          <GenerationSpinner size={12} />
                        )}
                        {taskActivity(selectedTask)?.label ??
                          STATUS_LABELS[selectedTask.status]}
                      </span>
                      {taskActivity(selectedTask)?.progress !== undefined ? (
                        <strong>{taskActivity(selectedTask)?.progress}%</strong>
                      ) : null}
                    </div>
                    {taskActivity(selectedTask) &&
                      selectedTask.execution_info && (
                        <p>{executionDetails(selectedTask.execution_info)}</p>
                      )}
                    {selectedTask.status === "failed" &&
                    selectedTask.error_message ? (
                      <p className="canvas-media-task-error">
                        {selectedTask.error_message}
                      </p>
                    ) : null}
                    <InfoSection title="生成信息">
                      <dl>
                        <dt>模型</dt>
                        <dd>{selectedTask.model_slug}</dd>
                        <dt>服务商</dt>
                        <dd>{selectedTask.provider_name}</dd>
                        {parameters.map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{String(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    </InfoSection>
                    {references.length ? (
                      <InfoSection
                        title={`参考素材 (${references.reduce((total, group) => total + group.ids.length, 0)})`}
                      >
                        {references.map((group) => (
                          <div
                            className="canvas-media-reference-group"
                            key={group.label}
                          >
                            <small>{group.label}</small>
                            <div>
                              {group.ids.map((assetId) => (
                                <ReferencePreview
                                  key={assetId}
                                  assetId={assetId}
                                  kind={group.kind}
                                  name={
                                    files.get(assetId)?.display_name ?? assetId
                                  }
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </InfoSection>
                    ) : null}
                    {typeof prompt === "string" && prompt ? (
                      <InfoSection title="提示词">
                        <div className="canvas-media-prompt">
                          <p>{prompt}</p>
                          <button
                            aria-label="复制提示词"
                            onClick={() => {
                              void navigator.clipboard.writeText(prompt);
                              setCopied(true);
                              window.setTimeout(() => setCopied(false), 1200);
                            }}
                          >
                            {copied ? (
                              <Check aria-hidden />
                            ) : (
                              <Copy aria-hidden />
                            )}
                          </button>
                        </div>
                      </InfoSection>
                    ) : null}
                  </>
                ) : (
                  <InfoSection title="素材来源">
                    <div className="canvas-media-uploaded-badge">
                      非 AI 生成素材
                    </div>
                    <p className="canvas-media-muted">
                      该素材由上传或素材库绑定，不包含模型和提示词信息。
                    </p>
                  </InfoSection>
                )}
                <InfoSection title="文件信息">
                  <dl>
                    <dt>文件名</dt>
                    <dd>{selectedFile?.display_name ?? node.title}</dd>
                    <dt>类型</dt>
                    <dd>{selectedFile?.mime_type ?? node.kind}</dd>
                    <dt>大小</dt>
                    <dd>{formatBytes(selectedFile?.byte_size)}</dd>
                    {metrics.width && metrics.height ? (
                      <>
                        <dt>尺寸</dt>
                        <dd>
                          {metrics.width} × {metrics.height}
                        </dd>
                      </>
                    ) : null}
                    {metrics.duration != null ? (
                      <>
                        <dt>时长</dt>
                        <dd>{formatDuration(metrics.duration)}</dd>
                      </>
                    ) : null}
                  </dl>
                </InfoSection>
                {selectedTask ? (
                  <InfoSection title="时间">
                    <p className="canvas-media-time">
                      <Clock3 aria-hidden />{" "}
                      {new Date(selectedTask.created_at).toLocaleString(
                        "zh-CN",
                      )}
                    </p>
                  </InfoSection>
                ) : null}
                {selectedTask?.status === "completed" &&
                selectedTask.result_asset_id &&
                selectedTask.result_asset_id !== node.asset_id ? (
                  <button
                    className="canvas-media-set-current"
                    onClick={() =>
                      onSetCurrent(
                        selectedTask.result_asset_id!,
                        selectedTask.id,
                      )
                    }
                  >
                    设为当前素材
                  </button>
                ) : null}
              </aside>
            </div>
            <footer className="canvas-media-history">
              <div>
                <strong>生成历史</strong>
                <span>{history.data?.pages[0]?.total ?? 0} 条</span>
              </div>
              <div className="canvas-media-history-track">
                {manualCurrent ? (
                  <button
                    className={selectedKey === "current" ? "selected" : ""}
                    aria-pressed={selectedKey === "current"}
                    onClick={() => setSelectedKey("current")}
                  >
                    <span className="canvas-media-history-preview current">
                      {node.kind === "image" ? (
                        <Image aria-hidden />
                      ) : node.kind === "video" ? (
                        <Video aria-hidden />
                      ) : (
                        <Music aria-hidden />
                      )}
                    </span>
                    <small>当前素材</small>
                  </button>
                ) : null}
                {tasks.map((task, index) => (
                  <button
                    className={`${selectedKey === task.id ? "selected" : ""}${task.result_asset_id === node.asset_id ? " current" : ""}`}
                    aria-pressed={selectedKey === task.id}
                    key={task.id}
                    onClick={() => setSelectedKey(task.id)}
                  >
                    <HistoryPreview task={task} />
                    <small>{index + 1}</small>
                  </button>
                ))}
                {history.isLoading ? (
                  <span className="canvas-media-history-loading">
                    <LoaderCircle className="spinning" aria-hidden />
                    读取历史…
                  </span>
                ) : null}
                {history.hasNextPage ? (
                  <button
                    className="canvas-media-history-more"
                    disabled={history.isFetchingNextPage}
                    onClick={() => void history.fetchNextPage()}
                  >
                    {history.isFetchingNextPage ? "加载中…" : "加载更多"}
                  </button>
                ) : null}
              </div>
            </footer>
          </>
        )}
      </section>
    </div>,
    document.body,
  );
}
