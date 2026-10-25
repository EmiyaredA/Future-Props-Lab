import { uploadImage } from "../api";
import { studioAssets } from "./studioPreview";
/** Upload only actually referenced bundled artwork, then remap all asset slots. */
export async function managedBundle<T>(value: T): Promise<T> {
  const referenced = new Set<string>();
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === "object")
      for (const [key, child] of Object.entries(item)) {
        if (
          (key === "asset_id" || key === "background_asset_id") &&
          typeof child === "string" &&
          studioAssets[child]
        )
          referenced.add(child);
        else visit(child);
      }
  };
  visit(value);
  const ids = new Map<string, string>();
  for (const id of referenced) {
    const response = await fetch(studioAssets[id]);
    if (!response.ok) throw new Error("模板内置素材加载失败，请刷新后重试");
    const blob = await response.blob();
    const uploaded = await uploadImage(
      new File([blob], `${id}.png`, { type: "image/png" }),
    );
    ids.set(id, uploaded.id);
  }
  const replace = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(replace);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item).map(([key, child]) => [
          key,
          (key === "asset_id" || key === "background_asset_id") &&
          typeof child === "string"
            ? (ids.get(child) ?? child)
            : replace(child),
        ]),
      );
    return item;
  };
  return replace(value) as T;
}
