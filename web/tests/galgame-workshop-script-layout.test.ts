import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCRIPT_LAYOUT,
  SCRIPT_LAYOUT_KEY,
  loadScriptLayout,
  normalizeScriptLayout,
  storeScriptLayout,
} from "@features/galgame-workshop/editor/scriptLayoutPreferences";

describe("script layout preferences", () => {
  it("ignores legacy pixel widths and starts from the official-style ratios", () => {
    const storage = {
      getItem: (key: string) =>
        key === SCRIPT_LAYOUT_KEY
          ? null
          : JSON.stringify({ left: 230, right: 558 }),
    };
    expect(loadScriptLayout(storage)).toEqual(DEFAULT_SCRIPT_LAYOUT);
  });

  it("normalizes unsafe ratios and writes a versioned preference", () => {
    let stored = "";
    storeScriptLayout(
      normalizeScriptLayout({
        version: 4,
        leftRatio: 40,
        centerRatio: 50,
        performanceCenterRatio: 90,
        previewSplitRatio: 10,
      }),
      { setItem: (_key, value) => (stored = value) },
    );
    expect(JSON.parse(stored)).toEqual({
      version: 4,
      leftRatio: 24,
      centerRatio: 38,
      performanceCenterRatio: 54,
      previewSplitRatio: 42,
    });
  });
});
