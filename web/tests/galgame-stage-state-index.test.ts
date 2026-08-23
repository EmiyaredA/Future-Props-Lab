import { describe, expect, it } from "vitest";
import type {
  GalgameStoryFragment,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { replayStageToBlock } from "@features/galgame-workshop/editor/stage";
import { buildStageStateIndex } from "@features/galgame-workshop/editor/stageStateIndex";

describe("linear Galgame stage index", () => {
  it("matches replay for mixed stage and content blocks in one traversal", () => {
    const fragment = {
      id: "main",
      title: "Main",
      blocks: [
        { id: "scene", type: "scene", sceneId: "room" },
        {
          id: "show-a",
          type: "showCharacter",
          characterId: "a",
          expressionId: null,
          positionId: "left",
          distance: "medium",
        },
        { id: "line-a", type: "dialogue", characterId: "a", text: "你好" },
        {
          id: "cast",
          type: "setStageCast",
          members: [
            { characterId: "a", positionId: "left", distance: "medium" },
            { characterId: "b", positionId: "right", distance: "near" },
          ],
        },
        { id: "line-b", type: "dialogue", characterId: "b", text: "到了" },
        {
          id: "remove-a",
          type: "removeCharacter",
          all: false,
          characterId: "a",
        },
      ],
    } as unknown as GalgameStoryFragment;
    const document = {
      schemaVersion: "1.4",
      synopsis: "",
      entryChapterId: "chapter",
      characters: [
        { id: "a", name: "A", expressions: [], attributes: {} },
        { id: "b", name: "B", expressions: [], attributes: {} },
      ],
      scenes: [{ id: "room", name: "Room", description: "", layers: [] }],
      cgs: [],
      variables: [],
      assets: [],
      chapters: [
        {
          id: "chapter",
          title: "Chapter",
          order: 1,
          entryFragmentId: fragment.id,
          fragments: [fragment],
        },
      ],
    } as unknown as GalgameStoryProject;

    const index = buildStageStateIndex(document, fragment);
    expect(index.traversalCount).toBe(fragment.blocks?.length);
    fragment.blocks?.forEach((block, blockIndex) => {
      expect(index.afterBlock.get(block.id)).toEqual(
        replayStageToBlock(document, fragment, blockIndex),
      );
    });
  });
});
