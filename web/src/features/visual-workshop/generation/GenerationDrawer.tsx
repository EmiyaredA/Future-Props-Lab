import {
  type CSSProperties,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Image,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Settings2,
  Sparkles,
  Video,
  X,
} from "lucide-react";
import type { ManagedFile } from "@features/files";
import {
  createGenerationTask,
  getGenerationOptions,
  type GenerationTaskInput,
  type VisualCanvasGenerationDraft,
  type VisualCanvasImageGenerationDraft,
  type VisualCanvasVideoGenerationDraft,
} from "@features/visual-workshop/api";
import { apiErrorMessage } from "@platform/api/errors";
import { CustomSelect } from "@shared/ui/CustomSelect";
import {
  IMAGE_CLARITY_OPTIONS,
  IMAGE_RATIO_OPTIONS,
  VIDEO_RATIO_OPTIONS,
  VIDEO_RESOLUTION_OPTIONS,
  imageRatioIconStyle,
  imageSizeChoices,
  type GenerationKind,
  type VideoMode,
} from "@features/visual-workshop/generation/options";
import { GenerationPromptEditor } from "@features/visual-workshop/generation/GenerationPromptEditor";
import { visualWorkshopQueryKeys as visualKeys } from "@features/visual-workshop/queryKeys";
import { ProjectMediaPicker } from "@features/visual-workshop/generation/ProjectMediaPicker";

function errorMessage(error: unknown) {
  return apiErrorMessage(error, "创建任务失败，请稍后重试。");
}

export function GenerationDrawer({
  projectId,
  onClose,
  lockedKind,
  draft,
  onDraftChange,
  onBeforeSubmit,
  onTaskCreated,
  compact = false,
  canvasNodeId,
}: {
  projectId: string;
  onClose: () => void;
  lockedKind?: GenerationKind;
  draft?: VisualCanvasGenerationDraft | null;
  onDraftChange?: (
    draft: VisualCanvasGenerationDraft,
    immediate?: boolean,
  ) => void;
  onBeforeSubmit?: () => Promise<number | void>;
  onTaskCreated?: (
    task: Awaited<ReturnType<typeof createGenerationTask>>,
  ) => void | Promise<void>;
  compact?: boolean;
  canvasNodeId?: string;
}) {
  const client = useQueryClient();
  const imageDraft =
    lockedKind === "image"
      ? (draft as VisualCanvasImageGenerationDraft | null | undefined)
      : undefined;
  const videoDraft =
    lockedKind === "video"
      ? (draft as VisualCanvasVideoGenerationDraft | null | undefined)
      : undefined;
  const [kind, setKind] = useState<GenerationKind>(lockedKind ?? "image");
  const [modelId, setModelId] = useState(
    imageDraft?.model_id ?? videoDraft?.model_id ?? "",
  );
  const [prompt, setPrompt] = useState(
    imageDraft?.prompt ?? videoDraft?.prompt ?? "",
  );
  const [size, setSize] = useState(imageDraft?.size ?? "1024x1024");
  const [seed, setSeed] = useState(
    imageDraft?.seed == null ? "" : String(imageDraft.seed),
  );
  const [imageCount, setImageCount] = useState(imageDraft?.image_count ?? 1);
  const [imageReference, setImageReference] = useState<string[]>(
    imageDraft?.reference_asset_id ? [imageDraft.reference_asset_id] : [],
  );
  const [videoMode, setVideoMode] = useState<VideoMode>(
    videoDraft?.mode ?? "text",
  );
  const [duration, setDuration] = useState(videoDraft?.duration ?? 5);
  const [resolution, setResolution] = useState<"480p" | "720p" | "1080p">(
    videoDraft?.resolution ?? "720p",
  );
  const [ratio, setRatio] = useState<"16:9" | "9:16" | "4:3" | "3:4" | "1:1">(
    videoDraft?.ratio ?? "16:9",
  );
  const [watermark, setWatermark] = useState(videoDraft?.watermark ?? true);
  const [generateAudio, setGenerateAudio] = useState(
    videoDraft?.generate_audio ?? false,
  );
  const [firstFrame, setFirstFrame] = useState<string[]>(
    videoDraft?.first_frame_asset_id ? [videoDraft.first_frame_asset_id] : [],
  );
  const [lastFrame, setLastFrame] = useState<string[]>(
    videoDraft?.last_frame_asset_id ? [videoDraft.last_frame_asset_id] : [],
  );
  const [references, setReferences] = useState<string[]>(
    videoDraft?.reference_asset_ids ?? [],
  );
  const [audioReferences, setAudioReferences] = useState<string[]>(
    videoDraft?.audio_asset_ids ?? [],
  );
  const [videoReferences, setVideoReferences] = useState<string[]>(
    videoDraft?.video_asset_ids ?? [],
  );
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [notice, setNotice] = useState("");
  const [promptFiles, setPromptFiles] = useState<Record<string, ManagedFile>>(
    {},
  );
  const modelMenuRef = useRef<HTMLDetailsElement>(null);
  const rememberPromptFiles = useCallback((files: ManagedFile[]) => {
    setPromptFiles((current) => {
      let changed = false;
      const next = { ...current };
      files.forEach((file) => {
        if (next[file.id] !== file) {
          next[file.id] = file;
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, []);
  const selectedPromptAssetIds = useMemo(() => {
    if (kind === "image") return imageReference;
    if (videoMode === "image") return firstFrame;
    if (videoMode === "frames") return [...firstFrame, ...lastFrame];
    if (videoMode === "reference")
      return [...references, ...videoReferences, ...audioReferences];
    return [];
  }, [
    audioReferences,
    firstFrame,
    imageReference,
    kind,
    lastFrame,
    references,
    videoMode,
    videoReferences,
  ]);
  const promptAssets = useMemo(() => {
    const byId = new Map(
      Object.values(promptFiles).map((file) => [file.id, file]),
    );
    selectedPromptAssetIds.forEach((id) => {
      const file = promptFiles[id];
      if (file) byId.set(id, file);
    });
    return [...byId.values()];
  }, [promptFiles, selectedPromptAssetIds]);
  const options = useQuery({
    queryKey: visualKeys.generationOptions,
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
  const persistDraft = useCallback(
    (changes: Record<string, unknown> = {}, immediate = false) => {
      if (!lockedKind || !onDraftChange) return;
      const parsedSeed = Number(seed);
      if (lockedKind === "image") {
        onDraftChange(
          {
            model_id: modelId || null,
            prompt,
            size,
            seed:
              seed !== "" && Number.isSafeInteger(parsedSeed) && parsedSeed >= 0
                ? parsedSeed
                : null,
            image_count: imageCount,
            reference_asset_id: imageReference[0] ?? null,
            ...changes,
          } as VisualCanvasImageGenerationDraft,
          immediate,
        );
        return;
      }
      onDraftChange(
        {
          model_id: modelId || null,
          prompt,
          mode: videoMode,
          duration,
          resolution,
          ratio,
          watermark,
          generate_audio: generateAudio,
          first_frame_asset_id: firstFrame[0] ?? null,
          last_frame_asset_id: lastFrame[0] ?? null,
          reference_asset_ids: references,
          audio_asset_ids: audioReferences,
          video_asset_ids: videoReferences,
          ...changes,
        } as VisualCanvasVideoGenerationDraft,
        immediate,
      );
    },
    [
      audioReferences,
      duration,
      firstFrame,
      generateAudio,
      imageCount,
      imageReference,
      lastFrame,
      lockedKind,
      modelId,
      onDraftChange,
      prompt,
      ratio,
      references,
      resolution,
      seed,
      size,
      videoMode,
      videoReferences,
      watermark,
    ],
  );
  const invalidSelection = useCallback(() => {
    setNotice("部分已选择素材已失效，已从当前草稿移除。");
  }, []);

  useEffect(() => {
    const preferred = models.find((model) =>
      kind === "image"
        ? model.slug === "senseaudio-image-2.0-260319"
        : model.slug === "doubao-seedance-2-0-260128",
    );
    if (!models.some((model) => model.id === modelId)) {
      const next = preferred?.id ?? models[0]?.id ?? "";
      if (next === modelId) return;
      setModelId(next);
      persistDraft({ model_id: next || null }, true);
    }
  }, [kind, modelId, models, persistDraft]);
  useEffect(() => {
    if (
      kind === "image" &&
      selectedModel?.sizes?.length &&
      !selectedModel.sizes.includes(size)
    ) {
      const next = selectedModel.sizes.includes("1024x1024")
        ? "1024x1024"
        : selectedModel.sizes[0];
      setSize(next);
      persistDraft({ size: next }, true);
    }
  }, [kind, persistDraft, selectedModel, size]);

  const createMutation = useMutation({
    mutationFn: async ({
      body,
      count = 1,
      followupBody,
    }: {
      body: GenerationTaskInput;
      count?: number;
      followupBody?: GenerationTaskInput;
    }) => {
      const tasks = [];
      for (let index = 0; index < count; index += 1) {
        tasks.push(
          await createGenerationTask(
            projectId,
            index === 0 ? body : (followupBody ?? body),
          ),
        );
      }
      return tasks;
    },
    onSuccess: async (tasks) => {
      const task = tasks[0];
      if (!task) return;
      try {
        await onTaskCreated?.(task);
      } catch (error) {
        setNotice(`任务已提交，但节点关联保存失败：${errorMessage(error)}`);
        return;
      }
      setNotice(
        tasks.length === 1
          ? `任务已提交（${task.id.slice(0, 8)}），可在“生成任务”页查看进度。`
          : `已提交 ${tasks.length} 个生成任务，第一个结果将自动绑定当前节点。`,
      );
      void client.invalidateQueries({ queryKey: visualKeys.generationTasks });
    },
    onError: (error) => setNotice(errorMessage(error)),
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setNotice("");
    if (!modelId) {
      setNotice("请先在模型服务中启用对应的 SenseAudio 供应商和模型。");
      return;
    }
    if ((kind === "image" || videoMode === "text") && !prompt.trim()) {
      setNotice("请输入生成提示词。");
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
    try {
      persistDraft({}, true);
      const canvasRevision = await onBeforeSubmit?.();
      const canvasLink =
        canvasNodeId && typeof canvasRevision === "number"
          ? {
              canvas_node_id: canvasNodeId,
              expected_canvas_revision: canvasRevision,
            }
          : {};
      if (kind === "image") {
        const body = {
          kind: "image",
          model_id: modelId,
          prompt,
          size,
          seed: seed === "" ? null : Number(seed),
          reference_asset_id: imageReference[0] ?? null,
        } satisfies GenerationTaskInput;
        createMutation.mutate({
          body: { ...body, ...canvasLink },
          followupBody: body,
          count: imageCount,
        });
        return;
      }
      const body = {
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
      } satisfies GenerationTaskInput;
      createMutation.mutate({ body: { ...body, ...canvasLink } });
    } catch (error) {
      setNotice(errorMessage(error));
      return;
    }
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
                minimal={!composerExpanded}
                uploadLast
                value={imageReference}
                onChange={(value) => {
                  setImageReference(value);
                  persistDraft({ reference_asset_id: value[0] ?? null }, true);
                }}
                onFilesLoaded={rememberPromptFiles}
                onInvalidSelection={invalidSelection}
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
            <div className="video-composer-prompt image-composer-prompt">
              <GenerationPromptEditor
                value={prompt}
                assets={promptAssets}
                label="图片提示词"
                placeholder="描述你想生成的画面…"
                onChange={(value) => {
                  setPrompt(value);
                  persistDraft({ prompt: value });
                }}
                onBlur={() => persistDraft({}, true)}
              />
            </div>
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
                      persistDraft({ model_id: model.id }, true);
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
                            if (next) persistDraft({ size: next.value }, true);
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
                            if (next) {
                              setSize(next.value);
                              persistDraft({ size: next.value }, true);
                            }
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
                    onChange={(event) => {
                      const value = event.target.value;
                      setSeed(value);
                      const parsed = Number(value);
                      persistDraft({
                        seed:
                          value !== "" &&
                          Number.isSafeInteger(parsed) &&
                          parsed >= 0
                            ? parsed
                            : null,
                      });
                    }}
                    onBlur={() => persistDraft({}, true)}
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
                      persistDraft({ image_count: count }, true);
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
                  onClick={() => {
                    setVideoMode(mode.value);
                    persistDraft({ mode: mode.value }, true);
                  }}
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
              <div
                className="video-composer-reference"
                role="group"
                aria-label="固定参考素材"
              >
                {videoMode === "image" ? (
                  <ProjectMediaPicker
                    projectId={projectId}
                    label="选择起始画面"
                    minimal
                    value={firstFrame}
                    onChange={(value) => {
                      setFirstFrame(value);
                      persistDraft(
                        { first_frame_asset_id: value[0] ?? null },
                        true,
                      );
                    }}
                    onFilesLoaded={rememberPromptFiles}
                    onInvalidSelection={invalidSelection}
                  />
                ) : null}
                {videoMode === "frames" ? (
                  <>
                    <ProjectMediaPicker
                      projectId={projectId}
                      label="首帧"
                      minimal
                      value={firstFrame}
                      onChange={(value) => {
                        setFirstFrame(value);
                        persistDraft(
                          { first_frame_asset_id: value[0] ?? null },
                          true,
                        );
                      }}
                      onFilesLoaded={rememberPromptFiles}
                      onInvalidSelection={invalidSelection}
                    />
                    <ProjectMediaPicker
                      projectId={projectId}
                      label="尾帧（可选）"
                      minimal
                      value={lastFrame}
                      onChange={(value) => {
                        setLastFrame(value);
                        persistDraft(
                          { last_frame_asset_id: value[0] ?? null },
                          true,
                        );
                      }}
                      onFilesLoaded={rememberPromptFiles}
                      onInvalidSelection={invalidSelection}
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
                      onChange={(value) => {
                        setReferences(value);
                        persistDraft({ reference_asset_ids: value }, true);
                      }}
                      onFilesLoaded={rememberPromptFiles}
                      onInvalidSelection={invalidSelection}
                    />
                    <ProjectMediaPicker
                      projectId={projectId}
                      label="参考视频"
                      kind="video"
                      minimal
                      value={videoReferences}
                      multiple
                      max={3}
                      onChange={(value) => {
                        setVideoReferences(value);
                        persistDraft({ video_asset_ids: value }, true);
                      }}
                      onFilesLoaded={rememberPromptFiles}
                      onInvalidSelection={invalidSelection}
                    />
                    <ProjectMediaPicker
                      projectId={projectId}
                      label="参考音频"
                      kind="audio"
                      minimal
                      value={audioReferences}
                      multiple
                      max={3}
                      onChange={(value) => {
                        setAudioReferences(value);
                        persistDraft({ audio_asset_ids: value }, true);
                      }}
                      onFilesLoaded={rememberPromptFiles}
                      onInvalidSelection={invalidSelection}
                    />
                  </>
                ) : null}
              </div>
            ) : null}
            <div className="video-composer-prompt">
              <GenerationPromptEditor
                value={prompt}
                assets={promptAssets}
                label="视频提示词"
                placeholder="描述您的修改或生成需求…"
                onChange={(value) => {
                  setPrompt(value);
                  persistDraft({ prompt: value });
                }}
                onBlur={() => persistDraft({}, true)}
              />
            </div>
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
                      persistDraft({ model_id: model.id }, true);
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
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setDuration(value);
                      persistDraft({ duration: value });
                    }}
                    onPointerUp={() => persistDraft({}, true)}
                    onBlur={() => persistDraft({}, true)}
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
                    onChange={(value) => {
                      const next = value as typeof ratio;
                      setRatio(next);
                      persistDraft({ ratio: next }, true);
                    }}
                  />
                </label>
                <label>
                  <span>清晰度</span>
                  <CustomSelect
                    ariaLabel="清晰度"
                    className="video-parameter-select"
                    value={resolution}
                    options={VIDEO_RESOLUTION_OPTIONS}
                    onChange={(value) => {
                      const next = value as typeof resolution;
                      setResolution(next);
                      persistDraft({ resolution: next }, true);
                    }}
                  />
                </label>
                <div className="video-parameter-switches">
                  <label>
                    <input
                      type="checkbox"
                      checked={generateAudio}
                      onChange={(event) => {
                        setGenerateAudio(event.target.checked);
                        persistDraft(
                          { generate_audio: event.target.checked },
                          true,
                        );
                      }}
                    />
                    生成音频
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={watermark}
                      onChange={(event) => {
                        setWatermark(event.target.checked);
                        persistDraft({ watermark: event.target.checked }, true);
                      }}
                    />
                    保留水印
                  </label>
                </div>
              </div>
            </details>
            <button
              className="video-composer-submit"
              disabled={
                createMutation.isPending ||
                !modelId ||
                (videoMode === "text" && !prompt.trim())
              }
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
          <CustomSelect
            ariaLabel="生成模型"
            value={modelId}
            onChange={setModelId}
            disabled={options.isLoading}
            options={
              models.length
                ? models.map((model) => ({
                    value: model.id,
                    label: model.label,
                  }))
                : [{ value: "", label: "暂无可用模型", disabled: true }]
            }
          />
          {selectedModel?.description ? (
            <small>{selectedModel.description}</small>
          ) : null}
        </label>
        <div className="generation-form-prompt">
          <span>提示词</span>
          <GenerationPromptEditor
            value={prompt}
            assets={promptAssets}
            label={kind === "image" ? "图片提示词" : "视频提示词"}
            placeholder={
              kind === "image" ? "描述要生成的画面…" : "描述镜头、动作和氛围…"
            }
            onChange={setPrompt}
          />
        </div>
        {kind === "image" ? (
          <>
            <div className="generation-form-grid">
              <label>
                <span>尺寸</span>
                <CustomSelect
                  ariaLabel="生成尺寸"
                  value={size}
                  onChange={setSize}
                  options={(selectedModel?.sizes ?? []).map((option) => ({
                    value: option,
                    label: option,
                  }))}
                />
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
              onFilesLoaded={rememberPromptFiles}
            />
          </>
        ) : (
          <>
            <div className="generation-form-grid generation-form-grid-three">
              <label>
                <span>时长</span>
                <CustomSelect
                  ariaLabel="视频时长"
                  value={String(duration)}
                  onChange={(value) => setDuration(Number(value))}
                  options={Array.from(
                    { length: 12 },
                    (_, index) => index + 4,
                  ).map((value) => ({
                    value: String(value),
                    label: `${value} 秒`,
                  }))}
                />
              </label>
              <label>
                <span>分辨率</span>
                <CustomSelect
                  ariaLabel="视频分辨率"
                  value={resolution}
                  onChange={(value) =>
                    setResolution(value as typeof resolution)
                  }
                  options={["480p", "720p", "1080p"].map((value) => ({
                    value,
                    label: value,
                  }))}
                />
              </label>
              <label>
                <span>比例</span>
                <CustomSelect
                  ariaLabel="视频比例"
                  value={ratio}
                  onChange={(value) => setRatio(value as typeof ratio)}
                  options={(["16:9", "9:16", "4:3", "3:4", "1:1"] as const).map(
                    (value) => ({ value, label: value }),
                  )}
                />
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
                onFilesLoaded={rememberPromptFiles}
              />
            ) : null}
            {videoMode === "frames" ? (
              <>
                <ProjectMediaPicker
                  projectId={projectId}
                  label="首帧（必选）"
                  value={firstFrame}
                  onChange={setFirstFrame}
                  onFilesLoaded={rememberPromptFiles}
                />
                <ProjectMediaPicker
                  projectId={projectId}
                  label="尾帧（可选）"
                  value={lastFrame}
                  onChange={setLastFrame}
                  onFilesLoaded={rememberPromptFiles}
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
                  onFilesLoaded={rememberPromptFiles}
                />
                <ProjectMediaPicker
                  projectId={projectId}
                  label="参考视频"
                  kind="video"
                  value={videoReferences}
                  multiple
                  max={3}
                  onChange={setVideoReferences}
                  onFilesLoaded={rememberPromptFiles}
                />
                <ProjectMediaPicker
                  projectId={projectId}
                  label="参考音频"
                  kind="audio"
                  value={audioReferences}
                  multiple
                  max={3}
                  onChange={setAudioReferences}
                  onFilesLoaded={rememberPromptFiles}
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
