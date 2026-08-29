import type {
  GalgameStoryCharacter,
  GalgameStoryCharacterExpression,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  characterPortraitAssetIds,
  reorderById,
  type CharacterReference,
  type SortPlacement,
} from "@features/galgame-workshop/editor/characters/model";

export function useCharacterCollectionActions({
  document,
  characters,
  selectedCharacter,
  expressions,
  references,
  selectedExpressionIds,
  updateCharacter,
  onDocument,
  onNotice,
  setSelectedCharacterId,
  setSelectedExpressionId,
  setSelectedExpressionIds,
}: {
  document: GalgameStoryProject;
  characters: GalgameStoryCharacter[];
  selectedCharacter?: GalgameStoryCharacter;
  expressions: GalgameStoryCharacterExpression[];
  references: CharacterReference[];
  selectedExpressionIds: Set<string>;
  updateCharacter: (
    characterId: string,
    updater: (character: GalgameStoryCharacter) => GalgameStoryCharacter,
  ) => void;
  onDocument: (document: GalgameStoryProject) => void;
  onNotice: (message: string) => void;
  setSelectedCharacterId: (id: string | undefined) => void;
  setSelectedExpressionId: (id: string | undefined) => void;
  setSelectedExpressionIds: (ids: Set<string>) => void;
}) {
  const deleteExpression = (expression: GalgameStoryCharacterExpression) => {
    if (!selectedCharacter) return;
    const explicit = references.filter(
      (reference) => reference.expressionId === expression.id,
    );
    if (explicit.length) {
      onNotice(`无法删除：表情仍被 ${explicit.length} 处剧本演出显式引用。`);
      return;
    }
    if (
      selectedCharacter.defaultExpressionId === expression.id &&
      expressions.length > 1
    ) {
      onNotice("请先将其他表情设为默认，再删除当前默认表情。");
      return;
    }
    const remaining = expressions.filter((item) => item.id !== expression.id);
    const nextCharacters = characters.map((character) =>
      character.id === selectedCharacter.id
        ? {
            ...character,
            expressions: remaining,
            defaultExpressionId: remaining.length
              ? character.defaultExpressionId
              : null,
          }
        : character,
    );
    const usedPortraitAssets = characterPortraitAssetIds(nextCharacters);
    onDocument({
      ...document,
      assets: (document.assets ?? []).filter(
        (asset) =>
          asset.type !== "image" ||
          asset.role !== "characterPortrait" ||
          usedPortraitAssets.has(asset.id),
      ),
      characters: nextCharacters,
    });
    setSelectedExpressionId(remaining[0]?.id);
  };

  const deleteSelectedExpressions = () => {
    if (!selectedCharacter || !selectedExpressionIds.size) return;
    const selected = new Set(selectedExpressionIds);
    const referenced = references.filter(
      (reference) =>
        reference.expressionId && selected.has(reference.expressionId),
    );
    if (referenced.length) {
      onNotice(`无法批量删除：所选表情仍被 ${referenced.length} 处演出引用。`);
      return;
    }
    if (
      selectedCharacter.defaultExpressionId &&
      selected.has(selectedCharacter.defaultExpressionId)
    ) {
      onNotice("默认表情不能批量删除，请先指定新的默认表情。");
      return;
    }
    const remaining = expressions.filter(
      (expression) => !selected.has(expression.id),
    );
    const nextCharacters = characters.map((character) =>
      character.id === selectedCharacter.id
        ? { ...character, expressions: remaining }
        : character,
    );
    const usedPortraitAssets = characterPortraitAssetIds(nextCharacters);
    onDocument({
      ...document,
      assets: (document.assets ?? []).filter(
        (asset) =>
          asset.type !== "image" ||
          asset.role !== "characterPortrait" ||
          usedPortraitAssets.has(asset.id),
      ),
      characters: nextCharacters,
    });
    setSelectedExpressionIds(new Set());
    setSelectedExpressionId(remaining[0]?.id);
  };

  const moveExpression = (
    sourceId: string,
    targetId: string,
    placement: SortPlacement,
  ) => {
    if (!selectedCharacter) return;
    const reordered = reorderById(expressions, sourceId, targetId, placement);
    if (reordered === expressions) return;
    updateCharacter(selectedCharacter.id, (character) => ({
      ...character,
      expressions: reordered,
    }));
  };

  const moveExpressionByOffset = (expressionId: string, offset: -1 | 1) => {
    const sourceIndex = expressions.findIndex(
      (expression) => expression.id === expressionId,
    );
    const target = expressions[sourceIndex + offset];
    if (!target) return;
    moveExpression(expressionId, target.id, offset < 0 ? "before" : "after");
  };

  const deleteCharacter = () => {
    if (!selectedCharacter) return;
    if (references.length) {
      onNotice(`无法删除：角色仍被 ${references.length} 处剧本演出引用。`);
      return;
    }
    const remainingCharacters = characters.filter(
      (character) => character.id !== selectedCharacter.id,
    );
    const usedPortraitAssets = characterPortraitAssetIds(remainingCharacters);
    const characterStageOverrides = {
      ...(document.settings?.characterStageOverrides ?? {}),
    };
    delete characterStageOverrides[selectedCharacter.id];
    onDocument({
      ...document,
      characters: remainingCharacters,
      settings: { ...(document.settings ?? {}), characterStageOverrides },
      assets: (document.assets ?? []).filter(
        (asset) =>
          asset.type !== "image" ||
          asset.role !== "characterPortrait" ||
          usedPortraitAssets.has(asset.id),
      ),
    });
    setSelectedCharacterId(remainingCharacters[0]?.id);
  };

  return {
    deleteExpression,
    deleteSelectedExpressions,
    moveExpression,
    moveExpressionByOffset,
    deleteCharacter,
  };
}
