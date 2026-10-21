import type { ProviderInput } from "@features/models/api";

export const providerMetadata = {
  local_qwen_tts: {
    label: "本地 Qwen 语音",
    optionLabel: "本地 Qwen · MLX 托管",
  },
  volcengine_video: {
    label: "火山方舟视频",
    optionLabel: "火山方舟 · Seedance 2.0 / 2.5",
  },
  volcengine_image: {
    label: "火山方舟图片",
    optionLabel: "火山方舟 · Seedream 原生多图",
  },
  openai: { label: "OpenAI 兼容", optionLabel: "OpenAI 兼容" },
  anthropic: { label: "Anthropic", optionLabel: "Anthropic" },
  senseaudio_image: {
    label: "SenseAudio 图片",
    optionLabel: "SenseAudio 图片生成",
  },
  zealman_video: {
    label: "ZEALMAN 视频",
    optionLabel: "ZEALMAN · H3 工作流视频",
  },
  senseaudio_video: {
    label: "SenseAudio 视频",
    optionLabel: "SenseAudio 视频生成",
  },
  senseaudio_music: {
    label: "SenseAudio 音乐",
    optionLabel: "SenseAudio 音乐生成",
  },
  senseaudio_sfx: {
    label: "SenseAudio 音效",
    optionLabel: "SenseAudio 音效生成",
  },
  senseaudio_asr: {
    label: "SenseAudio 语音识别",
    optionLabel: "SenseAudio 专业说话人识别",
  },
  senseaudio_asr_pro: {
    label: "SenseAudio ASR API",
    optionLabel: "ASR API 专业语音识别",
  },
  senseaudio_realtime: {
    label: "SenseAudio 实时语音",
    optionLabel: "SenseAudio 实时语音",
  },
} satisfies Record<
  ProviderInput["kind"],
  { label: string; optionLabel: string }
>;

export type ProviderKind = keyof typeof providerMetadata;

export const capabilityMetadata = {
  speech_synthesis: { label: "语音合成" },
  chat: { label: "对话" },
  vision: { label: "图像理解" },
  tools: { label: "工具" },
  image_generation: { label: "图像生成" },
  video_generation: { label: "视频生成" },
  audio_generation: { label: "音频生成" },
  speech_recognition: { label: "语音识别" },
  voice: { label: "端到端语音" },
} as const;

export type ModelCapability = keyof typeof capabilityMetadata;

export const providerKindLabel = Object.fromEntries(
  Object.entries(providerMetadata).map(([kind, metadata]) => [
    kind,
    metadata.label,
  ]),
) as Record<ProviderKind, string>;

export const capabilityLabel = Object.fromEntries(
  Object.entries(capabilityMetadata).map(([capability, metadata]) => [
    capability,
    metadata.label,
  ]),
) as Record<ModelCapability, string>;

export const providerKindOptions = Object.entries(providerMetadata).map(
  ([value, metadata]) => ({
    value: value as ProviderKind,
    label: metadata.optionLabel,
  }),
);

export const modelCapabilities = Object.keys(
  capabilityMetadata,
) as ModelCapability[];
