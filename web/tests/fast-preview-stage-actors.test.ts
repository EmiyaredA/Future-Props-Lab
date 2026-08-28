import { expect, test } from "vitest";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import {
  fastPreviewExpressionOverrides,
  fastPreviewStageActorEditors,
} from "@features/galgame-workshop/editor/fastPreviewStageActors";
import type { StageActor } from "@features/galgame-workshop/editor/stage";

test("uses the latest chronological stage command instead of a prior dialogue expression", () => {
  const previousDialogue = {
    id: "kurisu-previous-line",
    type: "dialogue" as const,
    characterId: "kurisu",
    text: "前辈？！",
    expressionId: "kurisu-surprised",
    startMs: 154_252,
    endMs: 155_680,
    portrait: { mode: "stage" as const, visible: true, keepAfter: true },
  };
  const stageCast = {
    id: "stage-cast-current",
    type: "setStageCast" as const,
    atMs: 155_680,
    members: [
      {
        characterId: "maho",
        expressionId: "maho-shy",
        distance: "medium" as const,
        positionId: "left",
      },
      {
        characterId: "kurisu",
        expressionId: "kurisu-worried",
        distance: "medium" as const,
        positionId: "right",
      },
    ],
  };
  const currentDialogue = {
    id: "maho-current-line",
    type: "dialogue" as const,
    characterId: "maho",
    text: "被叫过来了啊。",
    expressionId: "maho-shy",
    startMs: 155_680,
    endMs: 160_117,
  };
  const fragment = {
    id: "fragment-one",
    title: "主线",
    timeline: { durationMs: 200_000 },
    // The production document stores independently timed stage commands before
    // dialogue cues, so raw array order is not chronological source order.
    blocks: [stageCast, previousDialogue, currentDialogue],
  };
  const document = {
    schemaVersion: "1.4",
    synopsis: "",
    assets: [],
    cgs: [],
    scenes: [],
    variables: [],
    characters: [
      {
        id: "kurisu",
        name: "牧濑红莉栖",
        description: "",
        defaultExpressionId: "kurisu-worried",
        expressions: [
          {
            id: "kurisu-worried",
            label: "担忧",
            assetId: "kurisu-worried-asset",
          },
          {
            id: "kurisu-surprised",
            label: "手扶领带·惊讶",
            assetId: "kurisu-surprised-asset",
          },
        ],
      },
      {
        id: "maho",
        name: "比屋定真帆",
        description: "",
        defaultExpressionId: "maho-shy",
        expressions: [
          {
            id: "maho-shy",
            label: "害羞",
            assetId: "maho-shy-asset",
          },
        ],
      },
    ],
    chapters: [
      {
        id: "chapter-one",
        title: "第一章",
        order: 1,
        entryFragmentId: "fragment-one",
        fragments: [fragment],
      },
    ],
  } as GalgameStoryProject;
  const actor = {
    characterId: "kurisu",
    expressionId: "kurisu-worried",
    distance: "medium",
    positionId: "right",
    transform: {
      x: 75,
      y: 100,
      anchor: "bottomCenter",
      scale: 1,
      brightness: 1,
      opacity: 1,
      flipX: false,
      layer: 10,
    },
    transition: { durationMs: 0, fade: false },
    entering: false,
    exiting: false,
  } satisfies StageActor;
  const currentSpeakerActor = {
    ...actor,
    characterId: "maho",
    expressionId: "maho-shy",
    positionId: "left",
    transform: { ...actor.transform, x: 25, layer: 11 },
  } satisfies StageActor;

  const editors = fastPreviewStageActorEditors({
    document,
    fragment,
    activeBlockIndex: 2,
    positionMs: 158_400,
    actors: [currentSpeakerActor, actor],
    autoRevealPortraits: false,
  });

  const currentSpeaker = editors.find(
    (editor) => editor.characterId === "maho",
  );
  const otherActor = editors.find((editor) => editor.characterId === "kurisu");
  expect(currentSpeaker?.source?.kind).toBe("dialogue");
  expect(currentSpeaker?.source?.block.id).toBe("maho-current-line");
  expect(currentSpeaker?.previewExpressionId).toBe("maho-shy");
  expect(otherActor?.source?.kind).toBe("setStageCast");
  expect(otherActor?.source?.block.id).toBe("stage-cast-current");
  expect(otherActor?.previewExpressionId).toBe("kurisu-worried");
  expect(fastPreviewExpressionOverrides(editors)).toEqual({
    maho: "maho-shy",
    kurisu: "kurisu-worried",
  });
});
