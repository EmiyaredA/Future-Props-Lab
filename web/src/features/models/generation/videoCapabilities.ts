import type { components } from "@generated/api";

export type VideoCapabilities = components["schemas"]["VideoCapabilitiesOut"];

export function videoChoices(
  caps?: VideoCapabilities | null,
  frames = false,
  resolution?: string,
) {
  return {
    durations: [
      ...(caps?.supports_auto_duration
        ? [{ value: "-1", label: "自动时长" }]
        : []),
      ...Array.from(
        { length: (caps?.duration_max ?? 15) - (caps?.duration_min ?? 4) + 1 },
        (_, index) => {
          const value = (caps?.duration_min ?? 4) + index;
          return { value: String(value), label: `${value} 秒` };
        },
      ),
    ],
    resolutions: caps?.resolutions ?? ["480p", "720p", "1080p"],
    ratios:
      caps?.frames_require_adaptive_ratio && frames
        ? ["adaptive"]
        : (caps?.resolution_ratios?.[resolution ?? ""] ??
          caps?.ratios ?? ["16:9", "9:16", "4:3", "3:4", "1:1"]),
  };
}

export function videoSelectionError(
  caps: VideoCapabilities | null | undefined,
  values: {
    duration: number;
    resolution: string;
    ratio: string;
    image: number;
    audio: number;
    video: number;
    mode?: string;
    prompt?: string;
    seed?: string;
    files?: Array<{ media_kind: string; mime_type: string; byte_size: number }>;
  },
) {
  const choices = videoChoices(
    caps,
    values.mode === "frames",
    values.resolution,
  );
  if (
    values.mode &&
    caps?.supported_modes &&
    !caps.supported_modes.includes(values.mode)
  )
    return "当前模型不支持所选输入方式，请重新选择。";
  if (
    values.prompt !== undefined &&
    caps?.supports_prompt !== false &&
    (((caps?.prompt_required || values.mode === "text") &&
      !values.prompt.trim()) ||
      values.prompt.length > (caps?.max_prompt_length ?? 6000))
  )
    return `请输入 1 至 ${caps?.max_prompt_length ?? 6000} 个字符的提示词。`;
  if (
    caps?.supports_duration !== false &&
    (caps
      ? !choices.durations.some(
          (item) => Number(item.value) === values.duration,
        )
      : values.duration < 2 || values.duration > 15)
  )
    return "当前模型不支持所选时长，请重新选择。";
  if (!choices.resolutions.includes(values.resolution))
    return "当前模型不支持所选分辨率，请重新选择。";
  if (caps?.supports_ratio !== false && !choices.ratios.includes(values.ratio))
    return "当前模型不支持所选比例，请重新选择。";
  const limits = caps?.reference_limits ?? { image: 9, audio: 3, video: 3 };
  for (const kind of ["image", "audio", "video"] as const) {
    if (values[kind] < (caps?.reference_minimums?.[kind] ?? 0))
      return `当前模型至少需要 ${caps?.reference_minimums?.[kind]} 个${{ image: "图片", audio: "音频", video: "视频" }[kind]}参考。`;
    if (values[kind] > (limits[kind] ?? 0))
      return `当前模型最多支持 ${limits[kind] ?? 0} 个${{ image: "图片", audio: "音频", video: "视频" }[kind]}参考，请调整素材或切换模型。`;
  }
  if (
    !caps?.audio_only &&
    values.audio > 0 &&
    values.image + values.video === 0
  )
    return "参考音频需要搭配至少一张图片或一个视频。";
  if (caps && values.video > 0 && !caps.reference_video_upload_configured)
    return "参考视频需要先配置临时素材上传服务（temp_media_upload_url）。";
  if (
    caps?.reference_mime_types &&
    Object.keys(caps.reference_mime_types).length &&
    values.files
  ) {
    if (
      values.files.some(
        (file) =>
          !caps.reference_mime_types?.[file.media_kind]?.includes(
            file.mime_type,
          ),
      )
    )
      return "当前模型不支持所选参考素材格式。";
    if (
      values.files.reduce((sum, file) => sum + file.byte_size, 0) >
      45 * 1024 * 1024
    )
      return "参考素材总大小不能超过 45 MB。";
  }
  if (
    caps?.supports_seed &&
    values.seed &&
    (!Number.isSafeInteger(Number(values.seed)) ||
      Number(values.seed) < (caps.seed_minimum ?? 0) ||
      Number(values.seed) > (caps.seed_maximum ?? 999999999999999))
  )
    return "随机种子超出当前模型支持范围。";
  return "";
}

export function videoRequestParameters(
  caps: VideoCapabilities | null | undefined,
  values: {
    resolution: string;
    ratio: string;
    watermark: boolean;
    generateAudio: boolean;
    seed?: string;
  },
) {
  return {
    resolution:
      values.resolution as components["schemas"]["VideoGenerationTaskCreateIn"]["resolution"],
    ...(caps?.supports_ratio === false
      ? {}
      : {
          ratio:
            values.ratio as components["schemas"]["VideoGenerationTaskCreateIn"]["ratio"],
        }),
    ...(caps?.supports_watermark === false
      ? {}
      : { watermark: values.watermark }),
    ...(caps?.supports_generate_audio === false
      ? {}
      : { generate_audio: values.generateAudio }),
    ...(caps?.supports_seed
      ? {
          workflow_parameters: {
            seed: values.seed ? Number(values.seed) : null,
          },
        }
      : {}),
  };
}

export function workflowSelectionError(
  caps: components["schemas"]["WorkflowVideoCapabilitiesOut"],
  duration: number,
  prompt: string,
  mode: string,
  ids: Record<string, string[]>,
  files: Record<
    string,
    { byte_size: number; mime_type: string; display_name: string }
  >,
) {
  if (!prompt.trim()) return "请输入生成提示词。";
  if (duration < 4 || duration > 15) return "工作流视频时长必须为 4 至 15 秒。";
  if (mode === "frames" || mode === "image")
    return "当前工作流请使用文生视频或全能参考。";
  let bytes = 0;
  for (const [kind, items] of Object.entries(ids)) {
    if (items.length > (caps.reference_limits[kind] ?? 0))
      return "当前工作流参考素材数量超出上限。";
    for (const id of items) {
      const file = files[id];
      if (!file) continue;
      bytes += file.byte_size;
      const accepted = caps.reference_mime_types?.[kind];
      if (accepted?.length && !accepted.includes(file.mime_type))
        return `当前工作流不支持素材格式：${file.display_name}`;
    }
  }
  return caps.max_reference_bytes && bytes > caps.max_reference_bytes
    ? "参考素材总大小不能超过 45 MB。"
    : "";
}
