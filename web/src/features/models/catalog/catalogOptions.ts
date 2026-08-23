import type { ProviderInput } from "@features/models/api";

export const providerKindLabel = {
  openai: "OpenAI 兼容",
  anthropic: "Anthropic",
  senseaudio_image: "SenseAudio 图片",
  senseaudio_video: "SenseAudio 视频",
  senseaudio_asr: "SenseAudio 语音识别",
  senseaudio_realtime: "SenseAudio 实时语音",
} as const;

export const capabilityLabel = {
  chat: "对话",
  vision: "视觉",
  tools: "工具",
  image_generation: "图片生成",
  video_generation: "视频生成",
  speech_recognition: "语音识别",
  voice: "端到端语音",
} as const;

export const providerKindOptions = [
  { value: "openai", label: "OpenAI 兼容" },
  { value: "anthropic", label: "Anthropic" },
  { value: "senseaudio_image", label: "SenseAudio 图片生成" },
  { value: "senseaudio_video", label: "SenseAudio 视频生成" },
  { value: "senseaudio_asr", label: "SenseAudio 专业说话人识别" },
  { value: "senseaudio_realtime", label: "SenseAudio 实时语音" },
];

export const modelCapabilities = Object.keys(capabilityLabel) as Array<
  keyof typeof capabilityLabel
>;

export function providerBaseUrlPlaceholder(kind: ProviderInput["kind"]) {
  if (kind === "openai") return "https://api.openai.com/v1";
  if (kind === "anthropic") return "https://api.anthropic.com/v1";
  if (kind === "senseaudio_realtime") {
    return "wss://api.senseaudio.cn/ws/v1/realtime/voice-dialog";
  }
  return "https://api.senseaudio.cn/v1";
}
