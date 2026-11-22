import { useReferenceImageOrder } from "./useReferenceImageOrder";
import { useProjectReferenceIssues } from "./useProjectReferenceIssues";
import { useReferenceSubjectBindings } from "./useReferenceSubjectBindings";
import { type ReferenceSubjects } from "./referenceSubjects";
import { useGenerationSubmission } from "./useGenerationSubmission";
import { useVideoDefaults } from "./useVideoDefaults";
import {
  videoRequestParameters,
  numericWorkflowParameters,
  workflowSelectionError,
  videoSelectionError,
  videoChoices,
} from "@features/models";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { usePromptReferenceFiles } from "./usePromptReferenceFiles";
import {
  getGenerationOptions,
  type GenerationTaskInput,
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
  imageInputError,
  type GenerationKind,
  type VideoMode,
} from "@features/visual-workshop/generation/options";
import { visualWorkshopQueryKeys as visualKeys } from "@features/visual-workshop/queryKeys";
import type { GenerationDrawerProps } from "@features/visual-workshop/generation/generationDrawerTypes";
import {
  sameAssetIds,
  uniqueAssetIds,
  orderedReferenceIds,
  reorderPictureReferences,
} from "@features/visual-workshop/generation/referenceOrder";

export function useGenerationDrawerController({
  projectId,
  referenceContext,
  referenceInputs = [],
  referencesReady = true,
  lockedKind,
  draft,
  designReferenceRequest,
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
  const imageDraft =
    lockedKind === "image"
      ? (draft as VisualCanvasImageGenerationDraft | null | undefined)
      : undefined;
  const videoDraft =
    lockedKind === "video"
      ? (draft as VisualCanvasVideoGenerationDraft | null | undefined)
      : undefined;
  const referenceIssues = useProjectReferenceIssues(
    projectId,
    canvasNodeId,
    videoDraft?.design_references ?? [],
    referenceContext,
  );
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
  const [resolution, setResolution] = useState<
    "480p" | "720p" | "1080p" | "4k" | "768p" | "960p" | "464x832" | "832x464"
  >(videoDraft?.resolution ?? "720p");
  const [ratio, setRatio] = useState<
    "16:9" | "9:16" | "4:3" | "3:4" | "1:1" | "21:9" | "adaptive"
  >(videoDraft?.ratio ?? "16:9");
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
  const imageOrder = useReferenceImageOrder(
    references,
    linkedAssetIds.image,
    referenceInputs,
    videoDraft?.reference_order,
  );
  const imageReferences = imageOrder.images;
  const [workflowValues, setWorkflowValues] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(videoDraft?.workflow_parameters ?? {})
        .filter(([, value]) => value != null)
        .map(([key, value]) => [key, String(value)]),
    ),
  );
  const saveSubjects = useRef<
    (value: ReferenceSubjects, subject: string) => void
  >(() => {});
  const {
    referenceSubjects,
    subjectKey,
    effectiveSubject,
    changeReferenceSubject,
    replaceReferenceSubjects,
  } = useReferenceSubjectBindings({
    saved: videoDraft?.reference_subjects,
    legacy: workflowValues.video_subject_to_replace ?? "",
    images: imageReferences,
    inputs: referenceInputs,
    ready: referencesReady,
    onSave: (value, subject) => saveSubjects.current(value, subject),
  });
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [notice, setNotice] = useState("");
  const [promptReferenceNames, setPromptReferenceNames] = useState<
    Record<string, string>
  >(
    imageDraft?.prompt_reference_names ??
      videoDraft?.prompt_reference_names ??
      {},
  );
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
        imageReferences,
        orderedReferenceIds(videoReferences, linkedAssetIds.video),
        orderedReferenceIds(audioReferences, linkedAssetIds.audio),
      );
    return linked;
  }, [
    audioReferences,
    imageReferences,
    firstFrame,
    imageReference,
    kind,
    lastFrame,
    linkedAssetIds.audio,
    linkedAssetIds.image,
    linkedAssetIds.video,
    videoMode,
    videoReferences,
  ]);
  const {
    promptFiles,
    rememberPromptFiles,
    resolvedLinkedReferenceNames,
    promptAssets,
  } = usePromptReferenceFiles(
    selectedPromptAssetIds,
    linkedReferenceNames,
    promptReferenceNames,
  );
  const options = useQuery({
    queryKey: visualKeys.generationOptions,
    queryFn: getGenerationOptions,
  });
  const models = (options.data?.models ?? []).filter(
    (model) => model.kind === kind,
  );
  const selectedModel = models.find((model) => model.id === modelId);
  const videoCapabilities = selectedModel?.video_capabilities;
  const framesOnly =
    videoCapabilities?.supported_modes?.length === 1 &&
    videoCapabilities.supported_modes[0] === "frames";
  const linkedFrames = framesOnly
    ? uniqueAssetIds(firstFrame, lastFrame, linkedAssetIds.image)
    : [];
  const effectiveFirstFrame =
    firstFrame[0] ?? linkedFrames.find((id) => id !== lastFrame[0]);
  const effectiveLastFrame =
    lastFrame[0] ?? linkedFrames.find((id) => id !== effectiveFirstFrame);
  const videoFrames = videoMode === "frames" || videoMode === "image";
  const effectiveRatio =
    videoCapabilities?.frames_require_adaptive_ratio && videoFrames
      ? "adaptive"
      : ratio;
  const videoOptions = videoChoices(videoCapabilities, videoFrames, resolution);
  const workflowCapabilities = selectedModel?.workflow_capabilities;
  useVideoDefaults(
    videoCapabilities,
    videoDraft,
    setResolution,
    setRatio,
    setVideoMode,
    setGenerateAudio,
  );
  const workflowParameters = useMemo(
    () =>
      Object.fromEntries(
        Object.entries({
          ...workflowValues,
          video_subject_to_replace: effectiveSubject,
        })
          .filter(([, value]) => value !== "")
          .map(([key, value]) => [
            key,
            key === "video_subject_to_replace" ? value : Number(value),
          ]),
      ),
    [workflowValues, effectiveSubject],
  );
  const referenceLimits = workflowCapabilities?.reference_limits ??
    videoCapabilities?.reference_limits ?? {
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
      const designReferences = (changes.design_references ??
        videoDraft?.design_references ??
        []) as NonNullable<
        VisualCanvasVideoGenerationDraft["design_references"]
      >;
      const imageIds = (changes.reference_asset_ids ?? references) as string[];
      onDraftChange(
        {
          model_id: modelId || null,
          ...readPrompt(),
          mode: videoMode,
          duration,
          resolution,
          ratio:
            videoCapabilities?.frames_require_adaptive_ratio &&
            ["frames", "image"].includes(String(changes.mode ?? videoMode))
              ? "adaptive"
              : ratio,
          watermark,
          generate_audio: generateAudio,
          workflow_parameters: workflowParameters,
          reference_subjects: referenceSubjects,
          reference_order: referencesReady
            ? imageOrder.order
            : (videoDraft?.reference_order ?? null),
          first_frame_asset_id: firstFrame[0] ?? null,
          last_frame_asset_id: lastFrame[0] ?? null,
          reference_asset_ids: canvasNodeId ? references : imageReferences,
          audio_asset_ids: canvasNodeId
            ? audioReferences
            : orderedReferenceIds(audioReferences, linkedAssetIds.audio),
          video_asset_ids: canvasNodeId
            ? videoReferences
            : orderedReferenceIds(videoReferences, linkedAssetIds.video),
          prompt_reference_names: promptReferenceNames,
          ...changes,
          ...(referenceContext
            ? {
                reference_asset_ids: imageIds.filter(
                  (id) =>
                    !linkedAssetIds.image.includes(id) ||
                    designReferences.some((item) => item.asset_id === id),
                ),
              }
            : {}),
          design_references: designReferences.filter((reference) =>
            imageIds.includes(reference.asset_id),
          ),
        } as VisualCanvasVideoGenerationDraft,
        immediate,
      );
    },
    [
      audioReferences,
      imageReferences,
      imageOrder.order,
      referencesReady,
      videoDraft?.reference_order,
      referenceContext,
      referenceSubjects,
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
      videoCapabilities,
      videoDraft?.design_references,
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
    if (model?.video_capabilities) setGenerateAudio(true);
    setNotice(
      "已保留提示词与素材；请确认当前模型支持所选时长、分辨率和参考数量。",
    );
    const caps = model?.video_capabilities;
    if (caps?.default_resolution) {
      setResolution(caps.default_resolution as typeof resolution);
      setRatio((caps.default_ratio ?? "9:16") as typeof ratio);
      const mode = (caps.supported_modes?.[0] ?? "reference") as VideoMode;
      setVideoMode(mode);
    }
    if (caps?.default_duration != null) setDuration(caps.default_duration);
    const changes: Record<string, unknown> = {
      model_id: id,
      ...(caps?.default_duration != null
        ? { duration: caps.default_duration }
        : {}),
      ...(caps?.default_resolution
        ? {
            resolution: caps.default_resolution,
            ratio: caps.default_ratio ?? "9:16",
            mode: caps.supported_modes?.[0] ?? "reference",
          }
        : {}),
      workflow_parameters: null,
    };
    if (model?.video_capabilities) {
      changes.generate_audio = true;
      if (model.video_capabilities.frames_require_adaptive_ratio && videoFrames)
        changes.ratio = "adaptive";
    }
    if (
      (model?.workflow_capabilities ||
        caps?.supported_modes?.[0] === "reference") &&
      (videoMode === "frames" || videoMode === "image")
    ) {
      const images = uniqueAssetIds(references, firstFrame, lastFrame);
      const mode =
        images.length ||
        hasLinkedVideoReferences ||
        caps?.supported_modes?.[0] === "reference"
          ? "reference"
          : "text";
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
  saveSubjects.current = (next, subject) =>
    persistDraft(
      {
        reference_subjects: next,
        workflow_parameters: {
          ...workflowParameters,
          video_subject_to_replace: subject,
        },
      },
      true,
    );
  const changeVideoSubject = (value: string) => {
    setWorkflowValues({ ...workflowValues, video_subject_to_replace: value });
    persistDraft({
      workflow_parameters: value ? { video_subject_to_replace: value } : null,
    });
  };
  const changeWorkflowValues = (values: Record<string, string>) => {
    setWorkflowValues(values);
    const parameters = numericWorkflowParameters(values, workflowCapabilities);
    if (parameters) persistDraft({ workflow_parameters: parameters }, true);
  };
  const reorderImages = (next: string[]) => {
    const previous = orderedReferenceIds(
      kind === "image" ? imageReference : imageReferences,
      linkedAssetIds.image,
    );
    if (
      next.length !== previous.length ||
      new Set(next).size !== previous.length ||
      next.some((id) => !previous.includes(id))
    )
      return;
    if (kind === "image") setImageReference(next);
    else {
      setReferences(
        referenceContext
          ? next.filter((id) => !linkedAssetIds.image.includes(id))
          : next,
      );
      imageOrder.setOrder(next.map(imageOrder.keyFor));
    }
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
    persistDraft(
      {
        reference_asset_ids: next,
        ...(kind === "video"
          ? { reference_order: next.map(imageOrder.keyFor) }
          : {}),
      },
      true,
    );
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
    if (
      !lockedKind ||
      lockedKind === "audio" ||
      !linkedNamesReady ||
      !referencesReady
    )
      return;
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
    referencesReady,
    lockedKind,
    persistDraft,
    promptReferenceNames,
    resolvedLinkedReferenceNames,
  ]);
  const hasLinkedVideoReferences = Object.values(linkedAssetIds).some(
    (ids) => ids.length > 0,
  );
  useEffect(() => {
    if (
      lockedKind !== "video" ||
      options.isLoading ||
      !selectedModel ||
      !hasLinkedVideoReferences ||
      framesOnly ||
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
  }, [
    hasLinkedVideoReferences,
    options.isLoading,
    selectedModel,
    framesOnly,
    lockedKind,
    persistDraft,
    videoMode,
  ]);
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
      const fallback = preferred ?? models[0];
      const next = fallback?.id ?? "";
      if (next === modelId) return;
      setModelId(next);
      const defaultDuration = fallback?.video_capabilities?.default_duration;
      if (defaultDuration != null) setDuration(defaultDuration);
      persistDraft(
        {
          model_id: next || null,
          ...(defaultDuration != null ? { duration: defaultDuration } : {}),
        },
        true,
      );
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

  const { createMutation, createBatchMutation } = useGenerationSubmission({
    projectId,
    canvasNodeId,
    onBeforeSubmit,
    onTaskCreated,
    onBatchCreated,
    layout,
    setNotice,
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (referenceIssues.blocking) {
      setNotice("请先修复未收录到当前项目或不可用的参考设定。");
      return;
    }
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
      !videoCapabilities?.audio_only &&
      videoMode === "reference" &&
      audioReferences.length + linkedAssetIds.audio.length > 0 &&
      references.length + linkedAssetIds.image.length === 0 &&
      videoReferences.length + linkedAssetIds.video.length === 0
    ) {
      setNotice("参考音频需要搭配至少一张图片或一个视频。");
      return;
    }
    if (kind === "image") {
      const error = imageInputError(
        selectedModel,
        imageReference,
        promptFiles,
        prompt,
      );
      if (error) {
        setNotice(error);
        return;
      }
    }
    if (kind === "video" && !workflowCapabilities) {
      const error = videoSelectionError(videoCapabilities, {
        mode: videoMode === "image" ? "frames" : videoMode,
        files: selectedPromptAssetIds.flatMap((id) =>
          promptFiles[id] ? [promptFiles[id]] : [],
        ),
        prompt,
        seed: workflowValues.seed,
        subject: effectiveSubject,
        duration,
        resolution,
        ratio: effectiveRatio,
        image:
          videoMode === "reference"
            ? imageReferences.length
            : framesOnly
              ? linkedFrames.length
              : firstFrame.length + lastFrame.length,
        audio:
          videoMode === "reference"
            ? orderedReferenceIds(audioReferences, linkedAssetIds.audio).length
            : 0,
        video:
          videoMode === "reference"
            ? orderedReferenceIds(videoReferences, linkedAssetIds.video).length
            : 0,
      });
      if (error) {
        setNotice(error);
        return;
      }
    }
    if (kind === "video" && workflowCapabilities) {
      const error = workflowSelectionError(
        workflowCapabilities,
        duration,
        prompt,
        videoMode,
        {
          image: imageReferences,
          audio: orderedReferenceIds(audioReferences, linkedAssetIds.audio),
          video: orderedReferenceIds(videoReferences, linkedAssetIds.video),
        },
        promptFiles,
      );
      if (error) {
        setNotice(error);
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
        prompt: videoCapabilities?.supports_prompt === false ? "" : prompt,
        mode: videoMode === "image" ? "frames" : videoMode,
        duration,
        ...(workflowCapabilities
          ? {
              workflow_parameters: Object.fromEntries(
                Object.entries(workflowParameters).filter(
                  ([key]) =>
                    key !== "video_subject_to_replace" ||
                    videoCapabilities?.supports_video_subject_to_replace,
                ),
              ),
              ...(workflowCapabilities.supports_ratio ? { ratio } : {}),
            }
          : {
              ...videoRequestParameters(videoCapabilities, {
                resolution,
                ratio: effectiveRatio,
                watermark,
                generateAudio,
                seed: workflowValues.seed,
                subject: effectiveSubject,
              }),
            }),
        first_frame_asset_id:
          videoMode === "frames" || videoMode === "image"
            ? (effectiveFirstFrame ?? null)
            : null,
        last_frame_asset_id:
          videoMode === "frames" ? (effectiveLastFrame ?? null) : null,
        reference_asset_ids:
          videoMode === "reference"
            ? canvasNodeId
              ? references
              : imageReferences
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
      setNotice(apiErrorMessage(error, "创建任务失败，请稍后重试。"));
      return;
    }
  };

  return {
    imageReferences,
    referenceOrder: imageOrder.order,
    canvasNodeId,
    referenceContext,
    referenceInputs,
    referencesReady,
    referenceSubjects,
    subjectKey,
    changeReferenceSubject,
    replaceReferenceSubjects,
    effectiveSubject,
    videoCapabilities,
    videoOptions,
    effectiveRatio,
    promptVersions: lockedKind && onDraftChange ? promptVersions : undefined,
    availableReferenceFiles: Object.values(promptFiles),
    designReferenceRequest,
    referenceIssues,
    designReferences: videoDraft?.design_references ?? [],
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
    framesOnly,
    workflowValues,
    setWorkflowValues,
    changeWorkflowValues,
    changeVideoSubject,
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
