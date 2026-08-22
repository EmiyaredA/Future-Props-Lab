import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import { dialogueSpeakerIds } from "@features/galgame-workshop/editor/dialogue";

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

export function referencesForCharacter(
  document: GalgameStoryProject,
  characterId: string,
) {
  return (document.chapters ?? []).flatMap((chapter) =>
    (chapter.fragments ?? []).flatMap((fragment) =>
      (fragment.blocks ?? []).flatMap((block, blockIndex) => {
        const castMember =
          block.type === "setStageCast"
            ? (block.members ?? []).find(
                (member) => member.characterId === characterId,
              )
            : undefined;
        const referenced =
          block.type === "dialogue"
            ? dialogueSpeakerIds(block).includes(characterId)
            : (block.type === "showCharacter" ||
                  block.type === "removeCharacter") &&
                block.characterId === characterId
              ? true
              : Boolean(castMember);
        if (!referenced) return [];
        return [
          {
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
          },
        ];
      }),
    ),
  );
}
