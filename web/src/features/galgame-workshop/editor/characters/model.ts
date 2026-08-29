import type {
  GalgameStoryCharacter,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { dialogueSpeakerIds } from "@features/galgame-workshop/editor/dialogue";

export type CharacterReference = {
  kind: "dialogue" | "showCharacter" | "setStageCast" | "removeCharacter";
  chapterId: string;
  chapterTitle: string;
  fragmentId: string;
  fragmentTitle: string;
  blockId: string;
  blockIndex: number;
  text: string;
  expressionId?: string | null;
};

export type CharacterWorkspaceMode = "character" | "stage" | "templates";
export type CharacterReferenceTab = "preview" | "references";
export type SortPlacement = "before" | "after";
export type SortDropTarget = { id: string; placement: SortPlacement };

export const CHARACTER_PALETTE = [
  "#E75B55",
  "#4AA3DF",
  "#46B978",
  "#A56DE2",
  "#E59B3D",
  "#D85E9D",
  "#32A6A0",
  "#7586E5",
];

export const characterStageScopeKey = (projectId: string) =>
  `future_props_galgame_character_stage_scope:${projectId}`;

export function reorderById<T extends { id: string }>(
  items: T[],
  sourceId: string,
  targetId: string,
  placement: SortPlacement,
) {
  if (sourceId === targetId) return items;
  const source = items.find((item) => item.id === sourceId);
  if (!source || !items.some((item) => item.id === targetId)) return items;
  const reordered = items.filter((item) => item.id !== sourceId);
  const targetIndex = reordered.findIndex((item) => item.id === targetId);
  reordered.splice(targetIndex + (placement === "after" ? 1 : 0), 0, source);
  return reordered;
}

export function characterPortraitAssetIds(characters: GalgameStoryCharacter[]) {
  return new Set(
    characters.flatMap((character) => [
      ...(character.expressions ?? []).flatMap((expression) => [
        expression.assetId,
        ...(expression.sequence?.frames.map((frame) => frame.assetId) ?? []),
      ]),
      ...(character.portraitSkins ?? []).flatMap((skin) =>
        (skin.overrides ?? []).map((override) => override.assetId),
      ),
    ]),
  );
}

export function referencesForCharacter(
  document: GalgameStoryProject,
  characterId: string,
) {
  const references: CharacterReference[] = [];
  for (const chapter of document.chapters ?? []) {
    for (const fragment of chapter.fragments ?? []) {
      for (const [blockIndex, block] of (fragment.blocks ?? []).entries()) {
        const castMember =
          block.type === "setStageCast"
            ? (block.members ?? []).find(
                (member) => member.characterId === characterId,
              )
            : undefined;
        if (
          (block.type !== "dialogue" &&
            block.type !== "showCharacter" &&
            block.type !== "setStageCast" &&
            block.type !== "removeCharacter") ||
          (block.type === "dialogue"
            ? !dialogueSpeakerIds(block).includes(characterId)
            : block.type === "setStageCast"
              ? !castMember
              : block.characterId !== characterId)
        )
          continue;
        references.push({
          kind: block.type,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          fragmentId: fragment.id,
          fragmentTitle: fragment.title,
          blockId: block.id,
          blockIndex,
          text:
            block.type === "dialogue"
              ? block.text
              : block.type === "showCharacter"
                ? "角色登场 / 调整"
                : block.type === "setStageCast"
                  ? "舞台构图"
                  : "角色退场",
          expressionId:
            block.type === "dialogue" || block.type === "showCharacter"
              ? block.expressionId
              : block.type === "setStageCast"
                ? castMember?.expressionId
                : undefined,
        });
      }
    }
  }
  return references;
}

export function displayLabel(filename: string, fallback: string) {
  const label = filename.replace(/\.[^.]+$/, "").trim();
  return label || fallback;
}
