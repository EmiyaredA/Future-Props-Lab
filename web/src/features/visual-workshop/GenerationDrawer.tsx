import {
  type CSSProperties,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Image,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Music,
  Settings2,
  Sparkles,
  Upload,
  Video,
  X,
} from "lucide-react";
import {
  getFiles,
  getFolders,
  uploadManagedFile,
  type ManagedFile,
  type MediaKind,
} from "@features/files/api";
import {
  createGenerationTask,
  getGenerationOptions,
  type GenerationTaskInput,
} from "@features/visual-workshop/api";
import { ApiError, fetchApiBlob } from "@platform/api/client";
import { CustomSelect, type SelectOption } from "@shared/ui/CustomSelect";

type GenerationKind = "image" | "video";
type VideoMode = "text" | "image" | "frames" | "reference";

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.problem.detail || error.message;
  return error instanceof Error ? error.message : "创建任务失败，请稍后重试。";
}

const MEDIA_ACCEPT: Record<"image" | "video" | "audio", string> = {
  image: "image/jpeg,image/png,image/webp,image/gif",
  video: "video/mp4,video/webm,video/quicktime",
  audio: "audio/mpeg,audio/wav,audio/mp4,audio/ogg",
};

const VIDEO_RATIO_OPTIONS: SelectOption[] = [
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "1:1",
].map((value) => ({ value, label: value }));
const VIDEO_RESOLUTION_OPTIONS: SelectOption[] = ["480p", "720p", "1080p"].map(
  (value) => ({ value, label: value.toUpperCase() }),
);
const IMAGE_RATIO_OPTIONS = [
  { label: "1:1", width: 1, height: 1 },
  { label: "2:3", width: 2, height: 3 },
  { label: "3:2", width: 3, height: 2 },
  { label: "3:4", width: 3, height: 4 },
  { label: "4:3", width: 4, height: 3 },
  { label: "4:5", width: 4, height: 5 },
  { label: "5:4", width: 5, height: 4 },
  { label: "9:16", width: 9, height: 16 },
  { label: "16:9", width: 16, height: 9 },
  { label: "21:9", width: 21, height: 9 },
] as const;
const IMAGE_CLARITY_OPTIONS = ["1K", "2K", "4K"] as const;

type ImageRatio = (typeof IMAGE_RATIO_OPTIONS)[number]["label"];
type ImageClarity = (typeof IMAGE_CLARITY_OPTIONS)[number];
type ImageSizeChoice = {
  value: string;
  width: number;
  height: number;
  ratio: ImageRatio;
  clarity: ImageClarity;
};

function classifyImageRatio(width: number, height: number): ImageRatio {
  const ratio = width / height;
  return IMAGE_RATIO_OPTIONS.reduce((nearest, option) =>
    Math.abs(Math.log(ratio / (option.width / option.height))) <
    Math.abs(Math.log(ratio / (nearest.width / nearest.height)))
      ? option
      : nearest,
  ).label;
}

function classifyImageClarity(width: number, height: number): ImageClarity {
  const longEdge = Math.max(width, height);
  if (longEdge < 2048) return "1K";
  if (longEdge < 3328) return "2K";
  return "4K";
}

function imageSizeChoices(sizes: string[]): ImageSizeChoice[] {
  return sizes.flatMap((value) => {
    const match = /^(\d+)x(\d+)$/.exec(value);
    if (!match) return [];
    const width = Number(match[1]);
    const height = Number(match[2]);
    return [
      {
        value,
        width,
        height,
        ratio: classifyImageRatio(width, height),
        clarity: classifyImageClarity(width, height),
      },
    ];
  });
}

function imageRatioIconStyle(
  option: (typeof IMAGE_RATIO_OPTIONS)[number],
): CSSProperties {
  const ratio = option.width / option.height;
  return ratio >= 1
    ? { width: 32, height: Math.max(12, 32 / ratio) }
    : { width: Math.max(12, 32 * ratio), height: 32 };
}

function MediaPreview({ file }: { file: ManagedFile }) {
  const [source, setSource] = useState("");
  useEffect(() => {
    if (file.media_kind === "audio") return;
    let active = true;
    let objectUrl = "";
    void fetchApiBlob(`/v1/files/${file.id}/content`)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, file.media_kind]);
  if (file.media_kind === "image" && source) return <img src={source} alt="" />;
  if (file.media_kind === "video" && source)
    return <video src={source} muted preload="metadata" aria-hidden />;
  const Icon =
    file.media_kind === "video"
      ? Video
      : file.media_kind === "audio"
        ? Music
        : Image;
  return <Icon aria-hidden />;
}

function ProjectMediaPicker({
  projectId,
  label,
  kind = "image",
  value,
  multiple = false,
  max = 1,
  minimal = false,
  onChange,
}: {
  projectId: string;
  label: string;
  kind?: Extract<MediaKind, "image" | "video" | "audio">;
  value: string[];
  multiple?: boolean;
  max?: number;
  minimal?: boolean;
  onChange: (value: string[]) => void;
}) {
  const client = useQueryClient();
  const uploadInput = useRef<HTMLInputElement>(null);
  const folders = useQuery({
    queryKey: ["file-folders", projectId],
    queryFn: () => getFolders(projectId),
  });
  const folderIds = useMemo(
    () => [undefined, ...(folders.data?.items.map((item) => item.id) ?? [])],
    [folders.data],
  );
  const fileQueries = useQueries({
    queries: folderIds.map((folderId) => ({
      queryKey: ["files", projectId, folderId ?? "root", kind, true],
      queryFn: () =>
        getFiles({
          projectId,
          folderId,
          mediaKind: kind,
          includeReferences: true,
        }),
      enabled: !folders.isLoading,
    })),
  });
  const files = useMemo(() => {
    const unique = new Map<string, ManagedFile>();
    fileQueries.forEach((query) =>
      query.data?.items.forEach((file) => unique.set(file.id, file)),
    );
    return [...unique.values()].sort((left, right) =>
      left.display_name.localeCompare(right.display_name, "zh-CN"),
    );
  }, [fileQueries]);
  const upload = useMutation({
    mutationFn: async (selected: File[]) => {
      const uploaded: ManagedFile[] = [];
      for (const file of selected)
        uploaded.push(await uploadManagedFile(file, projectId));
      return uploaded;
    },
    onSuccess: (uploaded) => {
      void client.invalidateQueries({ queryKey: ["files", projectId] });
      const ids = uploaded
        .filter((file) => file.media_kind === kind)
        .map((file) => file.id);
      onChange(
        multiple
          ? [...new Set([...value, ...ids])].slice(0, max)
          : ids.slice(-1),
      );
    },
  });
  const loading =
    folders.isLoading || fileQueries.some((query) => query.isLoading);
  const visibleFiles = minimal
    ? files.filter((file) => value.includes(file.id))
    : files;
  const UploadIcon =
    kind === "video" ? Video : kind === "audio" ? Music : Image;
  const uploadButton = (
    <button
      type="button"
      className="generation-media-upload"
      aria-label={`上传${label}`}
      title={`上传${label}`}
      disabled={upload.isPending || (multiple && value.length >= max)}
      onClick={() => uploadInput.current?.click()}
    >
      {upload.isPending ? (
        <LoaderCircle className="spinning" aria-hidden />
      ) : minimal ? (
        <UploadIcon aria-hidden />
      ) : (
        <Upload aria-hidden />
      )}
      <span className={minimal ? "sr-only" : undefined}>
        {upload.isPending ? "上传中" : "上传"}
      </span>
    </button>
  );

  return (
    <fieldset
      className={`generation-image-picker${minimal ? " is-minimal" : ""}`}
    >
      <legend className={minimal ? "sr-only" : undefined}>{label}</legend>
      <input
        ref={uploadInput}
        hidden
        type="file"
        multiple={multiple}
        accept={MEDIA_ACCEPT[kind]}
        onChange={(event) => {
          const remaining = Math.max(0, max - (multiple ? value.length : 0));
          const selected = [...(event.target.files ?? [])].slice(
            0,
            multiple ? remaining : 1,
          );
          if (selected.length) upload.mutate(selected);
          event.currentTarget.value = "";
        }}
      />
      {loading ? (
        <span className="generation-picker-state">
          <LoaderCircle className="spinning" aria-hidden />
          {minimal ? null : "正在读取项目素材…"}
        </span>
      ) : (
        <div className="generation-image-options">
          {minimal ? null : uploadButton}
          {visibleFiles.map((file) => {
            const selected = value.includes(file.id);
            return (
              <button
                type="button"
                className={selected ? "selected" : ""}
                aria-pressed={selected}
                aria-label={file.display_name}
                title={file.display_name}
                key={file.id}
                onClick={() => {
                  if (!multiple) {
                    onChange(selected ? [] : [file.id]);
                    return;
                  }
                  if (selected)
                    onChange(value.filter((item) => item !== file.id));
                  else if (value.length < max) onChange([...value, file.id]);
                }}
              >
                <span className="generation-media-preview">
                  <MediaPreview file={file} />
                </span>
                {minimal ? null : <span>{file.display_name}</span>}
                {!minimal && selected ? <Check aria-hidden /> : null}
              </button>
            );
          })}
          {minimal ? uploadButton : null}
        </div>
      )}
      {multiple && !minimal ? (
        <small>
          已选 {value.length}/{max}
        </small>
      ) : null}
      {upload.isError ? (
        <small className="generation-picker-error" role="alert">
          {errorMessage(upload.error)}
        </small>
      ) : null}
    </fieldset>
  );
}

export function GenerationDrawer({
  projectId,
  onClose,
  lockedKind,
  onTaskCreated,
  compact = false,
}: {
  projectId: string;
  onClose: () => void;
  lockedKind?: GenerationKind;
  onTaskCreated?: (
    task: Awaited<ReturnType<typeof createGenerationTask>>,
  ) => void;
  compact?: boolean;
}) {
  const client = useQueryClient();
  const [kind, setKind] = useState<GenerationKind>(lockedKind ?? "image");
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [seed, setSeed] = useState("");
  const [imageCount, setImageCount] = useState(1);
  const [imageReference, setImageReference] = useState<string[]>([]);
  const [videoMode, setVideoMode] = useState<VideoMode>("text");
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState<"480p" | "720p" | "1080p">(
    "720p",
  );
  const [ratio, setRatio] = useState<"16:9" | "9:16" | "4:3" | "3:4" | "1:1">(
    "16:9",
  );
  const [watermark, setWatermark] = useState(true);
  const [generateAudio, setGenerateAudio] = useState(false);
  const [firstFrame, setFirstFrame] = useState<string[]>([]);
  const [lastFrame, setLastFrame] = useState<string[]>([]);
  const [references, setReferences] = useState<string[]>([]);
  const [audioReferences, setAudioReferences] = useState<string[]>([]);
  const [videoReferences, setVideoReferences] = useState<string[]>([]);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [notice, setNotice] = useState("");
  const modelMenuRef = useRef<HTMLDetailsElement>(null);
  const options = useQuery({
    queryKey: ["visual-generation-options"],
    queryFn: getGenerationOptions,
  });
  const models = (options.data?.models ?? []).filter(
    (model) => model.kind === kind,
  );
  const selectedModel = models.find((model) => model.id === modelId);
  const availableImageSizes = useMemo(
    () => imageSizeChoices(selectedModel?.sizes ?? []),
    [selectedModel?.sizes],
  );
  const selectedImageSize =
    availableImageSizes.find((option) => option.value === size) ??
    availableImageSizes[0];

  useEffect(() => {
    const preferred = models.find((model) =>
      kind === "image"
        ? model.slug === "senseaudio-image-2.0-260319"
        : model.slug === "doubao-seedance-2-0-260128",
    );
    if (!models.some((model) => model.id === modelId))
      setModelId(preferred?.id ?? models[0]?.id ?? "");
  }, [kind, modelId, models]);
  useEffect(() => {
    if (
      kind === "image" &&
      selectedModel?.sizes?.length &&
      !selectedModel.sizes.includes(size)
    )
      setSize(
        selectedModel.sizes.includes("1024x1024")
          ? "1024x1024"
          : selectedModel.sizes[0],
      );
  }, [kind, selectedModel, size]);

  const createMutation = useMutation({
    mutationFn: async ({
      body,
      count = 1,
    }: {
      body: GenerationTaskInput;
      count?: number;
    }) => {
      const tasks = [];
      for (let index = 0; index < count; index += 1) {
        tasks.push(await createGenerationTask(projectId, body));
      }
      return tasks;
    },
    onSuccess: (tasks) => {
      const task = tasks[0];
      if (!task) return;
      setNotice(
        tasks.length === 1
          ? `任务已提交（${task.id.slice(0, 8)}），可在“生成任务”页查看进度。`
          : `已提交 ${tasks.length} 个生成任务，第一个结果将自动绑定当前节点。`,
      );
      void client.invalidateQueries({ queryKey: ["visual-generation-tasks"] });
      onTaskCreated?.(task);
    },
    onError: (error) => setNotice(errorMessage(error)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice("");
    if (!modelId) {
      setNotice("请先在模型服务中启用对应的 SenseAudio 供应商和模型。");
      return;
    }
    if (
      kind === "video" &&
      videoMode === "reference" &&
      audioReferences.length > 0 &&
      references.length === 0 &&
      videoReferences.length === 0
    ) {
      setNotice("参考音频需要搭配至少一张图片或一个视频。");
      return;
    }
    if (kind === "image") {
      createMutation.mutate({
        body: {
          kind: "image",
          model_id: modelId,
          prompt,
          size,
          seed: seed === "" ? null : Number(seed),
          reference_asset_id: imageReference[0] ?? null,
        },
        count: imageCount,
      });
      return;
    }
    createMutation.mutate({
      body: {
        kind: "video",
        model_id: modelId,
        prompt,
        mode: videoMode === "image" ? "frames" : videoMode,
        duration,
        resolution,
        ratio,
        watermark,
        generate_audio: generateAudio,
        first_frame_asset_id:
          videoMode === "frames" || videoMode === "image"
            ? (firstFrame[0] ?? null)
            : null,
        last_frame_asset_id:
          videoMode === "frames" ? (lastFrame[0] ?? null) : null,
        reference_asset_ids: videoMode === "reference" ? references : [],
        audio_asset_ids: videoMode === "reference" ? audioReferences : [],
        video_asset_ids: videoMode === "reference" ? videoReferences : [],
      },
    });
  };

  if (compact && lockedKind === "image") {
    return (
      <aside
        className={`canvas-generation-drawer is-compact image-node-composer${composerExpanded ? " is-expanded" : ""}`}
        aria-label="节点 AI 生成"
      >
        <form className="video-node-composer-form" onSubmit={submit}>
          <div className="image-composer-body">
            <div className="image-composer-tools">
              <ProjectMediaPicker
                projectId={projectId}
                label="参考图片（可选）"
                minimal
                value={imageReference}
                onChange={setImageReference}
              />
              <button
                type="button"
                className="video-composer-close"
                aria-label={
                  composerExpanded ? "收起图片生成器" : "展开图片生成器"
                }
                title={composerExpanded ? "收起" : "展开"}
                onClick={() => setComposerExpanded((current) => !current)}
              >
                {composerExpanded ? (
                  <Minimize2 aria-hidden />
                ) : (
                  <Maximize2 aria-hidden />
                )}
              </button>
            </div>
            <label className="video-composer-prompt image-composer-prompt">
              <span className="sr-only">图片提示词</span>
              <textarea
                required
                maxLength={6000}
                placeholder="描述你想生成的画面…"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
              <small>{prompt.length}/6000</small>
            </label>
          </div>

          {notice ? (
            <div
              className="generation-notice video-composer-notice"
              role="status"
            >
              {notice}
            </div>
          ) : null}

          <footer className="video-composer-footer image-composer-footer">
            <span className="video-composer-kind">
              <Image aria-hidden />
              图片生成
            </span>
            <details
              className="video-composer-model"
              ref={modelMenuRef}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  event.currentTarget.removeAttribute("open");
              }}
            >
              <summary
                role="button"
                aria-label="生成模型"
                aria-disabled={options.isLoading || models.length === 0}
                onClick={(event) => {
                  if (options.isLoading || models.length === 0)
                    event.preventDefault();
                }}
              >
                <span>{selectedModel?.label ?? "暂无可用模型"}</span>
                <ChevronDown aria-hidden />
              </summary>
              <div className="video-model-menu" role="listbox">
                {models.map((model) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={model.id === modelId}
                    key={model.id}
                    onClick={() => {
                      setModelId(model.id);
                      modelMenuRef.current?.removeAttribute("open");
                    }}
                  >
                    {model.id === modelId ? <Check aria-hidden /> : <span />}
                    {model.label}
                  </button>
                ))}
              </div>
            </details>
            <details className="video-composer-parameters image-composer-parameters">
              <summary role="button" aria-label="图片参数">
                <span
                  className="image-parameter-summary-icon"
                  aria-hidden="true"
                />
                {selectedImageSize
                  ? `${selectedImageSize.ratio} / ${selectedImageSize.clarity}`
                  : "选择尺寸"}
                <ChevronDown aria-hidden />
              </summary>
              <div className="image-parameter-popover">
                <fieldset className="image-ratio-options">
                  <legend>比例</legend>
                  <div role="group" aria-label="图片比例">
                    {IMAGE_RATIO_OPTIONS.map((option) => {
                      const choices = availableImageSizes.filter(
                        (choice) => choice.ratio === option.label,
                      );
                      const available = choices.length > 0;
                      const selected =
                        selectedImageSize?.ratio === option.label;
                      return (
                        <button
                          type="button"
                          aria-label={`比例 ${option.label}`}
                          aria-pressed={selected}
                          disabled={!available}
                          key={option.label}
                          onClick={() => {
                            const next =
                              choices.find(
                                (choice) =>
                                  choice.clarity === selectedImageSize?.clarity,
                              ) ?? choices[0];
                            if (next) setSize(next.value);
                          }}
                        >
                          <span className="image-ratio-icon-shell">
                            <span style={imageRatioIconStyle(option)} />
                          </span>
                          <span>{option.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                <fieldset className="image-clarity-options">
                  <legend>清晰度</legend>
                  <div role="group" aria-label="图片清晰度">
                    {IMAGE_CLARITY_OPTIONS.map((clarity) => {
                      const next = availableImageSizes.find(
                        (choice) =>
                          choice.ratio === selectedImageSize?.ratio &&
                          choice.clarity === clarity,
                      );
                      return (
                        <button
                          type="button"
                          aria-label={`清晰度 ${clarity}`}
                          aria-pressed={selectedImageSize?.clarity === clarity}
                          disabled={!next}
                          key={clarity}
                          onClick={() => {
                            if (next) setSize(next.value);
                          }}
                        >
                          {clarity}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                <label className="image-seed-control">
                  <span>种子（可选）</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="随机"
                    value={seed}
                    onChange={(event) => setSeed(event.target.value)}
                  />
                </label>
              </div>
            </details>
            <details className="image-composer-count">
              <summary role="button" aria-label="生成数量">
                ×{imageCount}
                <ChevronDown aria-hidden />
              </summary>
              <div role="listbox" aria-label="选择生成数量">
                {[1, 2, 3, 4].map((count) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={imageCount === count}
                    key={count}
                    onClick={(event) => {
                      setImageCount(count);
                      event.currentTarget
                        .closest("details")
                        ?.removeAttribute("open");
                    }}
                  >
                    ×{count}
                    {imageCount === count ? <Check aria-hidden /> : null}
                  </button>
                ))}
              </div>
            </details>
            <button
              className="video-composer-submit"
              disabled={createMutation.isPending || !modelId || !prompt.trim()}
              type="submit"
              aria-label={createMutation.isPending ? "正在提交" : "生成图片"}
            >
              {createMutation.isPending ? (
                <LoaderCircle className="spinning" aria-hidden />
              ) : (
                <ArrowUp aria-hidden />
              )}
            </button>
          </footer>
        </form>
      </aside>
    );
  }

  if (compact && lockedKind === "video") {
    const modeLabels: Array<{ value: VideoMode; label: string }> = [
      { value: "text", label: "文生视频" },
      { value: "image", label: "图生视频" },
      { value: "frames", label: "首尾帧" },
      { value: "reference", label: "全能参考" },
    ];
    return (
      <aside
        className={`canvas-generation-drawer is-compact video-node-composer${composerExpanded ? " is-expanded" : ""}`}
        aria-label="节点 AI 生成"
      >
        <form className="video-node-composer-form" onSubmit={submit}>
          <header className="video-composer-header">
            <nav aria-label="视频生成方式">
              {modeLabels.map((mode) => (
                <button
                  type="button"
                  className={videoMode === mode.value ? "active" : ""}
                  aria-pressed={videoMode === mode.value}
                  key={mode.value}
                  onClick={() => setVideoMode(mode.value)}
                >
                  {mode.label}
                </button>
              ))}
            </nav>
            <button
              type="button"
              className="video-composer-close"
              aria-label={
                composerExpanded ? "收起视频生成器" : "展开视频生成器"
              }
              title={composerExpanded ? "收起" : "展开"}
              onClick={() => setComposerExpanded((current) => !current)}
            >
              {composerExpanded ? (
                <Minimize2 aria-hidden />
              ) : (
                <Maximize2 aria-hidden />
              )}
            </button>
          </header>

          <div className="video-composer-body">
            {videoMode !== "text" ? (
              <div className="video-composer-reference">
                {videoMode === "image" ? (
                  <ProjectMediaPicker
                    projectId={projectId}
                    label="选择起始画面"
                    minimal
                    value={firstFrame}
                    onChange={setFirstFrame}
                  />
                ) : null}
                {videoMode === "frames" ? (
                  <>
                    <ProjectMediaPicker
                      projectId={projectId}
                      label="首帧"
                      minimal
                      value={firstFrame}
                      onChange={setFirstFrame}
                    />
                    <ProjectMediaPicker
                      projectId={projectId}
                      label="尾帧（可选）"
                      minimal
                      value={lastFrame}
                      onChange={setLastFrame}
                    />
                  </>
                ) : null}
                {videoMode === "reference" ? (
                  <>
                    <ProjectMediaPicker
                      projectId={projectId}
                      label="参考图片"
                      minimal
                      value={references}
                      multiple
                      max={9}
                      onChange={setReferences}
                    />
                    <ProjectMediaPicker
                      projectId={projectId}
                      label="参考视频"
                      kind="video"
                      minimal
                      value={videoReferences}
                      multiple
                      max={3}
                      onChange={setVideoReferences}
                    />
                    <ProjectMediaPicker
                      projectId={projectId}
                      label="参考音频"
                      kind="audio"
                      minimal
                      value={audioReferences}
                      multiple
                      max={3}
                      onChange={setAudioReferences}
                    />
                  </>
                ) : null}
              </div>
            ) : null}
            <label className="video-composer-prompt">
              <span className="sr-only">视频提示词</span>
              <textarea
                required={videoMode === "text"}
                maxLength={6000}
                placeholder="描述您的修改或生成需求…"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
              <small>{prompt.length}/6000</small>
            </label>
          </div>

          {notice ? (
            <div
              className="generation-notice video-composer-notice"
              role="status"
            >
              {notice}
            </div>
          ) : null}

          <footer className="video-composer-footer">
            <span className="video-composer-kind">
              <Video aria-hidden />
              视频生成
            </span>
            <details
              className="video-composer-model"
              ref={modelMenuRef}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  event.currentTarget.removeAttribute("open");
              }}
            >
              <summary
                role="button"
                aria-label="生成模型"
                aria-disabled={options.isLoading || models.length === 0}
                onClick={(event) => {
                  if (options.isLoading || models.length === 0)
                    event.preventDefault();
                }}
              >
                <span>{selectedModel?.label ?? "暂无可用模型"}</span>
                <ChevronDown aria-hidden />
              </summary>
              <div className="video-model-menu" role="listbox">
                {models.map((model) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={model.id === modelId}
                    key={model.id}
                    onClick={() => {
                      setModelId(model.id);
                      modelMenuRef.current?.removeAttribute("open");
                    }}
                  >
                    {model.id === modelId ? <Check aria-hidden /> : <span />}
                    {model.label}
                  </button>
                ))}
              </div>
            </details>
            <details className="video-composer-parameters">
              <summary>
                <Settings2 aria-hidden />
                {ratio} · {duration}S · {resolution.toUpperCase()}
                <ChevronDown aria-hidden />
              </summary>
              <div className="video-parameter-popover">
                <label className="video-duration-control">
                  <span className="video-duration-head">
                    <span>时长</span>
                    <output>{duration} 秒</output>
                  </span>
                  <input
                    type="range"
                    aria-label="时长"
                    min="4"
                    max="15"
                    step="1"
                    value={duration}
                    style={
                      {
                        "--video-duration-progress": `${((duration - 4) / 11) * 100}%`,
                      } as CSSProperties
                    }
                    onChange={(event) =>
                      setDuration(Number(event.target.value))
                    }
                  />
                  <span className="video-duration-limits" aria-hidden="true">
                    <span>4 秒</span>
                    <span>15 秒</span>
                  </span>
                </label>
                <label>
                  <span>画面比例</span>
                  <CustomSelect
                    ariaLabel="画面比例"
                    className="video-parameter-select"
                    value={ratio}
                    options={VIDEO_RATIO_OPTIONS}
                    onChange={(value) => setRatio(value as typeof ratio)}
                  />
                </label>
                <label>
                  <span>清晰度</span>
                  <CustomSelect
                    ariaLabel="清晰度"
                    className="video-parameter-select"
                    value={resolution}
                    options={VIDEO_RESOLUTION_OPTIONS}
                    onChange={(value) =>
                      setResolution(value as typeof resolution)
                    }
                  />
                </label>
                <div className="video-parameter-switches">
                  <label>
                    <input
                      type="checkbox"
                      checked={generateAudio}
                      onChange={(event) =>
                        setGenerateAudio(event.target.checked)
                      }
                    />
                    生成音频
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={watermark}
                      onChange={(event) => setWatermark(event.target.checked)}
                    />
                    保留水印
                  </label>
                </div>
              </div>
            </details>
            <button
              className="video-composer-submit"
              disabled={createMutation.isPending || !modelId}
              type="submit"
              aria-label={createMutation.isPending ? "正在提交" : "生成视频"}
            >
              {createMutation.isPending ? (
                <LoaderCircle className="spinning" aria-hidden />
              ) : (
                <ArrowUp aria-hidden />
              )}
            </button>
          </footer>
        </form>
      </aside>
    );
  }

  return (
    <aside
      className={`canvas-generation-drawer${compact ? " is-compact" : ""}`}
      aria-label={lockedKind ? "节点 AI 生成" : "AI 生成"}
    >
      <header>
        <div>
          <strong>AI 生成</strong>
          <small>由 SenseAudio 异步生成，完成后自动进入素材库</small>
        </div>
        <button aria-label="关闭 AI 生成" onClick={onClose}>
          <X aria-hidden />
        </button>
      </header>
      {!lockedKind ? (
        <div className="generation-kind-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={kind === "image"}
            className={kind === "image" ? "active" : ""}
            onClick={() => setKind("image")}
          >
            <Image aria-hidden /> 图片
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === "video"}
            className={kind === "video" ? "active" : ""}
            onClick={() => setKind("video")}
          >
            <Video aria-hidden /> 视频
          </button>
        </div>
      ) : null}
      <form className="generation-form" onSubmit={submit}>
        <label>
          <span>模型</span>
          <select
            aria-label="生成模型"
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            disabled={options.isLoading}
          >
            {!models.length ? <option value="">暂无可用模型</option> : null}
            {models.map((model) => (
              <option value={model.id} key={model.id}>
                {model.label}
              </option>
            ))}
          </select>
          {selectedModel?.description ? (
            <small>{selectedModel.description}</small>
          ) : null}
        </label>
        <label>
          <span>提示词</span>
          <textarea
            required={kind === "image" || videoMode === "text"}
            maxLength={6000}
            rows={5}
            placeholder={
              kind === "image" ? "描述要生成的画面…" : "描述镜头、动作和氛围…"
            }
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        {kind === "image" ? (
          <>
            <div className="generation-form-grid">
              <label>
                <span>尺寸</span>
                <select
                  value={size}
                  onChange={(event) => setSize(event.target.value)}
                >
                  {(selectedModel?.sizes ?? []).map((option) => (
                    <option value={option} key={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>种子（可选）</span>
                <input
                  type="number"
                  min="0"
                  placeholder="随机"
                  value={seed}
                  onChange={(event) => setSeed(event.target.value)}
                />
              </label>
            </div>
            <ProjectMediaPicker
              projectId={projectId}
              label="参考图片（可选）"
              value={imageReference}
              onChange={setImageReference}
            />
          </>
        ) : (
          <>
            <div className="generation-form-grid generation-form-grid-three">
              <label>
                <span>时长</span>
                <select
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                >
                  {Array.from({ length: 12 }, (_, index) => index + 4).map(
                    (value) => (
                      <option value={value} key={value}>
                        {value} 秒
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                <span>分辨率</span>
                <select
                  value={resolution}
                  onChange={(event) =>
                    setResolution(event.target.value as typeof resolution)
                  }
                >
                  <option value="480p">480p</option>
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </select>
              </label>
              <label>
                <span>比例</span>
                <select
                  value={ratio}
                  onChange={(event) =>
                    setRatio(event.target.value as typeof ratio)
                  }
                >
                  {(["16:9", "9:16", "4:3", "3:4", "1:1"] as const).map(
                    (value) => (
                      <option value={value} key={value}>
                        {value}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </div>
            <fieldset className="generation-mode-options">
              <legend>输入方式</legend>
              {(["text", "image", "frames", "reference"] as const).map(
                (value) => (
                  <button
                    type="button"
                    className={videoMode === value ? "selected" : ""}
                    aria-pressed={videoMode === value}
                    key={value}
                    onClick={() => setVideoMode(value)}
                  >
                    {value === "text"
                      ? "纯文本"
                      : value === "image"
                        ? "图生视频"
                        : value === "frames"
                          ? "首尾帧"
                          : "参考素材"}
                  </button>
                ),
              )}
            </fieldset>
            {videoMode === "image" ? (
              <ProjectMediaPicker
                projectId={projectId}
                label="起始画面（必选）"
                value={firstFrame}
                onChange={setFirstFrame}
              />
            ) : null}
            {videoMode === "frames" ? (
              <>
                <ProjectMediaPicker
                  projectId={projectId}
                  label="首帧（必选）"
                  value={firstFrame}
                  onChange={setFirstFrame}
                />
                <ProjectMediaPicker
                  projectId={projectId}
                  label="尾帧（可选）"
                  value={lastFrame}
                  onChange={setLastFrame}
                />
              </>
            ) : null}
            {videoMode === "reference" ? (
              <>
                <ProjectMediaPicker
                  projectId={projectId}
                  label="参考图片"
                  value={references}
                  multiple
                  max={9}
                  onChange={setReferences}
                />
                <ProjectMediaPicker
                  projectId={projectId}
                  label="参考视频"
                  kind="video"
                  value={videoReferences}
                  multiple
                  max={3}
                  onChange={setVideoReferences}
                />
                <ProjectMediaPicker
                  projectId={projectId}
                  label="参考音频"
                  kind="audio"
                  value={audioReferences}
                  multiple
                  max={3}
                  onChange={setAudioReferences}
                />
              </>
            ) : null}
            <div className="generation-switches">
              <label>
                <input
                  type="checkbox"
                  checked={watermark}
                  onChange={(event) => setWatermark(event.target.checked)}
                />{" "}
                保留水印
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={generateAudio}
                  onChange={(event) => setGenerateAudio(event.target.checked)}
                />{" "}
                生成音频
              </label>
            </div>
          </>
        )}
        {notice ? (
          <div className="generation-notice" role="status">
            {notice}
          </div>
        ) : null}
        <button
          className="generation-submit"
          disabled={createMutation.isPending || !modelId}
          type="submit"
        >
          {createMutation.isPending ? (
            <LoaderCircle className="spinning" aria-hidden />
          ) : (
            <Sparkles aria-hidden />
          )}
          {createMutation.isPending ? "正在提交…" : "创建生成任务"}
        </button>
      </form>
    </aside>
  );
}
