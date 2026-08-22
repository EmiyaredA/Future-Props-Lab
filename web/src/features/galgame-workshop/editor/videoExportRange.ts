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
