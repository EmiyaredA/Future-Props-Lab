import type { CSSProperties, ReactNode } from "react";
import type {
  GalgameStoryBlock,
  GalgameStoryCgOverlay,
  GalgameStoryFragment,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";

export type FastPreviewCursor = {
  chapterId: string;
  fragmentId: string;
  blockIndex?: number;
};
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
  lastPublishedPositionMs: number;
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

export function cameraEasingCss(value?: string) {
  return value
    ?.replace("easeInOut", "ease-in-out")
    .replace("easeIn", "ease-in")
    .replace("easeOut", "ease-out");
}

export function storyPlayerCameraPlaneStyle(
  camera: GalgameStageState["camera"],
  target: "background" | "characters" | "cg",
): CSSProperties | undefined {
  if (!camera || (camera.target !== "stage" && camera.target !== target)) {
    return undefined;
  }
  return {
    transform: `translate(${camera.x}%, ${camera.y}%) scale(${camera.scale}) rotate(${camera.rotation}deg)`,
    transition: `transform ${camera.durationMs}ms ${cameraEasingCss(camera.easing)}`,
    animationDuration: `${camera.durationMs}ms`,
    "--galgame-camera-intensity": camera.intensity,
  } as CSSProperties;
}

export function playerAdvanceIndicatorText({
  compact,
  advanceMode,
  visibleTextLength,
  textLength,
  editing,
  waiting,
}: {
  compact: boolean;
  advanceMode: "manual" | "auto" | "skip";
  visibleTextLength: number;
  textLength: number;
  editing: boolean;
  waiting: boolean;
}) {
  if (compact)
    return advanceMode === "auto"
      ? "AUTO"
      : visibleTextLength < textLength
        ? "TEXT"
        : "NEXT";
  if (editing) return "编辑预览";
  if (waiting) return "等待玩家继续";
  if (visibleTextLength < textLength) return "点击显示全文";
  return advanceMode === "auto" ? "自动播放" : "点击继续";
}

export interface StoryPlayerHandle {
  restart: () => void;
  advance: () => void;
  togglePlayback: () => void;
  seekTimeline: (positionMs: number) => void;
  previousDialogue: () => void;
  nextDialogue: () => void;
}

export type StoryPlayerRuntimeSnapshot = {
  frame: PlayerFrame;
  stage: GalgameStageState;
  variables: Record<string, string | number | boolean>;
  chapterId: string;
  fragmentId: string;
  blockIndex: number;
  positionMs: number;
  durationMs?: number;
  playing: boolean;
  advanceMode: "manual" | "auto" | "skip";
};

export function playerFrameCursor(
  frame: PlayerFrame,
  fallback: { fragmentId: string; blockIndex: number },
) {
  return {
    fragmentId:
      frame.mode === "content" || frame.mode === "stageOnly"
        ? frame.fragmentId
        : fallback.fragmentId,
    blockIndex:
      frame.mode === "content" ? frame.blockIndex : fallback.blockIndex,
  };
}

export type StoryPlayerPlaybackRange = {
  fragmentId: string;
  startMs: number;
  endMs: number;
  loop?: boolean;
  autoPlay?: boolean;
};

export type StoryPlayerProps = {
  document: GalgameStoryProject;
  preloadFileIds?: string[];
  previewExpressionIds?: Record<string, string>;
  locale?: string;
  includeStaleTranslations?: boolean;
  startCursor?: { chapterId: string; fragmentId: string; blockIndex?: number };
  mode?: "edit" | "play";
  suppressMissingPortraitFallback?: boolean;
  showAuthoringOverlays?: boolean;
  chrome?: "full" | "stage-only";
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
  onRuntimeSnapshot?: (snapshot: StoryPlayerRuntimeSnapshot) => void;
  playbackRange?: StoryPlayerPlaybackRange;
  exportMode?: {
    branchSelections: Record<string, string>;
    choiceDurationMs: number;
    choiceHighlightMs: number;
    timelineRange?: {
      fragmentId: string;
      startMs: number;
      endMs: number;
    };
    onProgress?: (position: {
      chapterId: string;
      fragmentId: string;
      positionMs: number;
      blockId?: string;
    }) => void;
    onComplete?: (result: { ok: boolean; label: string }) => void;
    onAudioEvent?: (event: {
      action: "play" | "stop";
      channel: "voice" | "bgm" | "ambient" | "sfx" | "video";
      storyAssetId?: string;
      offsetMs?: number;
      volume?: number;
      loop?: boolean;
      fadeMs?: number;
    }) => void;
  };
};
