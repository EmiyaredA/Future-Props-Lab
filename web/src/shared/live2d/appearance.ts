import type { CharacterDocument } from "./types";

export const appearanceKey = (userId: string, workspaceId: string) =>
  `amadeus-appearance:${userId}:${workspaceId}`;

export function inspectAppearance(
  document: CharacterDocument,
  assetIds: Set<string>,
): string[] {
  const issues: string[] = [];
  for (const state of [
    "idle",
    "listening",
    "thinking",
    "tool",
    "success",
    "error",
    "paused",
  ] as const) {
    const binding = document.stateBindings[state];
    if (
      !binding?.motionId ||
      !document.motions.some((motion) => motion.id === binding.motionId)
    )
      issues.push(`${state} 缺少动作`);
    if (
      !binding?.expressionId ||
      !document.expressions.some(
        (expression) => expression.id === binding.expressionId,
      )
    )
      issues.push(`${state} 缺少表情`);
  }
  for (const name of ["avatar", "stage"] as const) {
    const camera = document.cameras?.[name];
    if (
      !camera ||
      camera.width <= 0 ||
      camera.height <= 0 ||
      camera.x + camera.width > document.width ||
      camera.y + camera.height > document.height
    )
      issues.push(`${name} 相机位无效`);
  }
  if (!document.parts.length) issues.push("模型没有图层");
  for (const part of document.parts)
    if (!assetIds.has(part.assetId)) issues.push(`${part.name} 素材缺失`);
  return issues;
}
