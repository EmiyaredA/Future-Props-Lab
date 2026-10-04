/** Old human rigs split standing bitmaps; they cannot supply coherent motion views. */
export function humanMotionUnavailable(model: unknown): string | null {
  if (!model || typeof model !== "object") return null;
  const value = model as { rigProfile?: unknown; motionRig?: unknown };
  if (
    value.rigProfile !== "human-chibi" ||
    !value.motionRig ||
    typeof value.motionRig !== "object"
  )
    return null;
  return (value.motionRig as { version?: unknown }).version === 1
    ? "当前人物资源缺少完整动作姿势，已暂停旧分件动画；站姿、表情和换装仍可使用"
    : null;
}
