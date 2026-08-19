import { describe, expect, test } from "vitest";
import type {
  GalgameStoryBlock,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { BLOCK_REGISTRY } from "@features/galgame-workshop/editor/blockRegistry";
import {
  BLOCK_CONTEXT_SETTINGS_REGISTRY,
  blockContextSettings,
} from "@features/galgame-workshop/editor/blockContextSettings";

const story = {
  schemaVersion: "1.3",
  synopsis: "",
  characters: [],
  scenes: [],
  variables: [
    {
      id: "score",
      name: "好感度",
      type: "number",
      defaultValue: 0,
      persistence: "session",
      description: "",
    },
  ],
  assets: [
    {
      id: "bgm-1",
      type: "audio",
      role: "backgroundMusic",
      label: "主题曲",
      fileId: "file-bgm",
      status: "ready",
    },
    {
      id: "video-1",
      type: "video",
      role: "video",
      label: "片头",
      fileId: "file-video",
      status: "ready",
    },
  ],
  chapters: [],
} satisfies GalgameStoryProject;

const find = (block: GalgameStoryBlock, label: string) =>
  blockContextSettings(block, story)
    .sections.flatMap((section) => section.settings)
    .find((setting) => setting.label === label)!;

describe("Block context settings", () => {
  test("covers every registered Block type", () => {
    expect(Object.keys(BLOCK_CONTEXT_SETTINGS_REGISTRY).sort()).toEqual(
      Object.keys(BLOCK_REGISTRY).sort(),
    );
    for (const factory of Object.values(BLOCK_CONTEXT_SETTINGS_REGISTRY))
      expect(typeof factory).toBe("function");
  });

  test("keeps audio and video shortcut updates schema-safe", () => {
    const audio: GalgameStoryBlock = {
      id: "audio-1",
      type: "audio",
      action: "stop",
      channel: "bgm",
      assetId: null,
      volume: 70,
      loop: true,
      fadeMs: 1000,
    };
    expect(find(audio, "播放 / 切换").apply(audio)).toMatchObject({
      action: "play",
      assetId: "bgm-1",
    });
    expect(find(audio, "环境音").disabled).toBe(false);

    const video: GalgameStoryBlock = {
      id: "video-block",
      type: "video",
      action: "play",
      assetId: "video-1",
      fit: "cover",
      volume: 100,
      loop: false,
      waitForCompletion: true,
    };
    expect(find(video, "循环播放").apply(video)).toMatchObject({
      loop: true,
      waitForCompletion: false,
    });
  });

  test("prevents contradictory continuous effects and filters variable operators", () => {
    const particle: GalgameStoryBlock = {
      id: "particle-1",
      type: "particle",
      action: "play",
      preset: "snow",
      density: 1,
      durationMs: 3000,
      waitForCompletion: true,
    };
    expect(find(particle, "持续播放").apply(particle)).toMatchObject({
      durationMs: null,
      waitForCompletion: false,
    });

    const variable: GalgameStoryBlock = {
      id: "set-1",
      type: "setVariable",
      variableId: "score",
      operator: "set",
      value: 1,
    };
    expect(
      blockContextSettings(variable, story)
        .sections.flatMap((section) => section.settings)
        .map((setting) => setting.label),
    ).toEqual(["设为", "加", "减", "乘", "除"]);
  });

  test("applies representative text, character, stage, and logic shortcuts", () => {
    const narration: GalgameStoryBlock = {
      id: "narration-1",
      type: "narration",
      text: "雪夜",
      hideDialogueAfter: false,
    };
    expect(find(narration, "本句后隐藏对话框").apply(narration)).toMatchObject({
      hideDialogueAfter: true,
    });

    const character: GalgameStoryBlock = {
      id: "character-1",
      type: "showCharacter",
      characterId: "hero",
      expressionId: null,
      transform: {
        x: 50,
        y: 100,
        anchor: "bottomCenter",
        scale: 1,
        brightness: 1,
        opacity: 1,
        flipX: false,
        layer: 10,
      },
      transition: { durationMs: 240, fade: true },
    };
    expect(find(character, "左侧").apply(character)).toMatchObject({
      transform: { x: 25 },
    });

    const scene: GalgameStoryBlock = {
      id: "scene-1",
      type: "scene",
      sceneId: "snowfield",
      clearCharacters: true,
    };
    expect(find(scene, "切换时清空角色").apply(scene)).toMatchObject({
      clearCharacters: false,
    });

    const variable: GalgameStoryBlock = {
      id: "set-2",
      type: "setVariable",
      variableId: "score",
      operator: "set",
      value: 1,
    };
    expect(find(variable, "加").apply(variable)).toMatchObject({
      operator: "add",
    });
  });
});
