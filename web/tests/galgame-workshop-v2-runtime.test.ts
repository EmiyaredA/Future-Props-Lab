import { describe, expect, it } from "vitest";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import { BLOCK_REGISTRY } from "@features/galgame-workshop/editor/blockRegistry";
import { evaluateStoryExpression } from "@features/galgame-workshop/editor/storyExpression";
import {
  applyAutomaticStageBlock,
  emptyStageState,
} from "@features/galgame-workshop/editor/stage";
import {
  advanceRuntime,
  chooseRuntimeFragment,
  continueRuntime,
  continueRuntimeWithVariable,
  initialRuntime,
} from "@features/galgame-workshop/editor/storyRuntime";

function story(): GalgameStoryProject {
  return {
    schemaVersion: "1.0",
    entryChapterId: "chapter-one",
    synopsis: "",
    characters: [
      {
        id: "hero",
        name: "主角",
        description: "",
        expressions: [],
        defaultExpressionId: null,
        attributes: { trust: 3 },
      },
    ],
    characterAttributeTemplates: [
      {
        id: "trust",
        name: "信任",
        type: "number",
        defaultValue: 0,
        description: "",
      },
    ],
    scenes: [],
    cgs: [],
    assets: [],
    variables: [
      {
        id: "flag",
        name: "标记",
        type: "boolean",
        defaultValue: false,
        persistence: "session",
        description: "",
      },
    ],
    chapters: [
      {
        id: "chapter-one",
        title: "第一章",
        order: 1,
        entryFragmentId: "main",
        disabled: false,
        fragments: [
          {
            id: "main",
            title: "开始",
            blocks: [
              {
                id: "set",
                type: "setVariable",
                variableId: "flag",
                operator: "set",
                value: true,
              },
              {
                id: "if",
                type: "if",
                condition: "flag && character.hero.trust >= 3",
                thenFragmentId: "called",
                elseFragmentId: null,
              },
              {
                id: "end-one",
                type: "endChapter",
                endingId: null,
                label: "下一章",
              },
            ],
          },
          {
            id: "called",
            title: "被调用",
            blocks: [
              { id: "called-line", type: "narration", text: "调用内容" },
            ],
          },
        ],
      },
      {
        id: "chapter-two",
        title: "第二章",
        order: 2,
        entryFragmentId: "second-main",
        disabled: false,
        fragments: [
          {
            id: "second-main",
            title: "继续",
            blocks: [
              { id: "second-line", type: "narration", text: "状态保留" },
              {
                id: "end-two",
                type: "endChapter",
                endingId: null,
                label: "完成",
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("Galgame workbench v2 runtime", () => {
  it("registers every built-in block in one capability table", () => {
    expect(Object.keys(BLOCK_REGISTRY)).toHaveLength(32);
    expect(BLOCK_REGISTRY.returnToEntry.timing).toBe("terminal");
    expect(BLOCK_REGISTRY.camera.category).toBe("stage");
  });

  it("evaluates only declared scalar values", () => {
    expect(
      evaluateStoryExpression("flag && character.hero.trust >= 3", {
        flag: true,
        "character.hero.trust": 3,
      }),
    ).toBe(true);
    expect(() => evaluateStoryExpression("globalThis.alert(1)", {})).toThrow();
  });

  it("calls a fragment, returns, preserves variables and advances chapters", () => {
    const document = story();
    const called = advanceRuntime(document, initialRuntime(document));
    expect(called.kind).toBe("content");
    if (called.kind !== "content") return;
    expect(called.block.id).toBe("called-line");
    expect(called.state.callStack).toHaveLength(1);
    expect(called.state.variables.flag).toBe(true);

    const second = continueRuntime(document, called.state);
    expect(second.kind).toBe("content");
    if (second.kind !== "content") return;
    expect(second.block.id).toBe("second-line");
    expect(second.state.chapterId).toBe("chapter-two");
    expect(second.state.variables.flag).toBe(true);

    const stopped = continueRuntime(document, second.state);
    expect(stopped.kind).toBe("stopped");
  });

  it("pushes branch targets as calls", () => {
    const document = story();
    const state = initialRuntime(document);
    const target = chooseRuntimeFragment(document, state, "called");
    expect(target.callStack[0]).toMatchObject({
      fragmentId: "main",
      blockIndex: 1,
    });
  });

  it("pauses deterministic reduction for stage effects that wait", () => {
    const document = story();
    document.chapters![0].fragments![0].blocks = [
      {
        id: "camera-wait",
        type: "camera",
        target: "stage",
        effect: "shake",
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        intensity: 1,
        durationMs: 500,
        easing: "easeInOut",
        waitForCompletion: true,
      },
      { id: "after-camera", type: "narration", text: "镜头结束后出现" },
    ];
    const waiting = advanceRuntime(document, initialRuntime(document));
    expect(waiting.kind).toBe("content");
    if (waiting.kind !== "content") return;
    expect(waiting.block.id).toBe("camera-wait");
    expect(waiting.state.blockIndex).toBe(0);
    const continued = continueRuntime(document, waiting.state);
    expect(continued.kind).toBe("content");
    if (continued.kind === "content")
      expect(continued.block.id).toBe("after-camera");
  });

  it("reduces all curtain modes and opens the active curtain deterministically", () => {
    const document = story();
    for (const mode of [
      "fullscreen",
      "letterbox",
      "pillarbox",
      "frame",
    ] as const) {
      const shown = applyAutomaticStageBlock(
        emptyStageState(),
        {
          id: `show-${mode}`,
          type: "curtain",
          mode,
          action: "show",
          color: "#123456",
          opacity: 0.8,
          durationMs: 600,
          waitForCompletion: false,
        },
        document,
      );
      expect(shown.curtain).toMatchObject({
        mode,
        visible: true,
        action: "show",
        color: "#123456",
      });

      const hidden = applyAutomaticStageBlock(
        shown,
        {
          id: `hide-${mode}`,
          type: "curtain",
          mode: "fullscreen",
          action: "hide",
          color: "#000000",
          opacity: 1,
          durationMs: 400,
          waitForCompletion: false,
        },
        document,
      );
      expect(hidden.curtain).toMatchObject({
        mode,
        visible: false,
        action: "hide",
        color: "#123456",
      });
    }

    const noOp = applyAutomaticStageBlock(
      emptyStageState(),
      {
        id: "hide-empty",
        type: "curtain",
        mode: "frame",
        action: "hide",
        color: "#000000",
        opacity: 1,
        durationMs: 400,
        waitForCompletion: false,
      },
      document,
    );
    expect(noOp.curtain).toBeUndefined();
  });

  it("applies paragraph parameters and ignores author comments", () => {
    const document = story();
    document.presentation = {
      text: { defaultSpeedCps: 36 },
      paragraph: {
        defaultStyleRef: { source: "builtin", id: "classic" },
        customStyles: [],
      },
    };
    document.chapters![0].fragments![0].blocks = [
      { id: "comment", type: "comment", text: "作者提示" },
      {
        id: "params",
        type: "paragraphParams",
        textSpeedCps: 20,
        fadeMs: 300,
        revealEffect: "fade",
        readBehavior: "dim",
        historyLimit: 12,
        styleRef: { source: "extension", id: "cinematic" },
      },
      {
        id: "paragraph",
        type: "storyParagraph",
        text: "段落正文",
        textSpeedCps: 0,
      },
    ];

    const result = advanceRuntime(document, initialRuntime(document));
    expect(result.kind).toBe("content");
    if (result.kind !== "content") return;
    expect(result.block.id).toBe("paragraph");
    expect(result.state.paragraph).toEqual({
      textSpeedCps: 20,
      fadeMs: 300,
      revealEffect: "fade",
      readBehavior: "dim",
      historyLimit: 12,
      styleRef: { source: "extension", id: "cinematic" },
    });
  });

  it("writes a confirmation result before continuing", () => {
    const document = story();
    document.variables!.push({
      id: "accepted",
      name: "确认",
      type: "boolean",
      defaultValue: false,
      persistence: "session",
      description: "",
    });
    document.chapters![0].fragments![0].blocks = [
      {
        id: "confirm",
        type: "systemMessage",
        mode: "confirm",
        tone: "warning",
        text: "继续吗？",
        resultVariableId: "accepted",
      },
      { id: "after", type: "narration", text: "已处理" },
    ];
    const message = advanceRuntime(document, initialRuntime(document));
    expect(message.kind).toBe("content");
    if (message.kind !== "content") return;

    const continued = continueRuntimeWithVariable(
      document,
      message.state,
      "accepted",
      true,
    );
    expect(continued.kind).toBe("content");
    expect(continued.state.variables.accepted).toBe(true);
  });
});
