export type ScriptLayoutPreferences = {
  version: 2;
  leftRatio: number;
  centerRatio: number;
  previewSplitRatio: number;
};

export const SCRIPT_LAYOUT_KEY = "future_props_galgame_editor_script_layout_v2";

export const DEFAULT_SCRIPT_LAYOUT: ScriptLayoutPreferences = {
  version: 2,
  leftRatio: 16.5,
  centerRatio: 25,
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
  return {
    version: 2,
    leftRatio,
    centerRatio: clamp(
      Number.isFinite(value.centerRatio) ? Number(value.centerRatio) : 25,
      22,
      centerMaximum,
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
    if (parsed?.version === 2) return normalizeScriptLayout(parsed);
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
