import {
  type GalgameStoryBlock,
  type GalgameStoryChapter,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import type { TimelinePreferences } from "@features/galgame-workshop/editor/timelinePreferences";
import { updateBlock } from "@features/galgame-workshop/editor/model";
import { replayStageToBlock } from "@features/galgame-workshop/editor/stage";
import {
  effectivePointTime,
  timelineCgRanges,
  timelineCharacterTiming,
} from "@features/galgame-workshop/editor/timeline";
import { dialogueDisplayName } from "@features/galgame-workshop/editor/richText";
import "@features/galgame-workshop/galgameStyles";
import "@features/galgame-workshop/galgame-script-workbench.css";
export function useBlockInspectorController({
  projectId,
  block,
  document,
  chapter,
  fragmentId,
  onDocument,
  onNotice,
  voiceStale,
  onVoiceStale,
  onVoiceFresh,
  onAutoMatchVoice,
  timelinePreferences,
  onMoveUp,
  onMoveDown,
  onDelete,
  canMoveUp,
  canMoveDown,
}: {
  projectId: string;
  block?: GalgameStoryBlock;
  document: GalgameStoryProject;
  chapter: GalgameStoryChapter;
  fragmentId: string;
  onDocument: (document: GalgameStoryProject) => void;
  onNotice: (message: string) => void;
  voiceStale: boolean;
  onVoiceStale: () => void;
  onVoiceFresh: () => void;
  onAutoMatchVoice: (blockId: string) => Promise<boolean>;
  timelinePreferences: TimelinePreferences;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  if (!block) return { status: "empty" as const };

  const patch = (updater: (current: GalgameStoryBlock) => GalgameStoryBlock) =>
    onDocument(updateBlock(document, fragmentId, block.id, updater));
  const fragment = chapter.fragments?.find((item) => item.id === fragmentId);
  const blockIndex = fragment?.blocks?.findIndex(
    (item) => item.id === block.id,
  );
  const presentationStage =
    fragment && blockIndex != null && blockIndex > 0
      ? replayStageToBlock(document, fragment, blockIndex - 1)
      : undefined;
  const pointTime =
    fragment && blockIndex != null && blockIndex >= 0
      ? effectivePointTime(fragment, blockIndex)
      : undefined;
  const cgRange =
    fragment && block.type === "showCg"
      ? timelineCgRanges(fragment).find(
          (range) => range.showBlock.id === block.id,
        )
      : undefined;
  const characterTiming =
    fragment &&
    (block.type === "showCharacter" || block.type === "removeCharacter")
      ? timelineCharacterTiming(fragment, block.id)
      : undefined;
  const dialogueTargets =
    fragment?.blocks?.filter((candidate) => candidate.type === "dialogue") ??
    [];
  const dialogueCharacter =
    block.type === "dialogue"
      ? (document.characters ?? []).find(
          (character) => character.id === block.characterId,
        )
      : undefined;
  const dialogueName =
    block.type === "dialogue"
      ? dialogueDisplayName(
          dialogueCharacter,
          block.displayNameId,
          Object.fromEntries(
            (document.variables ?? []).map((variable) => [
              variable.id,
              variable.defaultValue,
            ]),
          ),
        )
      : undefined;

  return {
    status: "ready" as const,
    projectId,
    block,
    document,
    chapter,
    fragmentId,
    onDocument,
    onNotice,
    voiceStale,
    onVoiceStale,
    onVoiceFresh,
    onAutoMatchVoice,
    timelinePreferences,
    onMoveUp,
    onMoveDown,
    onDelete,
    canMoveUp,
    canMoveDown,
    patch,
    fragment,
    presentationStage,
    pointTime,
    cgRange,
    characterTiming,
    dialogueTargets,
    dialogueCharacter,
    dialogueName,
  };
}
