import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Download,
  FileAudio2,
  FileImage,
  FileVideo2,
  Image,
  LoaderCircle,
  Paperclip,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { CustomSelect, type SelectOption } from "@shared/ui/CustomSelect";
import {
  ModelTestWorkspaceHeader,
  type ModelTestMode,
} from "@features/models/workspace/ModelTestWorkspaceHeader";
import {
  backfillModelTestReferenceAssets,
  cleanupModelTestReferenceAssets,
  createModelTestGenerationTask,
  deleteModelTestReferenceAsset,
  deleteModelTestGenerationTask,
  getModelTestGenerationOptions,
  getModelTestGenerationResult,
  getModelTestGenerationTasks,
  getModelTestReferenceBackfillStatus,
  retryModelTestGenerationMaterialization,
  type ModelTestGenerationTask,
  type ModelTestReferenceAsset,
  uploadModelTestReferenceAssets,
} from "@features/models/api";

type GenerationKind = "image" | "video";
type Resolution = "480p" | "720p" | "1080p";
type Ratio = "16:9" | "9:16" | "4:3" | "3:4" | "1:1";
type ReferenceKind = "image" | "audio" | "video";

type LocalReference = {
  id: string;
  file: File;
  kind: ReferenceKind;
  previewUrl: string;
};

type TestModel = {
  value: string;
  label: string;
  description: string;
  providerKind:
    "openai" | "anthropic" | "senseaudio_image" | "senseaudio_video";
};

const statusLabel: Record<ModelTestGenerationTask["status"], string> = {
  queued: "等待提交",
  submitting: "正在提交",
  pending: "等待生成",
  processing: "生成中",
  completed: "已完成",
  failed: "失败",
};

const pendingStatuses: ModelTestGenerationTask["status"][] = [
  "queued",
  "submitting",
  "pending",
  "processing",
];

const durationOptions: SelectOption[] = Array.from(
  { length: 12 },
  (_, index) => {
    const value = String(index + 4);
    return { value, label: `${value} 秒` };
  },
);

const resolutions: Resolution[] = ["480p", "720p", "1080p"];
const ratios: Ratio[] = ["16:9", "9:16", "4:3", "3:4", "1:1"];
const referenceLimits: Record<ReferenceKind, number> = {
  image: 9,
  audio: 3,
  video: 3,
};
const referenceMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "video/mp4",
  "video/quicktime",
]);
const maxReferenceBytes = 45 * 1024 * 1024;

function referenceKind(file: File): ReferenceKind | null {
  if (!referenceMimeTypes.has(file.type)) return null;
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function modelGenerationKind(model: TestModel): GenerationKind | null {
  if (model.providerKind === "senseaudio_image") return "image";
  if (model.providerKind === "senseaudio_video") return "video";
  return null;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatElapsed(task: ModelTestGenerationTask, now: number) {
  const start = new Date(task.created_at).getTime();
  const end = task.completed_at ? new Date(task.completed_at).getTime() : now;
  const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [minutes, seconds].map((part) => String(part).padStart(2, "0"));
  if (hours) parts.unshift(String(hours).padStart(2, "0"));
  return parts.join(":");
}

function TaskThumbnail({ task }: { task: ModelTestGenerationTask }) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (visible || !root.current || typeof IntersectionObserver === "undefined")
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: "120px" },
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    let objectUrl = "";
    let disposed = false;
    setUrl("");
    setFailed(false);
    if (!visible || !task.result_available) return;
    void getModelTestGenerationResult(task.id)
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [task.id, task.result_available, visible]);

  const fallback =
    task.status === "completed" && task.result_available && !failed ? (
      <LoaderCircle className="spinning" aria-hidden />
    ) : task.kind === "image" ? (
      <Image aria-hidden />
    ) : (
      <Video aria-hidden />
    );

  return (
    <div className={`generation-task-thumbnail ${task.kind}`} ref={root}>
      {url && task.kind === "image" ? <img src={url} alt="" /> : null}
      {url && task.kind === "video" ? (
        <video src={url} muted preload="metadata" aria-hidden />
      ) : null}
      {!url ? fallback : null}
    </div>
  );
}

export function ModelGenerationTestPanel({
  models,
  modelId,
  onSelectModel,
  onSelectMode,
}: {
  models: TestModel[];
  modelId: string;
  onSelectModel: (modelId: string) => void;
  onSelectMode: (mode: ModelTestMode) => void;
}) {
  const client = useQueryClient();
  const currentModel = models.find((model) => model.value === modelId);
  const kind = currentModel ? modelGenerationKind(currentModel) : null;
  const generationKind = kind ?? "image";
  const [activeId, setActiveId] = useState<string | null>(null);
  const [taskSearch, setTaskSearch] = useState("");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("");
  const [seed, setSeed] = useState("");
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState<Resolution>("720p");
  const [ratio, setRatio] = useState<Ratio>("16:9");
  const [watermark, setWatermark] = useState(true);
  const [generateAudio, setGenerateAudio] = useState(false);
  const [referenceFiles, setReferenceFiles] = useState<LocalReference[]>([]);
  const [error, setError] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [resultError, setResultError] = useState("");
  const [resultLoadRevision, setResultLoadRevision] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const referenceUrlsRef = useRef(new Set<string>());

  const generationModels = useMemo(
    () =>
      models.filter((model) => modelGenerationKind(model) === generationKind),
    [generationKind, models],
  );
  const availableModes: Record<ModelTestMode, boolean> = {
    chat: models.some((model) =>
      ["openai", "anthropic"].includes(model.providerKind),
    ),
    image: models.some((model) => modelGenerationKind(model) === "image"),
    video: models.some((model) => modelGenerationKind(model) === "video"),
    audio: false,
  };
  const modelOptions: SelectOption[] = useMemo(
    () =>
      generationModels.map((model) => ({
        value: model.value,
        label: model.label,
        description: model.description,
      })),
    [generationModels],
  );

  const optionsQuery = useQuery({
    queryKey: ["model-test-generation-options"],
    queryFn: getModelTestGenerationOptions,
  });
  const selectedOption = optionsQuery.data?.items.find(
    (item) => item.id === modelId,
  );
  const tasksQuery = useQuery({
    queryKey: ["model-test-generation-tasks", modelId],
    queryFn: () => getModelTestGenerationTasks(modelId),
    refetchInterval: (query) =>
      query.state.data?.items.some((task) =>
        pendingStatuses.includes(task.status),
      )
        ? 5000
        : false,
  });
  const backfillStatusQuery = useQuery({
    queryKey: ["model-test-generation-asset-backfill"],
    queryFn: getModelTestReferenceBackfillStatus,
  });
  const tasks = tasksQuery.data?.items ?? [];
  const normalizedSearch = taskSearch.trim().toLowerCase();
  const filteredTasks = normalizedSearch
    ? tasks.filter((task) =>
        `${String(task.request_payload.prompt || "")} ${task.model_slug} ${statusLabel[task.status]}`
          .toLowerCase()
          .includes(normalizedSearch),
      )
    : tasks;
  const activeTask = tasks.find((task) => task.id === activeId) ?? tasks[0];

  useEffect(() => {
    setActiveId(null);
    setTaskSearch("");
    setPrompt("");
    setError("");
    setReferenceFiles((current) => {
      current.forEach((item) => {
        URL.revokeObjectURL(item.previewUrl);
        referenceUrlsRef.current.delete(item.previewUrl);
      });
      return [];
    });
  }, [kind, modelId]);

  useEffect(
    () => () => {
      referenceUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      referenceUrlsRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    void cleanupModelTestReferenceAssets().catch(() => undefined);
  }, []);

  useEffect(() => {
    const sizes = selectedOption?.sizes ?? [];
    if (generationKind !== "image" || !sizes.length) return;
    if (!sizes.includes(size)) {
      setSize(sizes.includes("1024x1024") ? "1024x1024" : sizes[0]);
    }
  }, [generationKind, selectedOption, size]);

  useEffect(() => {
    let objectUrl = "";
    let disposed = false;
    setResultUrl("");
    setResultError("");
    if (!activeTask?.result_available) return;
    void getModelTestGenerationResult(activeTask.id)
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setResultUrl(objectUrl);
      })
      .catch((cause) => {
        if (!disposed)
          setResultError(
            cause instanceof Error ? cause.message : String(cause),
          );
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeTask?.id, activeTask?.result_available, resultLoadRevision]);

  useEffect(() => {
    if (!activeTask || !pendingStatuses.includes(activeTask.status)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeTask]);

  const refresh = async () => {
    await Promise.all([
      tasksQuery.refetch(),
      client.invalidateQueries({ queryKey: ["model-logs"] }),
    ]);
  };
  const createMutation = useMutation({
    mutationFn: async () => {
      if (generationKind === "image") {
        return createModelTestGenerationTask({
          kind: "image",
          model_id: modelId,
          prompt: prompt.trim(),
          size,
          seed: seed === "" ? null : Number(seed),
        });
      }
      const uploaded: Array<{
        reference: LocalReference;
        asset: ModelTestReferenceAsset;
      }> = [];
      try {
        if (referenceFiles.length) {
          const response = await uploadModelTestReferenceAssets(
            referenceFiles.map((reference) => reference.file),
          );
          response.items.forEach((asset, index) =>
            uploaded.push({ reference: referenceFiles[index], asset }),
          );
        }
        return await createModelTestGenerationTask({
          kind: "video",
          model_id: modelId,
          prompt: prompt.trim(),
          duration,
          resolution,
          ratio,
          watermark,
          generate_audio: generateAudio,
          reference_asset_ids: uploaded
            .filter((item) => item.reference.kind === "image")
            .map((item) => item.asset.id),
          audio_asset_ids: uploaded
            .filter((item) => item.reference.kind === "audio")
            .map((item) => item.asset.id),
          video_asset_ids: uploaded
            .filter((item) => item.reference.kind === "video")
            .map((item) => item.asset.id),
        });
      } catch (cause) {
        await Promise.allSettled(
          uploaded.map((item) => deleteModelTestReferenceAsset(item.asset)),
        );
        throw cause;
      }
    },
    onSuccess: async (task) => {
      setActiveId(task.id);
      setPrompt("");
      setError("");
      setReferenceFiles((current) => {
        current.forEach((item) => {
          URL.revokeObjectURL(item.previewUrl);
          referenceUrlsRef.current.delete(item.previewUrl);
        });
        return [];
      });
      await refresh();
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
  });
  const removeMutation = useMutation({
    mutationFn: (task: ModelTestGenerationTask) =>
      deleteModelTestGenerationTask(task.id, task.revision),
    onSuccess: async () => {
      setActiveId(null);
      await refresh();
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
  });
  const retryMutation = useMutation({
    mutationFn: (taskId: string) =>
      retryModelTestGenerationMaterialization(taskId),
    onSuccess: refresh,
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
  });
  const backfillMutation = useMutation({
    mutationFn: backfillModelTestReferenceAssets,
    onSuccess: async () => {
      await Promise.all([backfillStatusQuery.refetch(), tasksQuery.refetch()]);
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!prompt.trim() || !selectedOption) return;
    const hasAudio = referenceFiles.some((item) => item.kind === "audio");
    const hasVisualReference = referenceFiles.some(
      (item) => item.kind === "image" || item.kind === "video",
    );
    if (generationKind === "video" && hasAudio && !hasVisualReference) {
      setError("参考音频需要搭配至少一张参考图片或一个参考视频");
      return;
    }
    createMutation.mutate();
  };
  const addReferenceFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const next = [...referenceFiles];
    let totalBytes = next.reduce((sum, item) => sum + item.file.size, 0);
    for (const file of Array.from(files)) {
      const kind = referenceKind(file);
      if (!kind) {
        setError("只支持 JPG、PNG、WebP、GIF、MP3、WAV、MP4 和 MOV 参考素材");
        continue;
      }
      if (
        next.filter((item) => item.kind === kind).length >=
        referenceLimits[kind]
      ) {
        setError(
          `${kind === "image" ? "图片" : kind === "audio" ? "音频" : "视频"}最多添加 ${referenceLimits[kind]} 个`,
        );
        continue;
      }
      if (kind === "audio" && file.size > 15 * 1024 * 1024) {
        setError("单个参考音频不能超过 15 MB");
        continue;
      }
      if (kind === "image" && file.size > 30 * 1024 * 1024) {
        setError("单张参考图片不能超过 30 MB");
        continue;
      }
      if (totalBytes + file.size > maxReferenceBytes) {
        setError("本地参考素材总大小不能超过 45 MB");
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      referenceUrlsRef.current.add(previewUrl);
      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        kind,
        previewUrl,
      });
      totalBytes += file.size;
    }
    setReferenceFiles(next);
    if (referenceInputRef.current) referenceInputRef.current.value = "";
  };
  const removeReferenceFile = (id: string) => {
    setReferenceFiles((current) =>
      current.filter((item) => {
        if (item.id !== id) return true;
        URL.revokeObjectURL(item.previewUrl);
        referenceUrlsRef.current.delete(item.previewUrl);
        return false;
      }),
    );
  };
  const sizeOptions: SelectOption[] = (selectedOption?.sizes ?? []).map(
    (item) => ({ value: item, label: item }),
  );
  const taskPrompt = activeTask
    ? String(activeTask.request_payload.prompt || "")
    : "";

  return (
    <section className="model-test-page generation-test-page">
      <ModelTestWorkspaceHeader
        activeMode={generationKind}
        availableModes={availableModes}
        onSelectMode={onSelectMode}
        modelId={modelId}
        modelOptions={modelOptions}
        onSelectModel={onSelectModel}
      />
      {backfillStatusQuery.data?.pending_tasks ? (
        <div className="inline-alert warning playground-alert" role="status">
          检测到 {backfillStatusQuery.data.pending_tasks}{" "}
          个历史任务仍在使用公共参考素材。
          <button
            type="button"
            disabled={
              backfillMutation.isPending ||
              backfillStatusQuery.data.eligible_tasks === 0
            }
            onClick={() => backfillMutation.mutate()}
          >
            {backfillMutation.isPending ? "迁移中…" : "迁移历史素材"}
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="inline-alert danger playground-alert" role="alert">
          {error}
          <button aria-label="关闭提示" onClick={() => setError("")}>
            ×
          </button>
        </div>
      ) : null}
      <div className="generation-test-grid">
        <aside className="generation-test-history">
          <div className="generation-history-head">
            <div>
              <strong>最近任务</strong>
              <span>{tasks.length} 条记录</span>
            </div>
            <label className="generation-task-search">
              <Search aria-hidden />
              <input
                type="search"
                aria-label="搜索生成任务"
                placeholder="搜索提示词或状态"
                value={taskSearch}
                onChange={(event) => setTaskSearch(event.target.value)}
              />
            </label>
          </div>
          <div className="generation-test-task-list">
            {filteredTasks.map((task) => (
              <button
                type="button"
                className={task.id === activeTask?.id ? "active" : ""}
                key={task.id}
                onClick={() => setActiveId(task.id)}
              >
                <TaskThumbnail task={task} />
                <span className="generation-task-copy">
                  <strong>
                    {String(task.request_payload.prompt || "未命名测试")}
                  </strong>
                  <small>{formatTime(task.created_at)}</small>
                  <span className={`generation-task-status ${task.status}`}>
                    {task.status === "completed" ? (
                      <CheckCircle2 aria-hidden />
                    ) : null}
                    {statusLabel[task.status]}
                    {task.status === "processing" ? ` ${task.progress}%` : ""}
                  </span>
                </span>
              </button>
            ))}
            {!tasks.length ? (
              <div className="generation-list-empty">
                {generationKind === "image" ? (
                  <Image aria-hidden />
                ) : (
                  <Video aria-hidden />
                )}
                <strong>还没有测试记录</strong>
                <span>提交任务后会显示在这里。</span>
              </div>
            ) : null}
            {tasks.length && !filteredTasks.length ? (
              <div className="generation-list-empty compact">
                <Search aria-hidden />
                <strong>没有匹配的任务</strong>
                <span>换个关键词再试试。</span>
              </div>
            ) : null}
          </div>
        </aside>
        <main className="generation-test-result">
          {activeTask ? (
            <>
              <div className="generation-result-head">
                <div className="generation-result-meta">
                  <strong>{activeTask.model_slug}</strong>
                  <span className={`generation-status ${activeTask.status}`}>
                    {statusLabel[activeTask.status]}
                    {activeTask.status === "processing"
                      ? ` ${activeTask.progress}%`
                      : ""}
                  </span>
                  <small>
                    {pendingStatuses.includes(activeTask.status)
                      ? "已进行"
                      : "耗时"}{" "}
                    {formatElapsed(activeTask, now)}
                  </small>
                </div>
                <div className="generation-result-actions">
                  {resultUrl ? (
                    <a
                      href={resultUrl}
                      download={activeTask.result_filename || undefined}
                      aria-label="下载生成结果"
                      title="下载生成结果"
                    >
                      <Download aria-hidden />
                    </a>
                  ) : null}
                  {!pendingStatuses.includes(activeTask.status) ? (
                    <button
                      type="button"
                      aria-label="删除测试记录"
                      title="删除测试记录"
                      disabled={removeMutation.isPending}
                      onClick={() => removeMutation.mutate(activeTask)}
                    >
                      <Trash2 aria-hidden />
                    </button>
                  ) : null}
                </div>
              </div>
              <div className={`generation-result-stage ${activeTask.kind}`}>
                {resultUrl && activeTask.kind === "image" ? (
                  <img src={resultUrl} alt={taskPrompt || "生成图片"} />
                ) : null}
                {resultUrl && activeTask.kind === "video" ? (
                  <video src={resultUrl} controls />
                ) : null}
                {!resultUrl && resultError ? (
                  <div className="generation-result-pending failed">
                    <strong>结果加载失败</strong>
                    <span>{resultError}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setResultLoadRevision((revision) => revision + 1)
                      }
                    >
                      <RotateCcw aria-hidden /> 重新加载
                    </button>
                  </div>
                ) : null}
                {!resultUrl &&
                !resultError &&
                activeTask.status !== "failed" ? (
                  <div className="generation-result-pending">
                    <LoaderCircle className="spinning" aria-hidden />
                    <strong>
                      {activeTask.result_available
                        ? "正在加载结果"
                        : statusLabel[activeTask.status]}
                    </strong>
                    <span>任务会在后台继续执行，刷新页面也不会丢失。</span>
                  </div>
                ) : null}
                {activeTask.status === "failed" ? (
                  <div className="generation-result-pending failed">
                    <strong>生成失败</strong>
                    <span>{activeTask.error_message}</span>
                    {activeTask.can_retry_materialization ? (
                      <button
                        type="button"
                        onClick={() => retryMutation.mutate(activeTask.id)}
                      >
                        <RotateCcw aria-hidden /> 重试保存结果
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="generation-result-prompt">
                <div>
                  <strong>提示词</strong>
                  <span>{taskPrompt.length} / 6000</span>
                </div>
                <p>{taskPrompt}</p>
              </div>
            </>
          ) : (
            <div className="generation-result-pending generation-result-empty">
              <span className="generation-empty-icon">
                {generationKind === "image" ? (
                  <Image aria-hidden />
                ) : (
                  <Video aria-hidden />
                )}
              </span>
              <strong>
                开始一次{generationKind === "image" ? "图片" : "视频"}测试
              </strong>
              <span>填写右侧参数，生成结果和任务进度会显示在这里。</span>
            </div>
          )}
        </main>
        <aside className="generation-test-settings">
          <div className="generation-settings-head">
            <strong>生成参数</strong>
            <span>{generationKind === "image" ? "图片" : "视频"}</span>
          </div>
          <form onSubmit={submit}>
            <label className="generation-prompt-field">
              <span className="generation-field-head">
                <span>提示词</span>
                <small>{prompt.length} / 6000</small>
              </span>
              <textarea
                required
                maxLength={6000}
                rows={7}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={
                  generationKind === "image"
                    ? "描述要生成的画面…"
                    : "描述镜头、动作和氛围…"
                }
              />
            </label>
            {generationKind === "image" ? (
              <>
                <label>
                  <span>尺寸</span>
                  <CustomSelect
                    ariaLabel="尺寸"
                    className="generation-parameter-select"
                    value={size}
                    options={sizeOptions}
                    onChange={setSize}
                    disabled={!sizeOptions.length}
                  />
                </label>
                <label>
                  <span>种子（可选）</span>
                  <input
                    type="number"
                    min="0"
                    value={seed}
                    onChange={(event) => setSeed(event.target.value)}
                    placeholder="随机"
                  />
                </label>
              </>
            ) : (
              <>
                <fieldset className="generation-reference-fieldset">
                  <legend>
                    参考素材 <small>可选</small>
                  </legend>
                  <input
                    ref={referenceInputRef}
                    className="sr-only"
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/wav,video/mp4,video/quicktime"
                    aria-label="上传参考图片、音频或视频"
                    onChange={(event) => addReferenceFiles(event.target.files)}
                  />
                  <button
                    type="button"
                    className="generation-reference-add"
                    onClick={() => referenceInputRef.current?.click()}
                  >
                    <Paperclip aria-hidden />
                    <span>
                      <strong>上传参考图片、音频或视频</strong>
                      <small>可多选，本地素材合计不超过 45 MB</small>
                    </span>
                  </button>
                  {referenceFiles.length ? (
                    <div className="generation-reference-list">
                      {referenceFiles.map((item) => (
                        <div
                          className="generation-reference-item"
                          key={item.id}
                        >
                          <div
                            className={`generation-reference-preview ${item.kind}`}
                          >
                            {item.kind === "image" ? (
                              <img src={item.previewUrl} alt="" />
                            ) : null}
                            {item.kind === "video" ? (
                              <video
                                src={item.previewUrl}
                                muted
                                preload="metadata"
                              />
                            ) : null}
                            {item.kind === "audio" ? (
                              <FileAudio2 aria-hidden />
                            ) : null}
                          </div>
                          <span>
                            <strong>{item.file.name}</strong>
                            <small>
                              {item.kind === "image" ? (
                                <FileImage aria-hidden />
                              ) : item.kind === "video" ? (
                                <FileVideo2 aria-hidden />
                              ) : (
                                <FileAudio2 aria-hidden />
                              )}
                              {item.kind === "image"
                                ? "图片"
                                : item.kind === "video"
                                  ? "视频"
                                  : "音频"}
                              · {formatBytes(item.file.size)}
                            </small>
                          </span>
                          <button
                            type="button"
                            aria-label={`移除参考素材 ${item.file.name}`}
                            onClick={() => removeReferenceFile(item.id)}
                          >
                            <X aria-hidden />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <p>音频需搭配参考图片或视频；最多 9 图、3 音频、3 视频。</p>
                </fieldset>
                <label>
                  <span>时长</span>
                  <CustomSelect
                    ariaLabel="时长"
                    className="generation-parameter-select generation-duration-select"
                    value={String(duration)}
                    options={durationOptions}
                    onChange={(value) => setDuration(Number(value))}
                  />
                </label>
                <fieldset className="generation-fieldset">
                  <legend>分辨率</legend>
                  <div
                    className="generation-segmented"
                    role="group"
                    aria-label="分辨率"
                  >
                    {resolutions.map((item) => (
                      <button
                        type="button"
                        aria-pressed={resolution === item}
                        className={resolution === item ? "active" : ""}
                        key={item}
                        onClick={() => setResolution(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="generation-fieldset">
                  <legend>比例</legend>
                  <div
                    className="generation-ratio-options"
                    role="group"
                    aria-label="比例"
                  >
                    {ratios.map((item) => (
                      <button
                        type="button"
                        aria-pressed={ratio === item}
                        className={ratio === item ? "active" : ""}
                        key={item}
                        onClick={() => setRatio(item)}
                      >
                        <i
                          className={`generation-ratio-shape ratio-${item.replace(":", "-")}`}
                          aria-hidden
                        />
                        <span>{item}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>
                <div className="generation-switches">
                  <label className="generation-switch-row">
                    <span>
                      <strong>生成音频</strong>
                      <small>为视频同步生成声音</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={generateAudio}
                      onChange={(event) =>
                        setGenerateAudio(event.target.checked)
                      }
                    />
                    <i aria-hidden />
                  </label>
                  <label className="generation-switch-row">
                    <span>
                      <strong>保留水印</strong>
                      <small>在生成结果中保留平台标记</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={watermark}
                      onChange={(event) => setWatermark(event.target.checked)}
                    />
                    <i aria-hidden />
                  </label>
                </div>
              </>
            )}
            <div className="generation-submit-wrap">
              <button
                className="generation-test-submit"
                disabled={
                  createMutation.isPending || !prompt.trim() || !selectedOption
                }
              >
                {createMutation.isPending ? (
                  <LoaderCircle className="spinning" aria-hidden />
                ) : (
                  <Sparkles aria-hidden />
                )}
                {createMutation.isPending ? "正在上传并提交…" : "开始测试"}
              </button>
            </div>
          </form>
        </aside>
      </div>
    </section>
  );
}
