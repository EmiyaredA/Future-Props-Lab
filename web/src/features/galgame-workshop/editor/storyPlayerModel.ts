import type { ReactNode } from "react";
import type {
  GalgameStoryBlock,
  GalgameStoryCgOverlay,
  GalgameStoryFragment,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import type { GalgameStageState } from "@features/galgame-workshop/editor/stage";
import type {
  StageAspectMode,
  StageViewportPreferences,
} from "@features/galgame-workshop/editor/stageViewportPreferences";
import type { TimelineClock } from "@features/galgame-workshop/editor/timelineClock";
import {
  resolvedRichTextDocument,
  richTextPlainText,
} from "@features/galgame-workshop/editor/richText";
import type { StoryPlayerMixChannel } from "@features/galgame-workshop/editor/useStoryPlayerAudio";

export const STAGE_ASPECT_OPTIONS: StageAspectMode[] = [
  "auto",
  "16:9",
  "16:10",
  "4:3",
  "custom",
];

export const DEFAULT_STORY_PLAYER_MIX: Record<StoryPlayerMixChannel, number> = {
  voice: 100,
  bgm: 100,
  ambient: 100,
  sfx: 100,
};

export const clampPlayerValue = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export function playerContentText(
  block: GalgameStoryBlock,
  variables: Record<string, string | number | boolean> = {},
) {
  if (
    block.type === "dialogue" ||
    block.type === "narration" ||
    block.type === "storyParagraph" ||
    block.type === "floatingText"
  )
    return "content" in block && block.content
      ? richTextPlainText(resolvedRichTextDocument(block.content, variables)) ||
          "（空正文）"
      : block.text || "（空正文）";
  return undefined;
}

export type PlayerFrame =
  | { mode: "idle"; stage: GalgameStageState }
  | { mode: "stageOnly"; fragmentId: string; stage: GalgameStageState }
  | {
      mode: "content";
      fragmentId: string;
      blockIndex: number;
      block: GalgameStoryBlock;
      stage: GalgameStageState;
    }
  | { mode: "ending"; label: string; stage: GalgameStageState }
  | { mode: "error"; message: string; stage: GalgameStageState };

export type TimelinePlayback = {
  fragmentId: string;
  clock: TimelineClock;
  lastPositionMs: number;
};

export function playerHexToRgba(color: string, opacity: number) {
  const value = color.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgb(${red} ${green} ${blue} / ${opacity})`;
}

export function formatTimelineTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export interface StoryPlayerHandle {
  restart: () => void;
}

export type StoryPlayerProps = {
  document: GalgameStoryProject;
  locale?: string;
  includeStaleTranslations?: boolean;
  startCursor?: { chapterId: string; fragmentId: string; blockIndex?: number };
  mode?: "edit" | "play";
  editFragment?: GalgameStoryFragment;
  editBlockIndex?: number;
  editTimelinePositionMs?: number | null;
  editableCgBlockId?: string;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  viewportPreferences?: StageViewportPreferences;
  onViewportPreferencesChange?: (preferences: StageViewportPreferences) => void;
  headerModeControl?: ReactNode;
  workbenchHeader?: boolean;
  onCgOverlayChange?: (overlay: GalgameStoryCgOverlay) => void;
  onPlaybackPosition?: (position: {
    chapterId: string;
    fragmentId: string;
    positionMs: number;
    blockId?: string;
  }) => void;
};
