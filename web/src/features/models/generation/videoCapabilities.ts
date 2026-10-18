import type { components } from "@generated/api";

export type VideoCapabilities = components["schemas"]["VideoCapabilitiesOut"];

export function videoChoices(caps?: VideoCapabilities | null, frames = false) {
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
        : (caps?.ratios ?? ["16:9", "9:16", "4:3", "3:4", "1:1"]),
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
  },
) {
  const choices = videoChoices(caps);
  if (
    caps
      ? !choices.durations.some(
          (item) => Number(item.value) === values.duration,
        )
      : values.duration < 2 || values.duration > 15
  )
    return "当前模型不支持所选时长，请重新选择。";
  if (!choices.resolutions.includes(values.resolution))
    return "当前模型不支持所选分辨率，请重新选择。";
  if (!choices.ratios.includes(values.ratio))
    return "当前模型不支持所选比例，请重新选择。";
  const limits = caps?.reference_limits ?? { image: 9, audio: 3, video: 3 };
  for (const kind of ["image", "audio", "video"] as const) {
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
  return "";
}
