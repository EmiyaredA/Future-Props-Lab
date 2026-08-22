import { describe, expect, it } from "vitest";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import {
  legacyCharacterPresentation,
  nearestCharacterPositionId,
  suggestCharacterPresentation,
  type CharacterPresentationStage,
} from "@features/galgame-workshop/editor/characterPresentation";
import {
  characterStageSettings,
  normalizeCharacterStageSettings,
} from "@features/galgame-workshop/editor/characterStageSettings";
import { characterAssetTransform } from "@features/galgame-workshop/editor/stage";

const document = {
  schemaVersion: "1.4",
  entryChapterId: "chapter",
  synopsis: "",
  characters: [
    { id: "hero", name: "主角", description: "", expressions: [] },
    { id: "friend", name: "同伴", description: "", expressions: [] },
  ],
  scenes: [],
  cgs: [],
  assets: [],
  variables: [],
  chapters: [],
} as GalgameStoryProject;

function stage(
  actors: Array<[string, number, string?, ("far" | "medium" | "near")?]>,
): CharacterPresentationStage {
  return {
    actors: Object.fromEntries(
      actors.map(([characterId, x, positionId, distance]) => [
        characterId,
        { characterId, transform: { x }, positionId, distance },
      ]),
    ),
  };
}

describe("character presentation recommendations", () => {
  it("adds the two edge presets to legacy five-position settings", () => {
    const settings = normalizeCharacterStageSettings({
      anchor: "center",
      defaultPositionId: "position-center",
      defaultHeightPercent: 100,
      positionPresets: [
        { id: "position-left", name: "左", x: 25, y: 57.5 },
        { id: "position-center-left", name: "中左", x: 37.5, y: 57.5 },
        { id: "position-center", name: "中", x: 50, y: 57.5 },
        { id: "position-center-right", name: "中右", x: 62.5, y: 57.5 },
        { id: "position-right", name: "右", x: 75, y: 57.5 },
      ],
    });

    expect(settings.positionPresets.map((preset) => preset.name)).toEqual([
      "极左",
      "左",
      "中左",
      "中",
      "中右",
      "右",
      "极右",
    ]);
    expect(settings.positionPresets[0]).toMatchObject({ x: 12, y: 57.5 });
    expect(settings.positionPresets.at(-1)).toMatchObject({ x: 88, y: 57.5 });
  });

  it("maps old edge coordinates and scale to presets and distance", () => {
    const settings = characterStageSettings(document, "hero");

    expect(nearestCharacterPositionId(settings, 10)).toBe(
      "position-outer-left",
    );
    expect(nearestCharacterPositionId(settings, 88)).toBe(
      "position-outer-right",
    );
    expect(
      legacyCharacterPresentation(settings, {
        x: 88,
        y: 50,
        anchor: "center",
        scale: 0.6,
        brightness: 1,
        opacity: 1,
        flipX: false,
        layer: 10,
      }),
    ).toEqual({ positionId: "position-outer-right", distance: "far" });
  });

  it("inherits an on-stage actor and otherwise selects an unoccupied slot", () => {
    expect(
      suggestCharacterPresentation(
        document,
        "hero",
        stage([["hero", 25, "position-left", "near"]]),
      ),
    ).toEqual({ positionId: "position-left", distance: "near" });

    expect(suggestCharacterPresentation(document, "friend")).toEqual({
      positionId: "position-center",
      distance: "medium",
    });
    expect(
      suggestCharacterPresentation(
        document,
        "friend",
        stage([["hero", 50, "position-center"]]),
      ).positionId,
    ).toBe("position-left");
  });

  it("uses all six composition slots without duplication and pushes crowds back", () => {
    const occupied = stage([
      ["one", 12, "position-outer-left"],
      ["two", 25, "position-left"],
      ["three", 37.5, "position-center-left"],
      ["four", 62.5, "position-center-right"],
      ["five", 75, "position-right"],
    ]);

    expect(suggestCharacterPresentation(document, "hero", occupied)).toEqual({
      positionId: "position-outer-right",
      distance: "far",
    });
  });

  it("falls back to the asset position while preserving an explicit fine scale", () => {
    const transform = characterAssetTransform(
      document,
      "hero",
      {
        x: 4,
        y: 99,
        anchor: "center",
        scale: 3,
        brightness: 1,
        opacity: 1,
        flipX: false,
        layer: 10,
      },
      "deleted-position",
    );

    expect(transform).toMatchObject({ x: 50, y: 50, scale: 3 });
  });
});
