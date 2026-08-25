import type { GalgameStoryFragment } from "@features/galgame-workshop/api";
import { timelinePlaybackSteps } from "@features/galgame-workshop/editor/timeline";

export const DEFAULT_VIDEO_CLIP_DURATION_MS = 10_000;
export const MAX_VIDEO_CLIP_DURATION_MS = 300_000;

export type VideoClipRange = { startMs: number; endMs: number };

export function defaultVideoClipRange(
  durationMs: number,
  positionMs = 0,
): VideoClipRange {
  const duration = Math.max(0, Math.round(durationMs));
  const position = Math.max(0, Math.min(duration, Math.round(positionMs)));
  if (position >= duration) {
    return {
      startMs: Math.max(0, duration - DEFAULT_VIDEO_CLIP_DURATION_MS),
      endMs: duration,
    };
  }
  return {
    startMs: position,
    endMs: Math.min(duration, position + DEFAULT_VIDEO_CLIP_DURATION_MS),
  };
}

export function videoClipRangeError(
  range: VideoClipRange,
  durationMs?: number,
) {
  if (durationMs == null) return "当前 Fragment 没有时间轴，无法快速试片";
  if (range.startMs < 0) return "开始时间不能早于 00:00.000";
  if (range.endMs > durationMs) return "结束时间不能超过 Fragment 时长";
  if (range.startMs >= range.endMs) return "结束时间必须晚于开始时间";
  if (range.endMs - range.startMs > MAX_VIDEO_CLIP_DURATION_MS)
    return "快速试片最长为 5 分钟";
  return "";
}

export function selectedBlockClipRange(
  fragment: GalgameStoryFragment,
  blockIndex?: number | null,
) {
  if (!fragment.timeline || blockIndex == null) return undefined;
  const block = fragment.blocks?.[blockIndex];
  if (
    block &&
    "startMs" in block &&
    "endMs" in block &&
    typeof block.startMs === "number" &&
    typeof block.endMs === "number"
  )
    return { startMs: block.startMs, endMs: block.endMs };
  const step = timelinePlaybackSteps(fragment).find(
    (candidate) => candidate.contentBlockIndex === blockIndex,
  );
  return step ? { startMs: step.startMs, endMs: step.endMs } : undefined;
}
