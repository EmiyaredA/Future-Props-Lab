import type {
  VideoEditorClip,
  VideoEditorTimelineTransition,
  VideoEditorTrack,
  VideoEditorTransition,
} from "./types";

export type PreviewTransitionEffect = {
  opacityMultiplier: number;
  scaleMultiplier: number;
  blurPx: number;
  clipPath?: string;
  flashOpacity: number;
  /** Override source local time (seam partners / handle continuity). */
  forceLocalUs?: number;
};

const ease = (progress: number, interpolation: string) => {
  const value = Math.max(0, Math.min(1, progress));
  if (interpolation === "ease-in") return value * value;
  if (interpolation === "ease-out") return 1 - (1 - value) ** 2;
  if (interpolation === "ease-in-out") return value * value * (3 - 2 * value);
  return value;
};

export function transitionProgress(
  valueUs: number,
  durationUs: number,
  interpolation: string,
) {
  return ease(valueUs / Math.max(1, durationUs), interpolation);
}

function wipeClipPath(
  progress: number,
  direction:
    | VideoEditorTimelineTransition["direction"]
    | VideoEditorTransition["direction"],
) {
  let reveal = Math.max(0, Math.min(1, progress));
  if (direction === "right" || direction === "up" || direction === "down") {
    reveal = 1 - reveal;
  }
  const hidden = `${((1 - reveal) * 100).toFixed(3)}%`;
  if (direction === "right") return `inset(0 0 0 ${hidden})`;
  if (direction === "up") return `inset(${hidden} 0 0 0)`;
  if (direction === "down") return `inset(0 0 ${hidden} 0)`;
  return `inset(0 ${hidden} 0 0)`;
}

function effectForVisualKind(
  kind: string,
  progress: number,
  direction: string,
  flashWhen: "early" | "late" | "none",
): PreviewTransitionEffect {
  const effect: PreviewTransitionEffect = {
    opacityMultiplier: progress,
    scaleMultiplier: 1,
    blurPx: 0,
    flashOpacity: 0,
  };
  if (kind === "zoom") effect.scaleMultiplier = 1 + 0.22 * progress;
  if (kind === "blur")
    effect.blurPx = Math.max(0, Math.round((1 - progress) * 10));
  if (kind === "wipe-left" || kind === "wipe-right") {
    effect.clipPath = wipeClipPath(
      progress,
      direction as VideoEditorTimelineTransition["direction"],
    );
  }
  if (kind === "flash" && flashWhen === "early") {
    const fade = Math.max(0, 1 - progress / 0.55);
    effect.flashOpacity = fade * 0.92;
  }
  return effect;
}

const identityEffect = (): PreviewTransitionEffect => ({
  opacityMultiplier: 1,
  scaleMultiplier: 1,
  blurPx: 0,
  flashOpacity: 0,
});

function multiplyEffects(
  base: PreviewTransitionEffect,
  extra: PreviewTransitionEffect,
): PreviewTransitionEffect {
  return {
    opacityMultiplier: base.opacityMultiplier * extra.opacityMultiplier,
    scaleMultiplier: base.scaleMultiplier * extra.scaleMultiplier,
    blurPx: Math.max(base.blurPx, extra.blurPx),
    clipPath: extra.clipPath ?? base.clipPath,
    flashOpacity: Math.max(base.flashOpacity, extra.flashOpacity),
    forceLocalUs: base.forceLocalUs ?? extra.forceLocalUs,
  };
}

/** Clip-local edge effect from transitionIn / transitionOut. */
export function clipEdgePreviewEffect(
  clip: VideoEditorClip,
  localUs: number,
): PreviewTransitionEffect | null {
  const transitionIn = clip.transitionIn;
  if (
    transitionIn &&
    transitionIn.durationUs > 0 &&
    transitionIn.kind !== "audio-crossfade" &&
    localUs >= 0 &&
    localUs < transitionIn.durationUs
  ) {
    const progress = transitionProgress(
      localUs,
      transitionIn.durationUs,
      transitionIn.easing ?? "linear",
    );
    return effectForVisualKind(
      transitionIn.kind,
      progress,
      transitionIn.direction ?? "in",
      "early",
    );
  }
  const transitionOut = clip.transitionOut;
  if (
    transitionOut &&
    transitionOut.durationUs > 0 &&
    transitionOut.kind !== "audio-crossfade"
  ) {
    const remaining = clip.durationUs - localUs;
    if (remaining >= 0 && remaining < transitionOut.durationUs) {
      const through = transitionProgress(
        transitionOut.durationUs - remaining,
        transitionOut.durationUs,
        transitionOut.easing ?? "linear",
      );
      const visibility = 1 - through;
      return effectForVisualKind(
        transitionOut.kind,
        visibility,
        transitionOut.direction ?? "out",
        "early",
      );
    }
  }
  return null;
}

function seamWindow(between: VideoEditorTimelineTransition, seamUs: number) {
  const halfUs = Math.max(1, Math.floor(between.durationUs / 2));
  return {
    halfUs,
    startUs: seamUs - halfUs,
    endUs: seamUs + halfUs,
  };
}

/** Resolve DOM-preview effect for one clip at the playhead. */
export function previewTransitionEffectForClip(
  clip: VideoEditorClip,
  playheadUs: number,
  transitions: VideoEditorTimelineTransition[],
  clipsById: Map<string, VideoEditorClip>,
): PreviewTransitionEffect {
  const localUs = playheadUs - clip.timelineStartUs;
  const between = transitions.find(
    (item) =>
      item.placement === "between" &&
      (item.fromClipId === clip.id || item.toClipId === clip.id),
  );
  if (between?.fromClipId && between.toClipId) {
    const left = clipsById.get(between.fromClipId);
    const right = clipsById.get(between.toClipId);
    if (left && right) {
      const seamUs = right.timelineStartUs;
      const { halfUs, startUs, endUs } = seamWindow(between, seamUs);
      if (startUs <= playheadUs && playheadUs < endUs) {
        const progress = transitionProgress(
          playheadUs - startUs,
          between.durationUs,
          between.easing,
        );
        if (between.kind === "flash") {
          if (clip.id === left.id && playheadUs < seamUs) {
            const first = Math.max(
              0,
              Math.min(1, (playheadUs - startUs) / halfUs),
            );
            return multiplyEffects(
              {
                ...identityEffect(),
                flashOpacity: first * 0.9,
                forceLocalUs: Math.max(
                  0,
                  Math.min(left.durationUs - 1, playheadUs - left.timelineStartUs),
                ),
              },
              clipEdgePreviewEffect(left, playheadUs - left.timelineStartUs) ??
                identityEffect(),
            );
          }
          if (clip.id === right.id && playheadUs >= seamUs) {
            const second = Math.max(
              0,
              Math.min(1, (playheadUs - seamUs) / halfUs),
            );
            return multiplyEffects(
              {
                ...identityEffect(),
                flashOpacity: (1 - second) * 0.9,
                forceLocalUs: Math.max(0, playheadUs - seamUs),
              },
              clipEdgePreviewEffect(right, playheadUs - right.timelineStartUs) ??
                identityEffect(),
            );
          }
          // Other side stays hidden during its inactive flash half.
          return { ...identityEffect(), opacityMultiplier: 0 };
        }

        if (clip.id === left.id) {
          const leftLocalUs =
            playheadUs < seamUs
              ? Math.max(
                  0,
                  Math.min(
                    left.durationUs - 1,
                    playheadUs - left.timelineStartUs,
                  ),
                )
              : Math.max(0, left.durationUs - 1);
          return multiplyEffects(
            {
              ...identityEffect(),
              opacityMultiplier: 1 - progress,
              forceLocalUs: leftLocalUs,
            },
            clipEdgePreviewEffect(left, playheadUs - left.timelineStartUs) ??
              identityEffect(),
          );
        }
        if (clip.id === right.id) {
          const rightLocalUs = Math.max(
            0,
            Math.min(right.durationUs - 1, playheadUs - startUs),
          );
          return multiplyEffects(
            {
              ...effectForVisualKind(
                between.kind,
                progress,
                between.direction,
                "none",
              ),
              forceLocalUs: rightLocalUs,
            },
            clipEdgePreviewEffect(right, playheadUs - right.timelineStartUs) ??
              identityEffect(),
          );
        }
      }

      // After a non-flash centered window, keep incoming media time continuous
      // from the window start (matches export evaluator continuity).
      if (
        between.kind !== "flash" &&
        clip.id === between.toClipId &&
        playheadUs >= endUs
      ) {
        const continuousLocalUs = playheadUs - startUs;
        if (continuousLocalUs >= clip.durationUs) {
          return { ...identityEffect(), opacityMultiplier: 0 };
        }
        return multiplyEffects(
          {
            ...identityEffect(),
            forceLocalUs: continuousLocalUs,
          },
          clipEdgePreviewEffect(clip, localUs) ?? identityEffect(),
        );
      }
    }
  }

  if (localUs < 0) return identityEffect();
  return clipEdgePreviewEffect(clip, localUs) ?? identityEffect();
}

export type PreviewVisualLayer = {
  clip: VideoEditorClip;
  localUs: number;
  effect: PreviewTransitionEffect;
};

/**
 * Visual layers for the program monitor, including seam partners across the
 * centered transition window.
 */
export function previewVisualLayers(
  tracks: VideoEditorTrack[],
  playheadUs: number,
  transitions: VideoEditorTimelineTransition[],
): PreviewVisualLayer[] {
  const visualTracks = tracks
    .filter(
      (track) =>
        (track.kind === "visual" || track.kind === "mixed") && !track.hidden,
    )
    .sort((left, right) => right.order - left.order);
  const clipsById = new Map(
    visualTracks.flatMap((track) =>
      (track.clips ?? []).map((clip) => [clip.id, clip] as const),
    ),
  );
  const layers: PreviewVisualLayer[] = [];
  const seen = new Set<string>();

  for (const track of visualTracks) {
    const clips = [...(track.clips ?? [])].sort(
      (left, right) => left.timelineStartUs - right.timelineStartUs,
    );
    for (const clip of clips) {
      const inRange =
        clip.timelineStartUs <= playheadUs &&
        clip.timelineStartUs + clip.durationUs > playheadUs;
      const betweenAsTo = transitions.find(
        (item) =>
          item.placement === "between" &&
          item.toClipId === clip.id &&
          item.fromClipId,
      );
      const betweenAsFrom = transitions.find(
        (item) =>
          item.placement === "between" &&
          item.fromClipId === clip.id &&
          item.toClipId,
      );
      const seamPartner =
        betweenAsTo || betweenAsFrom
          ? (() => {
              const between = (betweenAsTo ?? betweenAsFrom)!;
              const seamUs = betweenAsTo
                ? clip.timelineStartUs
                : (clipsById.get(between.toClipId)?.timelineStartUs ?? 0);
              const { startUs, endUs } = seamWindow(between, seamUs);
              return startUs <= playheadUs && playheadUs < endUs;
            })()
          : false;
      if (!inRange && !seamPartner) continue;
      if (seen.has(clip.id)) continue;
      seen.add(clip.id);
      const effect = previewTransitionEffectForClip(
        clip,
        playheadUs,
        transitions,
        clipsById,
      );
      if (effect.opacityMultiplier <= 0 && effect.flashOpacity <= 0) continue;
      layers.push({
        clip,
        localUs: effect.forceLocalUs ?? playheadUs - clip.timelineStartUs,
        effect,
      });
    }
  }

  return layers;
}

export function mergeFlashOpacity(layers: PreviewVisualLayer[]) {
  return layers.reduce(
    (max, layer) => Math.max(max, layer.effect.flashOpacity),
    0,
  );
}
