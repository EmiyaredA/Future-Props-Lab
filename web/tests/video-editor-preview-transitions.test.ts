import { describe, expect, it } from "vitest";
import {
  clipEdgePreviewEffect,
  mergeFlashOpacity,
  previewTransitionEffectForClip,
  previewVisualLayers,
} from "@features/video-editor/previewTransitions";
import type {
  VideoEditorClip,
  VideoEditorTimelineTransition,
  VideoEditorTrack,
} from "@features/video-editor/types";

const clip = (
  id: string,
  start: number,
  duration = 2_000_000,
): VideoEditorClip =>
  ({
    id,
    trackId: "v1",
    kind: "video",
    name: id,
    assetId: `${id}-asset`,
    timelineStartUs: start,
    durationUs: duration,
    sourceInUs: 0,
    sourceLoop: false,
    fitMode: "cover",
    flipX: false,
    fontSize: 72,
    textColor: "#ffffff",
    volume: 1,
    keyframes: [],
  }) as VideoEditorClip;

const track = (clips: VideoEditorClip[]): VideoEditorTrack => ({
  id: "v1",
  kind: "visual",
  name: "画面 1",
  order: 0,
  locked: false,
  hidden: false,
  muted: false,
  clips,
});

describe("previewTransitions", () => {
  it("flashes white near the start of a clip-local in transition", () => {
    const target = {
      ...clip("b", 1_000_000),
      transitionIn: {
        kind: "flash" as const,
        durationUs: 500_000,
        direction: "in" as const,
        easing: "linear" as const,
      },
    };
    const effect = clipEdgePreviewEffect(target, 0);
    expect(effect?.opacityMultiplier).toBe(0);
    expect(effect?.flashOpacity).toBeCloseTo(0.92, 5);
  });

  it("crossfades across a centered seam window", () => {
    const left = clip("a", 0);
    const right = clip("b", 2_000_000);
    const transition: VideoEditorTimelineTransition = {
      id: "t1",
      kind: "crossfade",
      durationUs: 500_000,
      placement: "between",
      fromClipId: left.id,
      toClipId: right.id,
      direction: "in",
      easing: "linear",
    };
    // Centered window [1.75s, 2.25s); mid at the seam.
    const layers = previewVisualLayers(
      [track([left, right])],
      2_000_000,
      [transition],
    );
    expect(layers.map((layer) => layer.clip.id)).toEqual(["a", "b"]);
    expect(layers[0]?.effect.opacityMultiplier).toBeCloseTo(0.5, 5);
    expect(layers[1]?.effect.opacityMultiplier).toBeCloseTo(0.5, 5);
    expect(mergeFlashOpacity(layers)).toBe(0);
  });

  it("flashes out on the outgoing half then in on the incoming half", () => {
    const left = clip("a", 0);
    const right = clip("b", 2_000_000);
    const transition: VideoEditorTimelineTransition = {
      id: "t1",
      kind: "flash",
      durationUs: 1_000_000,
      placement: "between",
      fromClipId: left.id,
      toClipId: right.id,
      direction: "in",
      easing: "linear",
    };
    const clips = new Map([
      [left.id, left],
      [right.id, right],
    ]);
    // First half: only left, flash rising toward the cut.
    const out = previewTransitionEffectForClip(left, 1_750_000, [transition], clips);
    expect(out.flashOpacity).toBeCloseTo(0.45, 5);
    expect(out.opacityMultiplier).toBe(1);
    const hiddenRight = previewTransitionEffectForClip(
      right,
      1_750_000,
      [transition],
      clips,
    );
    expect(hiddenRight.opacityMultiplier).toBe(0);

    // Second half: only right from its start, flash falling.
    const fadeIn = previewTransitionEffectForClip(
      right,
      2_250_000,
      [transition],
      clips,
    );
    expect(fadeIn.flashOpacity).toBeCloseTo(0.45, 5);
    expect(fadeIn.forceLocalUs).toBe(250_000);
    const hiddenLeft = previewTransitionEffectForClip(
      left,
      2_250_000,
      [transition],
      clips,
    );
    expect(hiddenLeft.opacityMultiplier).toBe(0);
  });

  it("applies wipe reveal on the incoming seam partner at mid-blend", () => {
    const left = clip("a", 0);
    const right = clip("b", 2_000_000);
    const transition: VideoEditorTimelineTransition = {
      id: "t1",
      kind: "wipe-left",
      durationUs: 1_000_000,
      placement: "between",
      fromClipId: left.id,
      toClipId: right.id,
      direction: "left",
      easing: "linear",
    };
    // Centered window [1.5s, 2.5s); mid at seam 2s.
    const effect = previewTransitionEffectForClip(
      right,
      2_000_000,
      [transition],
      new Map([
        [left.id, left],
        [right.id, right],
      ]),
    );
    expect(effect.clipPath).toBe("inset(0 50.000% 0 0)");
    expect(effect.opacityMultiplier).toBeCloseTo(0.5, 5);
  });

  it("keeps incoming media continuous after a non-flash seam window", () => {
    const left = clip("a", 0);
    const right = clip("b", 2_000_000, 4_000_000);
    const transition: VideoEditorTimelineTransition = {
      id: "t1",
      kind: "crossfade",
      durationUs: 1_000_000,
      placement: "between",
      fromClipId: left.id,
      toClipId: right.id,
      direction: "in",
      easing: "linear",
    };
    const clips = new Map([
      [left.id, left],
      [right.id, right],
    ]);
    // Window [1.5s, 2.5s). After the window, media time stays window-relative.
    const after = previewTransitionEffectForClip(
      right,
      2_500_000,
      [transition],
      clips,
    );
    expect(after.forceLocalUs).toBe(1_000_000);
    const later = previewTransitionEffectForClip(
      right,
      3_000_000,
      [transition],
      clips,
    );
    expect(later.forceLocalUs).toBe(1_500_000);
  });
});
