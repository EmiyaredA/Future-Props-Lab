import {
  providerKindLabel,
  type ProviderKind,
} from "@features/models/metadata";

export const providerLabels: Record<string, string> = providerKindLabel;

const LOG_PROVIDER_KINDS: ProviderKind[] = [
  "openai",
  "anthropic",
  "local_qwen_tts",
  "senseaudio_asr",
  "senseaudio_asr_pro",
  "senseaudio_realtime",
];

export const logProviderKindOptions = [
  { value: "", label: "全部接入协议" },
  ...LOG_PROVIDER_KINDS.map((value) => ({
    value,
    label: providerKindLabel[value],
  })),
];
