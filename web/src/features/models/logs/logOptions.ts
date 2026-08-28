import {
  providerKindLabel,
  type ProviderKind,
} from "@features/models/metadata";

export const providerLabels: Record<string, string> = providerKindLabel;

const LOG_PROVIDER_KINDS: ProviderKind[] = [
  "openai",
  "anthropic",
  "senseaudio_asr",
  "senseaudio_realtime",
];

export const logProviderKindOptions = [
  { value: "", label: "全部供应商" },
  ...LOG_PROVIDER_KINDS.map((value) => ({
    value,
    label: providerKindLabel[value],
  })),
];
