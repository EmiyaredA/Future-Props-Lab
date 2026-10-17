import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ManagedFile } from "@features/files";
import {
  createGenerationTask,
  createGenerationBatch,
  getGenerationOptions,
  type GenerationTaskInput,
  type ImageGenerationBatchInput,
  type VisualCanvasImageGenerationDraft,
  type VisualCanvasVideoGenerationDraft,
} from "@features/visual-workshop/api";
import { apiErrorMessage } from "@platform/api/errors";
import {
  usePromptVersions,
  type PromptVersionState,
} from "./usePromptVersions";
import {
  imageSizeChoices,
  type GenerationKind,
  type VideoMode,
} from "@features/visual-workshop/generation/options";
import { visualWorkshopQueryKeys as visualKeys } from "@features/visual-workshop/queryKeys";
import type { GenerationDrawerProps } from "@features/visual-workshop/generation/generationDrawerTypes";
import {
  orderedReferenceIds,
  reorderPictureReferences,
} from "@features/visual-workshop/generation/referenceOrder";
import {
  promptAssetReferenceNameForBase,
  type PromptManagedFile,
} from "@features/visual-workshop/generation/generationPromptModel";

function errorMessage(error: unknown) {
  return apiErrorMessage(error, "创建任务失败，请稍后重试。");
}

function uniqueAssetIds(...groups: string[][]) {
  return [...new Set(groups.flat())];
}

function sameAssetIds(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

export function useGenerationDrawerController({
  projectId,
  lockedKind,
  draft,
  onDraftChange,
  onBeforeSubmit,
  onTaskCreated,
  onBatchCreated,
  compact = false,
  layout = "canvas",
  generating = false,
  canvasNodeId,
  onClose,
  linkedAssetIds = { image: [], video: [], audio: [] },
  linkedReferenceNames = {},
  excludedAssetIds = [],
}: GenerationDrawerProps) {
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
  const savePrompt = useRef<
    (next: PromptVersionState, immediate: boolean) => void
  >(() => {});
  const promptVersions = usePromptVersions(
    imageDraft ?? videoDraft,
    (next, immediate) => savePrompt.current(next, immediate),
  );
  const { prompt, edit: setPrompt, read: readPrompt } = promptVersions;
  const [size, setSize] = useState(imageDraft?.size ?? "1024x1024");
  const [seed, setSeed] = useState(
    imageDraft?.seed == null ? "" : String(imageDraft.seed),
  );
  const [imageCount, setImageCount] = useState(imageDraft?.image_count ?? 1);
  const [gridSize, setGridSize] = useState<1 | 4 | 9>(
    imageDraft?.grid_size ?? 1,
  );
  const [gridOutput, setGridOutput] = useState<"nodes" | "composite">(
    imageDraft?.grid_output ?? "nodes",
  );
  const [imageReference, setImageReference] = useState<string[]>(
    imageDraft?.reference_asset_ids?.length
      ? imageDraft.reference_asset_ids
      : imageDraft?.reference_asset_id
        ? [imageDraft.reference_asset_id]
        : [],
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
  const [workflowValues, setWorkflowValues] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(videoDraft?.workflow_parameters ?? {})
        .filter(([, value]) => value != null)
        .map(([key, value]) => [key, String(value)]),
    ),
  );
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [notice, setNotice] = useState("");
  const [promptFiles, setPromptFiles] = useState<Record<string, ManagedFile>>(
    {},
  );
  const [promptReferenceNames, setPromptReferenceNames] = useState<
    Record<string, string>
  >(
    imageDraft?.prompt_reference_names ??
      videoDraft?.prompt_reference_names ??
      {},
  );
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
    const linked = uniqueAssetIds(
      linkedAssetIds.image,
      linkedAssetIds.video,
      linkedAssetIds.audio,
    );
    if (kind === "image")
      return orderedReferenceIds(imageReference, linkedAssetIds.image);
    if (videoMode === "image") return uniqueAssetIds(linked, firstFrame);
    if (videoMode === "frames")
      return uniqueAssetIds(linked, firstFrame, lastFrame);
    if (videoMode === "reference")
      return uniqueAssetIds(
        orderedReferenceIds(references, linkedAssetIds.image),
        orderedReferenceIds(videoReferences, linkedAssetIds.video),
        orderedReferenceIds(audioReferences, linkedAssetIds.audio),
      );
    return linked;
  }, [
    audioReferences,
    firstFrame,
    imageReference,
    kind,
    lastFrame,
    linkedAssetIds.audio,
    linkedAssetIds.image,
    linkedAssetIds.video,
    references,
    videoMode,
    videoReferences,
  ]);
  const resolvedLinkedReferenceNames = useMemo(() => {
    const names: Record<string, string> = {};
    Object.entries(linkedReferenceNames).forEach(([assetId, baseName]) => {
      const file = promptFiles[assetId];
      if (file)
        names[assetId] = promptAssetReferenceNameForBase(file, baseName);
    });
    return names;
  }, [linkedReferenceNames, promptFiles]);
  const promptAssets = useMemo(
    () =>
      selectedPromptAssetIds.flatMap((id) => {
        const file = promptFiles[id];
        if (!file) return [];
        const referenceName =
          resolvedLinkedReferenceNames[id] ?? promptReferenceNames[id];
        if (!referenceName) return [file];
        return [
          {
            ...file,
            prompt_reference_name: referenceName,
            prompt_legacy_names: promptReferenceNames[id]
              ? [promptReferenceNames[id]]
              : [],
          } satisfies PromptManagedFile,
        ];
      }),
    [
      promptFiles,
      promptReferenceNames,
      resolvedLinkedReferenceNames,
      selectedPromptAssetIds,
    ],
  );
  const options = useQuery({
    queryKey: visualKeys.generationOptions,
    queryFn: getGenerationOptions,
  });
  const models = (options.data?.models ?? []).filter(
    (model) => model.kind === kind,
  );
  const selectedModel = models.find((model) => model.id === modelId);
  const workflowCapabilities = selectedModel?.workflow_capabilities;
  const workflowParameters = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(workflowValues)
          .filter(([, value]) => value !== "")
          .map(([key, value]) => [key, Number(value)]),
      ),
    [workflowValues],
  );
  const referenceLimits = workflowCapabilities?.reference_limits ?? {
    image: 9,
    video: 3,
    audio: 3,
  };

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
            ...readPrompt(),
            size,
            seed:
              seed !== "" && Number.isSafeInteger(parsedSeed) && parsedSeed >= 0
                ? parsedSeed
                : null,
            image_count: imageCount,
            grid_size: gridSize,
            grid_output: gridOutput,
            reference_asset_id: null,
            reference_asset_ids: imageReference,
            prompt_reference_names: promptReferenceNames,
            ...changes,
          } as VisualCanvasImageGenerationDraft,
          immediate,
        );
        return;
      }
      onDraftChange(
        {
          model_id: modelId || null,
          ...readPrompt(),
          mode: videoMode,
          duration,
          resolution,
          ratio,
          watermark,
          generate_audio: generateAudio,
          workflow_parameters: workflowParameters,
          first_frame_asset_id: firstFrame[0] ?? null,
          last_frame_asset_id: lastFrame[0] ?? null,
          reference_asset_ids: canvasNodeId
            ? references
            : orderedReferenceIds(references, linkedAssetIds.image),
          audio_asset_ids: canvasNodeId
            ? audioReferences
            : orderedReferenceIds(audioReferences, linkedAssetIds.audio),
          video_asset_ids: canvasNodeId
            ? videoReferences
            : orderedReferenceIds(videoReferences, linkedAssetIds.video),
          prompt_reference_names: promptReferenceNames,
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
      gridOutput,
      gridSize,
      imageReference,
      lastFrame,
      linkedAssetIds.image,
      linkedAssetIds.video,
      linkedAssetIds.audio,
      lockedKind,
      canvasNodeId,
      modelId,
      onDraftChange,
      readPrompt,
      promptReferenceNames,
      ratio,
      references,
      resolution,
      seed,
      size,
      videoMode,
      videoReferences,
      watermark,
      workflowParameters,
    ],
  );
  savePrompt.current = (next, immediate) => persistDraft(next, immediate);
  const selectModel = (id: string) => {
    const model = models.find((item) => item.id === id);
    setModelId(id);
    if (id === modelId) return;
    setWorkflowValues({});
    const changes: Record<string, unknown> = {
      model_id: id,
      workflow_parameters: null,
    };
    if (
      model?.workflow_capabilities &&
      (videoMode === "frames" || videoMode === "image")
    ) {
      const images = uniqueAssetIds(references, firstFrame, lastFrame);
      const mode =
        images.length || hasLinkedVideoReferences ? "reference" : "text";
      setVideoMode(mode);
      setReferences(images);
      setFirstFrame([]);
      setLastFrame([]);
      Object.assign(changes, {
        mode,
        reference_asset_ids: images,
        first_frame_asset_id: null,
        last_frame_asset_id: null,
      });
      if (images.length)
        setNotice("该工作流使用图片参考，原首尾帧已放入参考图片。");
    }
    if (model?.workflow_capabilities && duration < 4) {
      setDuration(5);
      changes.duration = 5;
    }
    persistDraft(changes, true);
  };
  const changeWorkflowValues = (values: Record<string, string>) => {
    setWorkflowValues(values);
    const parameters = Object.fromEntries(
      Object.entries(values)
        .filter(([, value]) => value !== "")
        .map(([key, value]) => [key, Number(value)]),
    );
    const valid = Object.entries(parameters).every(([key, value]) => {
      const spec = workflowCapabilities?.parameters[key];
      return (
        spec &&
        Number.isFinite(value) &&
        value >= spec.minimum &&
        value <= spec.maximum &&
        (spec.step !== 32 || value % 32 === 0)
      );
    });
    if (valid) persistDraft({ workflow_parameters: parameters }, true);
  };
  const reorderImages = (next: string[]) => {
    const previous = orderedReferenceIds(
      kind === "image" ? imageReference : references,
      linkedAssetIds.image,
    );
    if (
      next.length !== previous.length ||
      new Set(next).size !== previous.length ||
      next.some((id) => !previous.includes(id))
    )
      return;
    if (kind === "image") setImageReference(next);
    else setReferences(next);
    promptVersions.update(
      (current) => ({
        ...current,
        prompt: reorderPictureReferences(current.prompt, previous, next),
        prompt_versions: current.prompt_versions.map((version) => ({
          ...version,
          prompt: reorderPictureReferences(
            version.prompt ?? "",
            previous,
            next,
          ),
        })),
      }),
      true,
      false,
    );
    persistDraft({ reference_asset_ids: next }, true);
  };
  useEffect(() => {
    if (lockedKind === "image") {
      const next = imageDraft?.reference_asset_ids?.length
        ? imageDraft.reference_asset_ids
        : imageDraft?.reference_asset_id
          ? [imageDraft.reference_asset_id]
          : [];
      setImageReference((current) =>
        sameAssetIds(current, next) ? current : next,
      );
      return;
    }
    if (lockedKind !== "video") return;
    const nextFirstFrame = videoDraft?.first_frame_asset_id
      ? [videoDraft.first_frame_asset_id]
      : [];
    const nextLastFrame = videoDraft?.last_frame_asset_id
      ? [videoDraft.last_frame_asset_id]
      : [];
    const nextReferences = videoDraft?.reference_asset_ids ?? [];
    const nextAudioReferences = videoDraft?.audio_asset_ids ?? [];
    const nextVideoReferences = videoDraft?.video_asset_ids ?? [];
    setFirstFrame((current) =>
      sameAssetIds(current, nextFirstFrame) ? current : nextFirstFrame,
    );
    setLastFrame((current) =>
      sameAssetIds(current, nextLastFrame) ? current : nextLastFrame,
    );
    setReferences((current) =>
      sameAssetIds(current, nextReferences) ? current : nextReferences,
    );
    setAudioReferences((current) =>
      sameAssetIds(current, nextAudioReferences)
        ? current
        : nextAudioReferences,
    );
    setVideoReferences((current) =>
      sameAssetIds(current, nextVideoReferences)
        ? current
        : nextVideoReferences,
    );
  }, [
    imageDraft?.reference_asset_id,
    imageDraft?.reference_asset_ids,
    lockedKind,
    videoDraft?.audio_asset_ids,
    videoDraft?.first_frame_asset_id,
    videoDraft?.last_frame_asset_id,
    videoDraft?.reference_asset_ids,
    videoDraft?.video_asset_ids,
  ]);
  const linkedNamesReady = Object.keys(linkedReferenceNames).every((assetId) =>
    Boolean(promptFiles[assetId]),
  );
  useEffect(() => {
    if (!lockedKind || lockedKind === "audio" || !linkedNamesReady) return;
    const current = JSON.stringify(promptReferenceNames);
    const next = JSON.stringify(resolvedLinkedReferenceNames);
    if (current === next) return;
    setPromptReferenceNames(resolvedLinkedReferenceNames);
    persistDraft(
      { prompt_reference_names: resolvedLinkedReferenceNames },
      true,
    );
  }, [
    linkedNamesReady,
    lockedKind,
    persistDraft,
    promptReferenceNames,
    resolvedLinkedReferenceNames,
  ]);
  const hasLinkedVideoReferences = Boolean(
    linkedAssetIds.image.length ||
    linkedAssetIds.video.length ||
    linkedAssetIds.audio.length,
  );
  useEffect(() => {
    if (
      lockedKind !== "video" ||
      !hasLinkedVideoReferences ||
      videoMode === "reference"
    )
      return;
    setVideoMode("reference");
    persistDraft(
      {
        mode: "reference",
        first_frame_asset_id: null,
        last_frame_asset_id: null,
      },
      true,
    );
  }, [hasLinkedVideoReferences, lockedKind, persistDraft, videoMode]);
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
        let next = index === 0 ? body : (followupBody ?? body);
        if (index > 0 && canvasNodeId && onBeforeSubmit) {
          const revision = await onBeforeSubmit();
          next = {
            ...next,
            canvas_node_id: canvasNodeId,
            expected_canvas_revision:
              typeof revision === "number" ? revision : undefined,
          };
        }
        const task = await createGenerationTask(projectId, next);
        tasks.push(task);
        if (index < count - 1) await onTaskCreated?.(task);
      }
      return tasks;
    },
    onSuccess: async (tasks) => {
      const task = tasks.at(-1);
      if (!task) return;
      try {
        await onTaskCreated?.(task);
      } catch (error) {
        setNotice(`任务已提交，但节点关联保存失败：${errorMessage(error)}`);
        return;
      }
      setNotice(
        layout === "workbench"
          ? ""
          : tasks.length === 1
            ? `任务已提交（${task.id.slice(0, 8)}），可在“生成任务”页查看进度。`
            : `已提交 ${tasks.length} 个生成任务，生成结果将保存为节点输出版本。`,
      );
      void client.invalidateQueries({ queryKey: visualKeys.generationTasks });
    },
    onError: (error) => setNotice(errorMessage(error)),
  });
  const createBatchMutation = useMutation<
    Awaited<ReturnType<typeof createGenerationBatch>>,
    unknown,
    ImageGenerationBatchInput
  >({
    mutationFn: createGenerationBatch.bind(null, projectId),
    onSuccess: async (batch) => {
      void client.invalidateQueries({ queryKey: visualKeys.generationBatches });
      try {
        await onBatchCreated?.(batch);
      } catch (error) {
        setNotice(`宫格任务已提交，但画布保存失败：${errorMessage(error)}`);
        return;
      }
      setNotice(
        layout === "workbench"
          ? ""
          : `已提交 ${batch.grid_size} 张图片，${
              batch.grid_output === "nodes"
                ? "将自动排列到画布"
                : "完成后自动拼成大图"
            }。`,
      );
      void client.invalidateQueries({ queryKey: visualKeys.generationTasks });
    },
    onError: (error) => setNotice(errorMessage(error)),
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (generating || createMutation.isPending || createBatchMutation.isPending)
      return;
    const prompt = readPrompt().prompt;
    setNotice("");
    if (!modelId) {
      setNotice("请先在模型中心启用相应的图片或视频模型。");
      return;
    }
    if ((kind === "image" || videoMode === "text") && !prompt.trim()) {
      setNotice("请输入生成提示词。");
      return;
    }
    if (
      kind === "video" &&
      videoMode === "reference" &&
      audioReferences.length + linkedAssetIds.audio.length > 0 &&
      references.length + linkedAssetIds.image.length === 0 &&
      videoReferences.length + linkedAssetIds.video.length === 0
    ) {
      setNotice("参考音频需要搭配至少一张图片或一个视频。");
      return;
    }
    if (
      kind === "image" &&
      imageReference.length > (selectedModel?.max_reference_images ?? 1)
    ) {
      setNotice(
        `当前模型最多支持 ${selectedModel?.max_reference_images ?? 1} 张参考图，请减少输入或选择支持多图的模型。`,
      );
      return;
    }
    if (
      kind === "image" &&
      imageReference.some(
        (id) =>
          promptFiles[id] &&
          selectedModel?.reference_mime_types?.length &&
          !selectedModel.reference_mime_types.includes(
            promptFiles[id].mime_type,
          ),
      )
    ) {
      setNotice("当前模型不支持所选参考图片格式，请按模型支持的格式重新上传。");
      return;
    }
    if (
      kind === "image" &&
      prompt.length > (selectedModel?.max_prompt_length ?? 2000)
    ) {
      setNotice(
        `当前模型提示词最多支持 ${selectedModel?.max_prompt_length ?? 2000} 个字符。`,
      );
      return;
    }
    if (kind === "video" && workflowCapabilities) {
      let referenceBytes = 0;
      if (!prompt.trim()) {
        setNotice("请输入生成提示词。");
        return;
      }
      if (duration < 4 || duration > 15) {
        setNotice("工作流视频时长必须为 4 至 15 秒。");
        return;
      }
      if (videoMode === "frames" || videoMode === "image") {
        setNotice("当前工作流请使用文生视频或全能参考。");
        return;
      }
      for (const [media, ids] of Object.entries({
        image: orderedReferenceIds(references, linkedAssetIds.image),
        video: orderedReferenceIds(videoReferences, linkedAssetIds.video),
        audio: orderedReferenceIds(audioReferences, linkedAssetIds.audio),
      })) {
        if (ids.length > (referenceLimits[media] ?? 0)) {
          setNotice(
            `当前工作流最多支持 ${referenceLimits[media] ?? 0} 个${({ image: "图片", video: "视频", audio: "音频" } as Record<string, string>)[media]}参考素材。`,
          );
          return;
        }
        for (const id of ids) {
          const file = promptFiles[id];
          if (!file) continue;
          referenceBytes += file.byte_size;
          const accepted = workflowCapabilities.reference_mime_types?.[media];
          if (accepted?.length && !accepted.includes(file.mime_type)) {
            setNotice(`当前工作流不支持素材格式：${file.display_name}`);
            return;
          }
        }
      }
      if (
        workflowCapabilities.max_reference_bytes &&
        referenceBytes > workflowCapabilities.max_reference_bytes
      ) {
        setNotice("参考素材总大小不能超过 45 MB。");
        return;
      }
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
        if (gridSize === 4 || gridSize === 9) {
          createBatchMutation.mutate({
            model_id: modelId,
            prompt,
            size,
            seed:
              selectedModel?.supports_seed === false || seed === ""
                ? null
                : Number(seed),
            reference_asset_id: null,
            reference_asset_ids: imageReference,
            grid_size: gridSize,
            grid_output: gridOutput,
            ...canvasLink,
          });
          return;
        }
        const body = {
          kind: "image",
          model_id: modelId,
          prompt,
          size,
          seed:
            selectedModel?.supports_seed === false || seed === ""
              ? null
              : Number(seed),
          reference_asset_id: null,
          reference_asset_ids: imageReference,
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
        ...(workflowCapabilities
          ? {
              workflow_parameters: workflowParameters,
              ...(workflowCapabilities.supports_ratio ? { ratio } : {}),
            }
          : { resolution, ratio, watermark, generate_audio: generateAudio }),
        first_frame_asset_id:
          videoMode === "frames" || videoMode === "image"
            ? (firstFrame[0] ?? null)
            : null,
        last_frame_asset_id:
          videoMode === "frames" ? (lastFrame[0] ?? null) : null,
        reference_asset_ids:
          videoMode === "reference"
            ? canvasNodeId
              ? references
              : orderedReferenceIds(references, linkedAssetIds.image)
            : [],
        audio_asset_ids:
          videoMode === "reference"
            ? canvasNodeId
              ? audioReferences
              : orderedReferenceIds(audioReferences, linkedAssetIds.audio)
            : [],
        video_asset_ids:
          videoMode === "reference"
            ? canvasNodeId
              ? videoReferences
              : orderedReferenceIds(videoReferences, linkedAssetIds.video)
            : [],
      } satisfies GenerationTaskInput;
      createMutation.mutate({ body: { ...body, ...canvasLink } });
    } catch (error) {
      setNotice(errorMessage(error));
      return;
    }
  };

  return {
    promptVersions: lockedKind && onDraftChange ? promptVersions : undefined,
    availableReferenceFiles: Object.values(promptFiles),
    excludedAssetIds,
    projectId,
    onClose,
    linkedAssetIds,
    lockedKind,
    compact,
    layout,
    generating,
    kind,
    setKind,
    modelId,
    setModelId,
    selectModel,
    workflowCapabilities,
    referenceLimits,
    workflowValues,
    changeWorkflowValues,
    prompt,
    setPrompt,
    size,
    setSize,
    seed,
    setSeed,
    imageCount,
    setImageCount,
    gridSize,
    setGridSize,
    gridOutput,
    setGridOutput,
    imageReference,
    setImageReference,
    videoMode,
    setVideoMode,
    duration,
    setDuration,
    resolution,
    setResolution,
    ratio,
    setRatio,
    watermark,
    setWatermark,
    generateAudio,
    setGenerateAudio,
    firstFrame,
    setFirstFrame,
    lastFrame,
    setLastFrame,
    references,
    setReferences,
    reorderImages,
    audioReferences,
    setAudioReferences,
    videoReferences,
    hasLinkedVideoReferences,
    setVideoReferences,
    composerExpanded,
    setComposerExpanded,
    notice,
    promptAssets,
    rememberPromptFiles,
    options,
    models,
    selectedModel,
    availableImageSizes,
    selectedImageSize,
    persistDraft,
    invalidSelection,
    createMutation,
    createBatchMutation,
    isSubmitting: createMutation.isPending || createBatchMutation.isPending,
    submit,
  };
}
