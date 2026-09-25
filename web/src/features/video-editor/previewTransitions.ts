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
  overlayColor?: "#000000" | "#ffffff";
  overlayOpacity: number;
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
  const reveal = Math.max(0, Math.min(1, progress));
  const hidden = `${((1 - reveal) * 100).toFixed(3)}%`;
  if (direction === "left") return `inset(0 0 0 ${hidden})`;
  if (direction === "right") return `inset(0 ${hidden} 0 0)`;
  if (direction === "up") return `inset(${hidden} 0 0 0)`;
  if (direction === "down") return `inset(0 0 ${hidden} 0)`;
  return `inset(0 0 0 ${hidden})`;
}

function effectForVisualKind(
  kind: string,
  visibility: number,
  direction: string,
  pulse: boolean,
): PreviewTransitionEffect {
  const normalizedKind =
    kind === "wipe-left" || kind === "wipe-right" ? "wipe" : kind;
  const effect: PreviewTransitionEffect = {
    opacityMultiplier:
      normalizedKind === "wipe" ||
      normalizedKind === "fade-black" ||
      normalizedKind === "fade-white"
        ? 1
        : visibility,
    scaleMultiplier: 1,
    blurPx: 0,
    overlayOpacity: 0,
  };
  if (normalizedKind === "zoom") {
    effect.scaleMultiplier = 1 + 0.22 * (1 - visibility);
  }
  if (normalizedKind === "blur") {
    effect.blurPx = Math.max(0, (1 - visibility) * 10);
  }
  if (normalizedKind === "wipe") {
    const legacyDirection =
      kind === "wipe-right"
        ? "right"
        : kind === "wipe-left"
          ? "left"
          : direction;
    effect.clipPath = wipeClipPath(
      visibility,
      legacyDirection as VideoEditorTimelineTransition["direction"],
    );
  }
  if (normalizedKind === "fade-black" || normalizedKind === "fade-white") {
    effect.overlayColor =
      normalizedKind === "fade-black" ? "#000000" : "#ffffff";
    effect.overlayOpacity = 1 - visibility;
  }
  if (normalizedKind === "flash" && pulse) {
    effect.overlayColor = "#ffffff";
    effect.overlayOpacity = Math.max(0, 1 - visibility / 0.55) * 0.92;
  }
  return effect;
}

const identityEffect = (): PreviewTransitionEffect => ({
  opacityMultiplier: 1,
  scaleMultiplier: 1,
  blurPx: 0,
  overlayOpacity: 0,
});

function multiplyEffects(
  base: PreviewTransitionEffect,
  extra: PreviewTransitionEffect,
): PreviewTransitionEffect {
  const overlay = extra.overlayOpacity >= base.overlayOpacity ? extra : base;
  return {
    opacityMultiplier: base.opacityMultiplier * extra.opacityMultiplier,
    scaleMultiplier: base.scaleMultiplier * extra.scaleMultiplier,
    blurPx: Math.max(base.blurPx, extra.blurPx),
    clipPath: extra.clipPath ?? base.clipPath,
    overlayColor: overlay.overlayColor,
    overlayOpacity: overlay.overlayOpacity,
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
    const visibility = transitionProgress(
      localUs,
      transitionIn.durationUs,
      transitionIn.easing ?? "linear",
    );
    return effectForVisualKind(
      transitionIn.kind,
      visibility,
      transitionIn.direction ?? "left",
      true,
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
      return effectForVisualKind(
        transitionOut.kind,
        1 - through,
        transitionOut.direction ?? "left",
        true,
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

function activeSeamForClip(
  clip: VideoEditorClip,
  playheadUs: number,
  transitions: VideoEditorTimelineTransition[],
  clipsById: Map<string, VideoEditorClip>,
) {
  return transitions.find((item) => {
    if (
      item.kind === "audio-crossfade" ||
      item.placement !== "between" ||
      (item.fromClipId !== clip.id && item.toClipId !== clip.id)
    )
      return false;
    const left = clipsById.get(item.fromClipId ?? "");
    const right = clipsById.get(item.toClipId ?? "");
    if (!left || !right || left.trackId !== right.trackId) return false;
    const { startUs, endUs } = seamWindow(item, right.timelineStartUs);
    return startUs <= playheadUs && playheadUs < endUs;
  });
}

function mediaLocalUs(
  clip: VideoEditorClip,
  playheadUs: number,
  transitions: VideoEditorTimelineTransition[],
  clipsById: Map<string, VideoEditorClip>,
) {
  const incoming = transitions.find(
    (item) =>
      item.kind !== "audio-crossfade" &&
      item.placement === "between" &&
      item.toClipId === clip.id &&
      clipsById.get(item.fromClipId ?? "")?.trackId === clip.trackId,
  );
  const offset =
    incoming && incoming.kind !== "flash"
      ? Math.max(1, Math.floor(incoming.durationUs / 2))
      : 0;
  return Math.max(
    0,
    Math.min(clip.durationUs - 1, playheadUs - clip.timelineStartUs + offset),
  );
}

/** Resolve DOM-preview effect for one clip at the playhead. */
export function previewTransitionEffectForClip(
  clip: VideoEditorClip,
  playheadUs: number,
  transitions: VideoEditorTimelineTransition[],
  clipsById: Map<string, VideoEditorClip>,
): PreviewTransitionEffect {
  const localUs = playheadUs - clip.timelineStartUs;
  const between = activeSeamForClip(clip, playheadUs, transitions, clipsById);
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
                overlayColor: "#ffffff",
                overlayOpacity: first * 0.9,
                forceLocalUs: mediaLocalUs(
                  left,
                  playheadUs,
                  transitions,
                  clipsById,
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
                overlayColor: "#ffffff",
                overlayOpacity: (1 - second) * 0.9,
                forceLocalUs: mediaLocalUs(
                  right,
                  playheadUs,
                  transitions,
                  clipsById,
                ),
              },
              clipEdgePreviewEffect(
                right,
                playheadUs - right.timelineStartUs,
              ) ?? identityEffect(),
            );
          }
          return { ...identityEffect(), opacityMultiplier: 0 };
        }

        if (between.kind === "fade-black" || between.kind === "fade-white") {
          const active = progress < 0.5 ? left : right;
          if (clip.id !== active.id) {
            return { ...identityEffect(), opacityMultiplier: 0 };
          }
          const overlayOpacity =
            progress < 0.5 ? progress * 2 : (1 - progress) * 2;
          return multiplyEffects(
            {
              ...identityEffect(),
              overlayColor:
                between.kind === "fade-black" ? "#000000" : "#ffffff",
              overlayOpacity,
              forceLocalUs: mediaLocalUs(
                active,
                playheadUs,
                transitions,
                clipsById,
              ),
            },
            clipEdgePreviewEffect(
              active,
              playheadUs - active.timelineStartUs,
            ) ?? identityEffect(),
          );
        }

        if (clip.id === left.id) {
          const leftEffect =
            between.kind === "wipe" ||
            between.kind === "wipe-left" ||
            between.kind === "wipe-right"
              ? identityEffect()
              : effectForVisualKind(
                  between.kind,
                  1 - progress,
                  between.direction,
                  false,
                );
          return multiplyEffects(
            {
              ...leftEffect,
              forceLocalUs: mediaLocalUs(
                left,
                playheadUs,
                transitions,
                clipsById,
              ),
            },
            clipEdgePreviewEffect(left, playheadUs - left.timelineStartUs) ??
              identityEffect(),
          );
        }
        if (clip.id === right.id) {
          return multiplyEffects(
            {
              ...effectForVisualKind(
                between.kind,
                progress,
                between.direction,
                false,
              ),
              forceLocalUs: mediaLocalUs(
                right,
                playheadUs,
                transitions,
                clipsById,
              ),
            },
            clipEdgePreviewEffect(right, playheadUs - right.timelineStartUs) ??
              identityEffect(),
          );
        }
      }
    }
  }

  if (localUs < 0) return identityEffect();
  return {
    ...(clipEdgePreviewEffect(clip, localUs) ?? identityEffect()),
    forceLocalUs: mediaLocalUs(clip, playheadUs, transitions, clipsById),
  };
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
      const seamPartner = activeSeamForClip(
        clip,
        playheadUs,
        transitions,
        clipsById,
      );
      if (!inRange && !seamPartner) continue;
      if (seen.has(clip.id)) continue;
      seen.add(clip.id);
      const effect = previewTransitionEffectForClip(
        clip,
        playheadUs,
        transitions,
        clipsById,
      );
      if (effect.opacityMultiplier <= 0 && effect.overlayOpacity <= 0) continue;
      layers.push({
        clip,
        localUs: effect.forceLocalUs ?? playheadUs - clip.timelineStartUs,
        effect,
      });
    }
  }

  return layers;
}

export function mergeTransitionOverlay(layers: PreviewVisualLayer[]) {
  return layers.reduce(
    (current, layer) =>
      layer.effect.overlayOpacity > current.opacity
        ? {
            color: layer.effect.overlayColor ?? "#ffffff",
            opacity: layer.effect.overlayOpacity,
          }
        : current,
    { color: "#ffffff" as "#000000" | "#ffffff", opacity: 0 },
  );
}
