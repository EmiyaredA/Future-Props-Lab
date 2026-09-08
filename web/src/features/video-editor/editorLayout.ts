export type VideoEditorLayout = {
  assetWidth: number;
  inspectorWidth: number;
  trackHeaderWidth: number;
  timelineRatio: number;
};

export const DEFAULT_EDITOR_LAYOUT: VideoEditorLayout = {
  assetWidth: 250,
  inspectorWidth: 340,
  trackHeaderWidth: 176,
  timelineRatio: 0.35,
};

export const clampLayoutValue = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function normalizeEditorLayout(value: unknown): VideoEditorLayout {
  const candidate =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const read = (key: keyof VideoEditorLayout, min: number, max: number) => {
    const number = candidate[key];
    return typeof number === "number" && Number.isFinite(number)
      ? clampLayoutValue(number, min, max)
      : DEFAULT_EDITOR_LAYOUT[key];
  };
  return {
    assetWidth: read("assetWidth", 200, 480),
    inspectorWidth: read("inspectorWidth", 280, 520),
    trackHeaderWidth: read("trackHeaderWidth", 176, 320),
    timelineRatio: read("timelineRatio", 0, 1),
  };
}

// Stored preferences describe the desired layout. Viewport constraints only
// affect the rendered sizes, so enlarging the window restores the preference.
export function resolveEditorLayout(
  layout: VideoEditorLayout,
  width: number,
  height: number,
) {
  const desired = normalizeEditorLayout(layout);
  const sideBudget = Math.max(480, width - 12 - 400);
  const excess = Math.max(
    0,
    desired.assetWidth + desired.inspectorWidth - sideBudget,
  );
  const flexible = desired.assetWidth - 200 + desired.inspectorWidth - 280;
  const assetWidth =
    desired.assetWidth -
    (flexible ? (excess * (desired.assetWidth - 200)) / flexible : 0);
  const inspectorWidth =
    desired.inspectorWidth -
    (flexible ? (excess * (desired.inspectorWidth - 280)) / flexible : 0);
  const availableHeight = Math.max(400, height - 106);
  return {
    assetWidth,
    inspectorWidth,
    availableHeight,
    assetMax: Math.min(480, sideBudget - inspectorWidth),
    inspectorMax: Math.min(520, sideBudget - assetWidth),
    trackHeaderWidth: desired.trackHeaderWidth,
    timelineHeight: clampLayoutValue(
      availableHeight * desired.timelineRatio,
      180,
      availableHeight - 220,
    ),
  };
}
