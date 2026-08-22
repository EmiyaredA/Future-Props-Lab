import { useEffect, useRef, useState } from "react";
import type {
  GalgameStoryChapter,
  GalgameStoryFragment,
} from "@features/galgame-workshop/api";
import { fragmentById } from "@features/galgame-workshop/editor/model";
import type {
  PlayerFrame,
  StoryPlayerProps,
} from "@features/galgame-workshop/editor/storyPlayerModel";
import {
  effectivePointTime,
  projectFragmentTimeline,
  timelineCues,
  timelineEvents,
} from "@features/galgame-workshop/editor/timeline";

const PLAYBACK_FOLLOW_UPDATE_INTERVAL_MS = 200;

type PlaybackPosition = {
  chapterId: string;
  fragmentId: string;
  positionMs: number;
  blockId?: string;
};

export function useStoryPlayerPlaybackFollow({
  mode,
  displayFrame,
  chapter,
  chapterId,
  timelinePositionMs,
  onPlaybackPosition,
  onExportProgress,
}: {
  mode: "edit" | "play";
  displayFrame: PlayerFrame;
  chapter?: GalgameStoryChapter;
  chapterId: string;
  timelinePositionMs: number;
  onPlaybackPosition?: StoryPlayerProps["onPlaybackPosition"];
  onExportProgress?: (position: PlaybackPosition) => void;
}) {
  const lastReportRef = useRef({
    signature: "",
    reportedAt: Number.NEGATIVE_INFINITY,
  });

  useEffect(() => {
    if (
      mode !== "play" ||
      (displayFrame.mode !== "content" && displayFrame.mode !== "stageOnly")
    )
      return;
    const source = chapter
      ? fragmentById(chapter, displayFrame.fragmentId)
      : undefined;
    if (!source) return;
    const projected = projectFragmentTimeline(source);
    const blockId =
      displayFrame.mode === "content" ? displayFrame.block.id : undefined;
    const blockIndex = blockId
      ? projected.blocks?.findIndex((block) => block.id === blockId)
      : undefined;
    const projectedPosition =
      blockIndex != null && blockIndex >= 0
        ? (effectivePointTime(projected, blockIndex) ??
          timelineCues(projected).find((cue) => cue.block.id === blockId)
            ?.startMs ??
          0)
        : 0;
    const position = {
      chapterId,
      fragmentId: source.id,
      positionMs: source.timeline ? timelinePositionMs : projectedPosition,
      blockId,
    };
    onExportProgress?.(position);
    if (!onPlaybackPosition) return;

    const signature = `${position.chapterId}:${position.fragmentId}:${position.blockId ?? "stage"}`;
    const now = performance.now();
    const lastReport = lastReportRef.current;
    if (
      signature === lastReport.signature &&
      now - lastReport.reportedAt < PLAYBACK_FOLLOW_UPDATE_INTERVAL_MS
    )
      return;
    lastReportRef.current = { signature, reportedAt: now };
    onPlaybackPosition(position);
  }, [
    chapter,
    chapterId,
    displayFrame,
    mode,
    onExportProgress,
    onPlaybackPosition,
    timelinePositionMs,
  ]);
}

type TimelineRange = {
  fragmentId: string;
  startMs: number;
  endMs: number;
};

export function timelineExportBounds(
  fragment: GalgameStoryFragment,
  range: TimelineRange | undefined,
) {
  const durationMs = fragment.timeline?.durationMs ?? 0;
  const matchingRange = range?.fragmentId === fragment.id ? range : undefined;
  const startMs = Math.max(
    0,
    Math.min(durationMs, matchingRange?.startMs ?? 0),
  );
  return {
    range: matchingRange,
    startMs,
    endMs: Math.max(
      startMs,
      Math.min(durationMs, matchingRange?.endMs ?? durationMs),
    ),
  };
}

export function timelineExportVoiceOffset(
  range: TimelineRange | undefined,
  fragmentId: string | undefined,
  dialogueStartMs: number | null | undefined,
) {
  return range && range.fragmentId === fragmentId && dialogueStartMs != null
    ? Math.max(0, range.startMs - dialogueStartMs)
    : 0;
}

export function timelineExportVideoOffset(
  fragment: GalgameStoryFragment | undefined,
  videoAssetId: string | undefined,
  positionMs: number,
  range: TimelineRange | undefined,
) {
  if (!fragment || range?.fragmentId !== fragment.id || !videoAssetId) return 0;
  let startedAtMs: number | undefined;
  for (const event of timelineEvents(fragment)) {
    if (event.timeMs > positionMs) break;
    if (event.block.type !== "video") continue;
    if (event.block.action === "play" && event.block.assetId === videoAssetId)
      startedAtMs = event.timeMs;
    else if (event.block.action === "stop") startedAtMs = undefined;
  }
  return startedAtMs == null ? 0 : Math.max(0, positionMs - startedAtMs);
}

export function useStoryPlayerVideoUrl(
  fileId: string | undefined,
  objectUrl: (fileId: string) => Promise<string>,
) {
  const [videoUrl, setVideoUrl] = useState<string>();
  useEffect(() => {
    let active = true;
    if (!fileId) {
      setVideoUrl(undefined);
      return;
    }
    void objectUrl(fileId).then((url) => {
      if (active) setVideoUrl(url);
    });
    return () => {
      active = false;
    };
  }, [fileId, objectUrl]);
  return videoUrl;
}
