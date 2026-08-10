import { describe, expect, test } from "vitest";
import type { GalgameStoryFragment } from "@features/galgame-workshop/api";
import {
  deleteStoryBlockBundle,
  insertStoryBlock,
  moveStoryBlockBundle,
  sameDialogueGroup,
  storyBlockBundles,
} from "@features/galgame-workshop/editor/blockFlow";

describe("Galgame Block flow", () => {
  test("groups consecutive dialogue by speaker set instead of primary speaker", () => {
    expect(
      sameDialogueGroup(
        {
          id: "left",
          type: "dialogue",
          characterId: "hero",
          speakerIds: ["hero", "partner"],
          text: "一起说",
        },
        {
          id: "right",
          type: "dialogue",
          characterId: "partner",
          speakerIds: ["partner", "hero"],
          text: "继续说",
        },
      ),
    ).toBe(true);
    expect(
      sameDialogueGroup(
        {
          id: "dialogue",
          type: "dialogue",
          characterId: "hero",
          text: "对白",
        },
        { id: "scene", type: "scene", sceneId: "lab" },
      ),
    ).toBe(false);
  });

  test("groups implicit character events with their next dialogue", () => {
    const fragment: GalgameStoryFragment = {
      id: "flow",
      title: "Block 流",
      blocks: [
        {
          id: "show",
          type: "showCharacter",
          characterId: "hero",
          expressionId: null,
        },
        { id: "dialogue", type: "dialogue", characterId: "hero", text: "你好" },
        {
          id: "independent",
          type: "removeCharacter",
          characterId: "hero",
          all: false,
          atMs: 900,
        },
      ],
    };

    expect(
      storyBlockBundles(fragment).map((bundle) => ({
        id: bundle.id,
        members: bundle.blocks.map((block) => block.id),
      })),
    ).toEqual([
      { id: "dialogue", members: ["show", "dialogue"] },
      { id: "independent", members: ["independent"] },
    ]);
  });

  test("inserts ordinary content without materializing a timeline", () => {
    const fragment: GalgameStoryFragment = {
      id: "flow",
      title: "Block 流",
      blocks: [
        { id: "end", type: "endChapter", endingId: "ending", label: "结局" },
      ],
    };
    const next = insertStoryBlock(fragment, {
      id: "line",
      type: "narration",
      text: "新的旁白",
    });

    expect(next.timeline).toBeUndefined();
    expect(next.blocks?.map((block) => block.id)).toEqual(["line", "end"]);
    expect(next.blocks?.[0]).not.toHaveProperty("startMs");
  });

  test("inserts a timed cue and ripples later cues", () => {
    const fragment: GalgameStoryFragment = {
      id: "timed",
      title: "精确片段",
      timeline: { durationMs: 3000 },
      blocks: [
        {
          id: "first",
          type: "narration",
          text: "第一句",
          startMs: 0,
          endMs: 1000,
        },
        {
          id: "second",
          type: "narration",
          text: "第二句",
          startMs: 1300,
          endMs: 2300,
        },
      ],
    };
    const next = insertStoryBlock(
      fragment,
      { id: "inserted", type: "narration", text: "插入" },
      "second",
    );
    const inserted = next.blocks?.find((block) => block.id === "inserted");
    const second = next.blocks?.find((block) => block.id === "second");

    expect(inserted).toMatchObject({ startMs: 1300, endMs: 2800 });
    expect(second).toMatchObject({ startMs: 3100, endMs: 4100 });
    expect(next.timeline?.durationMs).toBe(4800);
  });

  test("anchors card-inserted stage and sound blocks without making them independent", () => {
    const fragment: GalgameStoryFragment = {
      id: "timed",
      title: "精确片段",
      timeline: { durationMs: 3000 },
      blocks: [
        {
          id: "line",
          type: "dialogue",
          characterId: "hero",
          text: "下一句",
          startMs: 1000,
          endMs: 2500,
        },
      ],
    };
    const withScene = insertStoryBlock(
      fragment,
      {
        id: "scene",
        type: "scene",
        sceneId: "lab",
        clearCharacters: true,
        atMs: 900,
      },
      "line",
    );
    const withSound = insertStoryBlock(
      withScene,
      {
        id: "sound",
        type: "audio",
        action: "play",
        channel: "sfx",
        assetId: "click",
        volume: 100,
        loop: false,
        fadeMs: 0,
        atMs: 900,
      },
      "line",
    );

    expect(withSound.blocks?.map((block) => block.id)).toEqual([
      "scene",
      "sound",
      "line",
    ]);
    expect(withSound.blocks?.[0]).not.toHaveProperty("atMs");
    expect(withSound.blocks?.[1]).not.toHaveProperty("atMs");
    expect(withSound.timeline).toEqual({ durationMs: 3000 });
  });

  test("reorders timed dialogue bundles and preserves independent event time", () => {
    const fragment: GalgameStoryFragment = {
      id: "timed",
      title: "精确片段",
      timeline: { durationMs: 3000 },
      blocks: [
        {
          id: "sfx",
          type: "audio",
          action: "play",
          channel: "sfx",
          assetId: "sound",
          volume: 100,
          loop: false,
          fadeMs: 0,
          atMs: 700,
        },
        {
          id: "show",
          type: "showCharacter",
          characterId: "hero",
          expressionId: null,
        },
        {
          id: "first",
          type: "dialogue",
          characterId: "hero",
          text: "第一句",
          startMs: 0,
          endMs: 1000,
        },
        {
          id: "second",
          type: "dialogue",
          characterId: "partner",
          text: "第二句",
          startMs: 1300,
          endMs: 2300,
        },
      ],
    };
    const next = moveStoryBlockBundle(fragment, "second", -1);

    expect(next.blocks?.map((block) => block.id)).toEqual([
      "sfx",
      "second",
      "show",
      "first",
    ]);
    expect(next.blocks?.find((block) => block.id === "second")).toMatchObject({
      startMs: 0,
      endMs: 1000,
    });
    expect(next.blocks?.find((block) => block.id === "first")).toMatchObject({
      startMs: 1300,
      endMs: 2300,
    });
    expect(next.blocks?.find((block) => block.id === "sfx")).toMatchObject({
      atMs: 700,
    });
    expect(next.timeline?.durationMs).toBe(3000);
  });

  test("deletes a timed dialogue bundle and closes its time", () => {
    const fragment: GalgameStoryFragment = {
      id: "timed",
      title: "精确片段",
      timeline: { durationMs: 3100 },
      blocks: [
        {
          id: "show",
          type: "showCharacter",
          characterId: "hero",
          expressionId: null,
        },
        {
          id: "first",
          type: "dialogue",
          characterId: "hero",
          text: "第一句",
          startMs: 0,
          endMs: 1000,
        },
        {
          id: "second",
          type: "dialogue",
          characterId: "partner",
          text: "第二句",
          startMs: 1300,
          endMs: 2600,
        },
      ],
    };
    const next = deleteStoryBlockBundle(fragment, "first");

    expect(next.blocks?.map((block) => block.id)).toEqual(["second"]);
    expect(next.blocks?.[0]).toMatchObject({ startMs: 0, endMs: 1300 });
    expect(next.timeline?.durationMs).toBe(1800);
  });
});
