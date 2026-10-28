import type { ProviderInput } from "@features/models/api";
export {
  capabilityLabel,
  modelCapabilities,
  providerKindLabel,
  providerKindOptions,
} from "@features/models/metadata";

export function providerBaseUrlPlaceholder(kind: ProviderInput["kind"]) {
  if (["volcengine_image", "volcengine_video"].includes(kind))
    return "https://ark.cn-beijing.volces.com/api/v3";
  if (kind === "autodl_video") return "https://www.autodl.art";
  if (kind === "zealman_video") return "https://your-panel.example:8443";
  if (kind === "openai") return "https://api.openai.com/v1";
  if (kind === "deepseek") return "https://api.deepseek.com";
  if (kind === "anthropic") return "https://api.anthropic.com/v1";
  if (kind === "senseaudio_realtime") {
    return "wss://api.senseaudio.cn/ws/v1/realtime/voice-dialog";
  }
  if (kind === "senseaudio_asr_pro") {
    return "https://asr.example/api/v2/asr/pro";
  }
  return "https://api.senseaudio.cn/v1";
}
