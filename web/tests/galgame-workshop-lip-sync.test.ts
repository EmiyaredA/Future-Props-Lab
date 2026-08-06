import { describe, expect, test } from "vitest";
import type { GalgameStoryCharacter } from "@features/galgame-workshop/api";
import {
  LipSyncLevelTracker,
  resolveLipSyncExpressionId,
} from "@features/galgame-workshop/editor/lipSync";

const character: GalgameStoryCharacter = {
  id: "speaker",
  name: "说话者",
  description: "",
  expressions: [
    { id: "pose-e003-f000", label: "闭口", assetId: "closed" },
    { id: "pose-e003-f001", label: "半口", assetId: "half" },
    { id: "pose-e003-f002", label: "张口", assetId: "open" },
    { id: "static-expression", label: "静态", assetId: "static" },
  ],
  defaultExpressionId: "pose-e003-f000",
};

describe("音量驱动口型", () => {
  test("只切换同一姿态的配套口型帧，并在缺帧时回退", () => {
    expect(resolveLipSyncExpressionId(character, "pose-e003-f000", 1)).toBe(
      "pose-e003-f001",
    );
    expect(resolveLipSyncExpressionId(character, "pose-e003-f000", 2)).toBe(
      "pose-e003-f002",
    );
    expect(resolveLipSyncExpressionId(character, "static-expression", 2)).toBe(
      "static-expression",
    );
  });

  test("根据动态底噪分三档并以 100ms 滞回抑制闪烁", () => {
    const tracker = new LipSyncLevelTracker();
    expect(tracker.update(-42, false, 0)).toBe(0);
    expect(tracker.update(-39, true, 40)).toBe(0);
    expect(tracker.update(-39, true, 120)).toBe(1);
    expect(tracker.update(-25, true, 150)).toBe(1);
    expect(tracker.update(-25, true, 230)).toBe(2);
    expect(tracker.update(-40, false, 240)).toBe(0);
  });
});
