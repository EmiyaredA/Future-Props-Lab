import type { ModelCategory } from "@features/models/api";
import { providerKindLabel } from "@features/models/metadata";
import type {
  CatalogModel,
  CatalogProvider,
  ModelCatalogValue,
} from "./catalogTypes";

export const catalogTabs = [
  { id: "all", label: "全部" },
  { id: "text", label: "文本生成" },
  { id: "image", label: "图像生成" },
  { id: "video", label: "视频生成" },
  { id: "audio", label: "音频生成" },
] as const;
export type CatalogTab = (typeof catalogTabs)[number]["id"];
export type CatalogRow = {
  model: CatalogModel;
  provider: CatalogProvider;
  protocolLabel: string;
};
export function catalogRows(value: ModelCatalogValue): CatalogRow[] {
  return value.providers.flatMap((provider) =>
    provider.models.map((model) => ({
      model,
      provider,
      protocolLabel: providerKindLabel[provider.kind] ?? provider.kind,
    })),
  );
}
export function filterCatalogRows(
  rows: CatalogRow[],
  categories: ModelCategory[],
  filters: {
    tab: CatalogTab;
    search: string;
    protocol: string;
    capability: string;
  },
) {
  const types = new Map(
    categories.map((category) => [category.id, category.type]),
  );
  const search = filters.search.trim().toLocaleLowerCase();
  return rows.filter(
    ({ model, provider }) =>
      (filters.tab === "all" ||
        model.categories.some(
          (category) => types.get(category) === filters.tab,
        )) &&
      (!search ||
        `${model.label} ${model.slug}`.toLocaleLowerCase().includes(search)) &&
      (!filters.protocol || provider.kind === filters.protocol) &&
      (!filters.capability ||
        model.capabilities.some(
          (capability) => capability === filters.capability,
        )),
  );
}
export function catalogModelStatus(
  model: CatalogModel,
  provider: CatalogProvider,
) {
  if (!provider.enabled) return "连接已停用";
  return model.enabled ? "已启用" : "模型已停用";
}
export function modelTestMode(model: CatalogModel, provider: CatalogProvider) {
  if (
    ["openai", "anthropic"].includes(provider.kind) &&
    model.capabilities.includes("chat")
  )
    return "chat";
  if (["senseaudio_image", "volcengine_image"].includes(provider.kind))
    return "image";
  if (
    ["senseaudio_video", "zealman_video", "volcengine_video"].includes(
      provider.kind,
    )
  )
    return "video";
  if (
    ["openai", "senseaudio_asr", "senseaudio_asr_pro"].includes(
      provider.kind,
    ) &&
    model.capabilities.includes("speech_recognition")
  )
    return "speech";
  if (provider.kind === "senseaudio_realtime") return "realtime_voice";
  return null;
}
