import type { ProviderInput } from "@features/models/api";

export const providerMetadata = {
  openai: { label: "OpenAI 兼容", optionLabel: "OpenAI 兼容" },
  anthropic: { label: "Anthropic", optionLabel: "Anthropic" },
  senseaudio_image: {
    label: "SenseAudio 图片",
    optionLabel: "SenseAudio 图片生成",
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
  chat: { label: "对话" },
  vision: { label: "视觉" },
  tools: { label: "工具" },
  image_generation: { label: "图片生成" },
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
