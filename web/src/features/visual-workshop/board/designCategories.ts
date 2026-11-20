import type { VisualMaterialCategory } from "../api";
import type { CardKind } from "../creative/api";

export function designKind(
  category?: VisualMaterialCategory,
): CardKind | undefined {
  const id = category?.id;
  const name = category?.name.trim();
  if (
    id === "character" ||
    name === "角色" ||
    name === "人设" ||
    name === "角色卡"
  )
    return "character";
  if (id === "scene" || name === "场景" || name === "场景卡") return "scene";
  if (id === "prop" || id === "props" || name === "道具" || name === "道具卡")
    return "prop";
}
