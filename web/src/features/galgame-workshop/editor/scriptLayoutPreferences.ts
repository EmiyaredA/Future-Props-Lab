export type ScriptLayoutPreferences = {
  version: 4;
  leftRatio: number;
  centerRatio: number;
  performanceCenterRatio: number;
  previewSplitRatio: number;
};

export const SCRIPT_LAYOUT_KEY = "future_props_galgame_editor_script_layout_v4";

export const DEFAULT_SCRIPT_LAYOUT: ScriptLayoutPreferences = {
  version: 4,
  leftRatio: 16.5,
  centerRatio: 39.5,
  performanceCenterRatio: 58.5,
  previewSplitRatio: 60,
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

export function normalizeScriptLayout(
  value: Partial<ScriptLayoutPreferences>,
): ScriptLayoutPreferences {
  const leftRatio = clamp(
    Number.isFinite(value.leftRatio) ? Number(value.leftRatio) : 16.5,
    12,
    24,
  );
  const centerMaximum = Math.max(22, 62 - leftRatio);
  const performanceCenterMaximum = Math.max(42, 78 - leftRatio);
  return {
    version: 4,
    leftRatio,
    centerRatio: clamp(
      Number.isFinite(value.centerRatio) ? Number(value.centerRatio) : 39.5,
      22,
      centerMaximum,
    ),
    performanceCenterRatio: clamp(
      Number.isFinite(value.performanceCenterRatio)
        ? Number(value.performanceCenterRatio)
        : 58.5,
      42,
      performanceCenterMaximum,
    ),
    previewSplitRatio: clamp(
      Number.isFinite(value.previewSplitRatio)
        ? Number(value.previewSplitRatio)
        : 60,
      42,
      72,
    ),
  };
}

export function loadScriptLayout(
  storage: Pick<Storage, "getItem"> = localStorage,
): ScriptLayoutPreferences {
  try {
    const parsed = JSON.parse(
      storage.getItem(SCRIPT_LAYOUT_KEY) ?? "null",
    ) as Partial<ScriptLayoutPreferences> | null;
    if (parsed?.version === 4) return normalizeScriptLayout(parsed);
  } catch {
    // A stale or malformed preference must never break the editor shell.
  }
  return DEFAULT_SCRIPT_LAYOUT;
}

export function storeScriptLayout(
  value: ScriptLayoutPreferences,
  storage: Pick<Storage, "setItem"> = localStorage,
) {
  storage.setItem(
    SCRIPT_LAYOUT_KEY,
    JSON.stringify(normalizeScriptLayout(value)),
  );
}
