import { transitionProgress } from "./previewTransitions";
import type { VideoEditorClip, VideoEditorTimedEffect } from "./types";

export type ActiveTimedEffect = VideoEditorTimedEffect & {
  progress: number;
  amount: number;
};

export const noTimedEffects: ActiveTimedEffect[] = [];

/** Effect clock is timeline-local, independent of source in, speed and seam handles. */
export function activeTimedEffects(
  clip: VideoEditorClip,
  localUs: number,
  fps = 30,
): ActiveTimedEffect[] {
  if (clip.kind !== "video" && clip.kind !== "image") return noTimedEffects;
  const active = (clip.timedEffects ?? []).flatMap((effect) => {
    if (
      localUs < effect.startUs ||
      localUs >= effect.startUs + effect.durationUs
    )
      return [];
    const start = effect.progressStart ?? 0;
    const end = effect.progressEnd ?? 1;
    const fraction =
      effect.kind === "flash" &&
      effect.durationUs <= Math.round(1_000_000 / fps)
        ? 0.5
        : (localUs - effect.startUs) / effect.durationUs;
    const progress = transitionProgress(
      start + (end - start) * fraction,
      1,
      effect.easing ?? "linear",
    );
    return [{ ...effect, progress, amount: Math.sin(Math.PI * progress) }];
  });
  return active.length ? active : noTimedEffects;
}

/** Retain the original envelope when a trim intersects an effect window. */
export function trimTimedEffects(
  effects: VideoEditorTimedEffect[],
  offsetUs: number,
  durationUs: number,
): VideoEditorTimedEffect[] {
  return effects.flatMap((effect) => {
    const start = Math.max(effect.startUs, offsetUs);
    const end = Math.min(
      effect.startUs + effect.durationUs,
      offsetUs + durationUs,
    );
    if (end <= start) return [];
    const phaseStart = effect.progressStart ?? 0;
    const phaseSpan = (effect.progressEnd ?? 1) - phaseStart;
    return [
      {
        ...effect,
        startUs: start - offsetUs,
        durationUs: end - start,
        progressStart:
          phaseStart +
          (phaseSpan * (start - effect.startUs)) / effect.durationUs,
        progressEnd:
          phaseStart + (phaseSpan * (end - effect.startUs)) / effect.durationUs,
      },
    ];
  });
}
