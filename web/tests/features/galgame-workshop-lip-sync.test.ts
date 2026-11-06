import { describe, expect, test } from "vitest";
import type { GalgameStoryCharacter } from "@features/galgame-workshop/api";
import {
  LipSyncLevelTracker,
  resolveLipSyncExpressionId,
  resolveLipSyncPresentation,
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
    {
      id: "sequence-expression",
      label: "平静",
      assetId: "sequence-closed",
      renderMode: "frameSequence",
      sequence: {
        playbackMode: "lipSync",
        fps: 12,
        loop: true,
        frames: [
          { id: "sequence-closed", assetId: "sequence-closed" },
          { id: "sequence-half", assetId: "sequence-half" },
          { id: "sequence-open", assetId: "sequence-open" },
        ],
      },
    },
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

  test("语音口型序列保持表情 ID 并返回受控帧", () => {
    expect(
      resolveLipSyncPresentation(character, "sequence-expression", 2),
    ).toEqual({
      expressionId: "sequence-expression",
      controlledFrameIndex: 2,
    });
    expect(
      resolveLipSyncPresentation(character, "static-expression", 2),
    ).toEqual({ expressionId: "static-expression" });
    expect(resolveLipSyncPresentation(character, "pose-e003-f000", 1)).toEqual({
      expressionId: "pose-e003-f001",
    });
  });

  test("根据动态底噪限制开口幅度并按十帧循环", () => {
    const tracker = new LipSyncLevelTracker();
    expect(tracker.update(-42, false, 0)).toBe(0);
    expect(tracker.update(-39, true, 0, 10)).toBe(1);
    expect(tracker.update(-39, true, 100, 10)).toBe(1);
    expect(tracker.update(-39, true, 200, 10)).toBe(0);
    tracker.reset();
    expect(tracker.update(-25, true, 0, 10)).toBe(1);
    expect(tracker.update(-25, true, 100, 10)).toBe(2);
    expect(tracker.update(-25, true, 200, 10)).toBe(2);
    expect(tracker.update(-25, true, 300, 10)).toBe(1);
    expect(tracker.update(-25, true, 400, 10)).toBe(0);
    expect(tracker.update(-40, false, 500)).toBe(0);
  });

  test("按表情帧率控制口型循环速度", () => {
    const tracker = new LipSyncLevelTracker();
    expect(tracker.update(-48, false, 0, 2)).toBe(0);
    expect(tracker.update(-20, true, 0, 2)).toBe(1);
    expect(tracker.update(-20, true, 250, 2)).toBe(2);
    expect(tracker.update(-20, true, 750, 2)).toBe(2);
  });
});
