import type { ModelCategory } from "@features/models/api";
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
  supplierName: string;
};
export function catalogRows(value: ModelCatalogValue): CatalogRow[] {
  const suppliers = new Map(
    value.suppliers.map((supplier) => [supplier.id, supplier.name]),
  );
  return value.providers.flatMap((provider) =>
    provider.models.map((model) => ({
      model,
      provider,
      supplierName: suppliers.get(provider.supplier_id ?? "") ?? "未归类",
    })),
  );
}
export function filterCatalogRows(
  rows: CatalogRow[],
  categories: ModelCategory[],
  filters: {
    tab: CatalogTab;
    search: string;
    supplier: string;
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
      (!filters.supplier ||
        (provider.supplier_id ?? "ungrouped") === filters.supplier) &&
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
  if (provider.kind === "senseaudio_image") return "image";
  if (provider.kind === "senseaudio_video") return "video";
  if (
    ["openai", "senseaudio_asr"].includes(provider.kind) &&
    model.capabilities.includes("speech_recognition")
  )
    return "speech";
  if (provider.kind === "senseaudio_realtime") return "realtime_voice";
  return null;
}
