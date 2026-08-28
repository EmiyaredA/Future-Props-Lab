import type { ProviderInput } from "@features/models/api";
export {
  capabilityLabel,
  modelCapabilities,
  providerKindLabel,
  providerKindOptions,
} from "@features/models/metadata";

export function providerBaseUrlPlaceholder(kind: ProviderInput["kind"]) {
  if (kind === "openai") return "https://api.openai.com/v1";
  if (kind === "anthropic") return "https://api.anthropic.com/v1";
  if (kind === "senseaudio_realtime") {
    return "wss://api.senseaudio.cn/ws/v1/realtime/voice-dialog";
  }
  return "https://api.senseaudio.cn/v1";
}
