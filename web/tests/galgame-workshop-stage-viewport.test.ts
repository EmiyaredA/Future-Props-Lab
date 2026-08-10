import { beforeEach, expect, test } from "vitest";
import {
  DEFAULT_STAGE_VIEWPORT_PREFERENCES,
  loadStageViewportPreferences,
  resolveStageAspectParts,
  storeStageViewportPreferences,
} from "@features/galgame-workshop/editor/stageViewportPreferences";

beforeEach(() => {
  localStorage.clear();
});

test("loads defaults and stores viewport preferences", () => {
  expect(loadStageViewportPreferences()).toEqual(
    DEFAULT_STAGE_VIEWPORT_PREFERENCES,
  );
  storeStageViewportPreferences({
    aspectMode: "16:10",
    customWidth: 21,
    customHeight: 9,
    collapsed: true,
  });
  expect(loadStageViewportPreferences()).toEqual({
    aspectMode: "16:10",
    customWidth: 21,
    customHeight: 9,
    collapsed: true,
  });
});

test("rejects invalid stored preferences", () => {
  localStorage.setItem(
    "future_props_galgame_stage_viewport",
    JSON.stringify({
      aspectMode: "ultra-wide",
      customWidth: -3,
      customHeight: 0,
      collapsed: "yes",
    }),
  );
  expect(loadStageViewportPreferences()).toEqual(
    DEFAULT_STAGE_VIEWPORT_PREFERENCES,
  );
});

test("resolves aspect parts for presets and custom mode", () => {
  expect(
    resolveStageAspectParts({
      ...DEFAULT_STAGE_VIEWPORT_PREFERENCES,
      aspectMode: "auto",
    }),
  ).toBeNull();
  expect(
    resolveStageAspectParts({
      ...DEFAULT_STAGE_VIEWPORT_PREFERENCES,
      aspectMode: "4:3",
    }),
  ).toEqual({ width: 4, height: 3 });
  expect(
    resolveStageAspectParts({
      ...DEFAULT_STAGE_VIEWPORT_PREFERENCES,
      aspectMode: "custom",
      customWidth: 21,
      customHeight: 9,
    }),
  ).toEqual({ width: 21, height: 9 });
});
