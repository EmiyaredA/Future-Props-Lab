import { describe, expect, it } from "vitest";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import { BLOCK_REGISTRY } from "@features/galgame-workshop/editor/blockRegistry";
import { evaluateStoryExpression } from "@features/galgame-workshop/editor/storyExpression";
import {
  applyAutomaticStageBlock,
  emptyStageState,
  enterContentBlock,
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
  it("uses position presets while preserving authored fine distance", () => {
    const document = story();
    document.settings = {
      canvas: { width: 1920, height: 1080 },
      characterStage: {
        anchor: "center",
        defaultPositionId: "position-center",
        defaultHeightPercent: 100,
        positionPresets: [
          { id: "position-left", name: "左", x: 22, y: 48 },
          { id: "position-center", name: "中", x: 51, y: 52 },
        ],
      },
    };
    const shown = applyAutomaticStageBlock(
      emptyStageState(),
      {
        id: "show-hero",
        type: "showCharacter",
        characterId: "hero",
        expressionId: null,
        distance: "near",
        positionId: "position-left",
        transform: {
          x: 99,
          y: 97,
          anchor: "bottomCenter",
          scale: 2.5,
          brightness: 0.8,
          opacity: 1,
          flipX: false,
          layer: 10,
        },
        transition: { durationMs: 240, fade: true },
      },
      document,
    );

    expect(shown.actors.hero).toMatchObject({
      distance: "near",
      positionId: "position-left",
      transform: {
        x: 22,
        y: 48,
        anchor: "center",
        scale: 2.5,
        brightness: 0.8,
      },
    });

    const dialogue = enterContentBlock(
      shown,
      {
        id: "dialogue",
        type: "dialogue",
        characterId: "hero",
        text: "换到中景中间。",
        portrait: {
          mode: "stage",
          visible: true,
          distance: "medium",
          positionId: "position-center",
          keepAfter: true,
          transform: {
            x: -400,
            y: 800,
            anchor: "bottomCenter",
            scale: 3,
            brightness: 1,
            opacity: 1,
            flipX: false,
            layer: 10,
          },
          transition: { durationMs: 240, fade: true },
        },
      },
      document,
    );
    expect(dialogue.actors.hero).toMatchObject({
      distance: "medium",
      positionId: "position-center",
      transform: { x: 51, y: 52, anchor: "center", scale: 3 },
    });
  });

  it("atomically replaces a stage cast and preserves motion trigger identity", () => {
    const document = story();
    document.characters?.push({
      id: "assistant",
      name: "助手",
      description: "",
      expressions: [],
      defaultExpressionId: null,
      attributes: {},
    });
    const first = applyAutomaticStageBlock(
      emptyStageState(),
      {
        id: "cast-one",
        type: "setStageCast",
        members: [
          {
            characterId: "hero",
            distance: "near",
            positionId: null,
            transform: {
              x: 35,
              y: 100,
              anchor: "bottomCenter",
              scale: 1.1,
              brightness: 1,
              opacity: 1,
              flipX: false,
              layer: 10,
            },
            transition: { durationMs: 240, fade: true },
          },
          {
            characterId: "assistant",
            distance: "far",
            positionId: null,
            transform: {
              x: 65,
              y: 100,
              anchor: "bottomCenter",
              scale: 0.9,
              brightness: 1,
              opacity: 1,
              flipX: false,
              layer: 10,
            },
            transition: { durationMs: 240, fade: true },
          },
        ],
        exitTransition: { durationMs: 300, fade: true },
      },
      document,
    );
    expect(Object.values(first.actors)).toHaveLength(2);
    expect(first.actors.hero.transform.scale).toBe(1.1);

    const cleared = applyAutomaticStageBlock(
      first,
      {
        id: "cast-clear",
        type: "setStageCast",
        members: [],
        exitTransition: { durationMs: 300, fade: true },
      },
      document,
    );
    expect(Object.values(cleared.actors)).toHaveLength(2);
    expect(Object.values(cleared.actors).every((actor) => actor.exiting)).toBe(
      true,
    );

    const moved = applyAutomaticStageBlock(
      first,
      {
        id: "motion-one",
        type: "animateSprite",
        characterId: "hero",
        animation: "tug",
        direction: "right",
        intensity: 1.5,
        easing: "easeOut",
        durationMs: 700,
        loop: false,
        waitForCompletion: false,
      },
      document,
    );
    expect(moved.spriteAnimations?.hero).toMatchObject({
      sourceBlockId: "motion-one",
      animation: "tug",
      direction: "right",
      intensity: 1.5,
    });
  });

  it("keeps an existing stage actor visible for a hidden dialogue portrait", () => {
    const document = story();
    document.characters![0]!.expressions = [
      { id: "neutral", label: "平静", assetId: "asset-neutral" },
      { id: "surprised", label: "惊讶", assetId: "asset-surprised" },
    ];
    document.characters![0]!.defaultExpressionId = "neutral";
    const shown = applyAutomaticStageBlock(
      emptyStageState(),
      {
        id: "show-hero",
        type: "showCharacter",
        characterId: "hero",
        expressionId: "neutral",
        distance: "near",
        positionId: null,
        transform: {
          x: 73,
          y: 100,
          anchor: "bottomCenter",
          scale: 1.25,
          brightness: 0.8,
          opacity: 1,
          flipX: true,
          layer: 14,
        },
        transition: { durationMs: 240, fade: true },
      },
      document,
    );

    const speaking = enterContentBlock(
      shown,
      {
        id: "hidden-portrait-dialogue",
        type: "dialogue",
        characterId: "hero",
        expressionId: "surprised",
        text: "沿用舞台立绘，只切换表情。",
        portrait: {
          mode: "stage",
          visible: false,
          distance: "medium",
          keepAfter: true,
          transition: { durationMs: 240, fade: true },
        },
      },
      document,
    );

    expect(speaking.hiddenCharacterId).toBeUndefined();
    expect(speaking.actors.hero).toEqual({
      ...shown.actors.hero,
      expressionId: "surprised",
    });
  });

  it("does not spawn a stage actor for a hidden dialogue portrait", () => {
    const document = story();
    const speaking = enterContentBlock(
      emptyStageState(),
      {
        id: "hidden-portrait-dialogue",
        type: "dialogue",
        characterId: "hero",
        text: "没有上场立绘时保持隐藏。",
        portrait: {
          mode: "stage",
          visible: false,
          distance: "medium",
          keepAfter: true,
          transition: { durationMs: 240, fade: true },
        },
      },
      document,
    );

    expect(speaking.actors).toEqual({});
    expect(speaking.hiddenCharacterId).toBeUndefined();
  });

  it("keeps outgoing and incoming scene and CG layers during one crossfade", () => {
    const document = story();
    document.scenes = [
      { id: "lab", name: "Lab", description: "" },
      { id: "roof", name: "Roof", description: "" },
    ];
    document.cgs = [
      {
        id: "cg-one",
        name: "CG 1",
        description: "",
        variants: [
          { id: "cg-one-default", label: "默认", assetId: "cg-one-asset" },
        ],
        defaultVariantId: "cg-one-default",
      },
      {
        id: "cg-two",
        name: "CG 2",
        description: "",
        variants: [
          { id: "cg-two-default", label: "默认", assetId: "cg-two-asset" },
        ],
        defaultVariantId: "cg-two-default",
      },
    ];
    let state = applyAutomaticStageBlock(
      emptyStageState(),
      { id: "scene-lab", type: "scene", sceneId: "lab" },
      document,
    );
    state = applyAutomaticStageBlock(
      state,
      {
        id: "scene-roof",
        type: "scene",
        sceneId: "roof",
        transition: { durationMs: 350, fade: true },
      },
      document,
    );
    expect(state.scene).toMatchObject({ sceneId: "roof", entering: true });
    expect(state.exitingScene).toMatchObject({ sceneId: "lab", exiting: true });

    state = applyAutomaticStageBlock(
      state,
      {
        id: "show-one",
        type: "showCg",
        cgId: "cg-one",
        displayMode: "fullscreen",
        fit: "cover",
        transition: { durationMs: 450, fade: true },
      },
      document,
    );
    state = applyAutomaticStageBlock(
      state,
      {
        id: "show-two",
        type: "showCg",
        cgId: "cg-two",
        displayMode: "fullscreen",
        fit: "cover",
        transition: { durationMs: 450, fade: true },
      },
      document,
    );
    expect(state.cg).toMatchObject({ cgId: "cg-two", entering: true });
    expect(state.exitingCg).toMatchObject({ cgId: "cg-one", exiting: true });

    state = applyAutomaticStageBlock(
      state,
      {
        id: "hide-two",
        type: "hideCg",
        transition: { durationMs: 450, fade: true },
      },
      document,
    );
    expect(state.cg).toBeUndefined();
    expect(state.exitingCg).toMatchObject({ cgId: "cg-two", exiting: true });
  });

  it("keeps the authored camera target in replay state", () => {
    const camera = applyAutomaticStageBlock(
      emptyStageState(),
      {
        id: "background-push",
        type: "camera",
        target: "background",
        effect: "zoomIn",
        x: 2,
        y: -1,
        scale: 1.08,
        rotation: 0,
        intensity: 0.6,
        durationMs: 4000,
        easing: "easeInOut",
        waitForCompletion: false,
      },
      story(),
    );
    expect(camera.camera).toMatchObject({
      target: "background",
      scale: 1.08,
      durationMs: 4000,
    });
  });

  it("registers every built-in block in one capability table", () => {
    expect(Object.keys(BLOCK_REGISTRY)).toHaveLength(33);
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

  it("promotes a short long-lived floating text block to an emphasis title", () => {
    const document = story();
    const shown = applyAutomaticStageBlock(
      emptyStageState(),
      {
        id: "ending-title",
        type: "floatingText",
        text: "谢谢观看",
        x: 50,
        y: 50,
        color: "#F4E7C5",
        durationMs: 6150,
        waitForCompletion: false,
      },
      document,
    );

    expect(shown.floatingText).toMatchObject({
      text: "谢谢观看",
      fontSize: 108,
    });
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
