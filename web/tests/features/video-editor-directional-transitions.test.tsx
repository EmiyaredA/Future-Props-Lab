import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoEditorTransitionPanel } from "@features/video-editor/VideoEditorTransitionPanel";
import { lightLeakStrip } from "@features/video-editor/directionalTransitionCanvas";
import {
  clipEdgePreviewEffect,
  mergeTransitionOverlay,
  previewVisualLayers,
} from "@features/video-editor/previewTransitions";
import { transitionLabel } from "@features/video-editor/transitionCatalog";
import type {
  VideoEditorClip,
  VideoEditorTimelineTransition,
  VideoEditorTrack,
} from "@features/video-editor/types";

const makeClip = (id: string, start: number, durationUs = 2_000_000) =>
  ({
    id,
    name: id,
    trackId: "v1",
    kind: "image",
    assetId: id,
    timelineStartUs: start,
    durationUs,
    sourceInUs: 0,
    keyframes: [],
    fitMode: "cover",
    flipX: false,
    fontSize: 72,
    sourceLoop: false,
    textColor: "#ffffff",
    volume: 1,
  }) as VideoEditorClip;
const makeTrack = (clips: VideoEditorClip[]): VideoEditorTrack => ({
  id: "v1",
  name: "V1",
  kind: "visual",
  order: 0,
  locked: false,
  hidden: false,
  muted: false,
  clips,
});
const effects = [
  {
    kind: "whip-pan",
    label: "甩镜模糊",
    category: "模糊",
    durationUs: 400_000,
    search: "whip",
  },
  {
    kind: "light-leak",
    label: "漏光扫过",
    category: "光效",
    durationUs: 500_000,
    search: "漏光",
  },
] as const;

describe("directional transition library", () => {
  it("allows browsing effects while read-only without changing an existing transition", () => {
    const commit = vi.fn(),
      clips = [makeClip("a", 0), makeClip("b", 2_000_000)];
    render(
      <VideoEditorTransitionPanel
        clips={clips}
        tracks={[makeTrack(clips)]}
        transitions={[
          {
            id: "seam",
            kind: "crossfade",
            durationUs: 500_000,
            placement: "between",
            fromClipId: "a",
            toClipId: "b",
            direction: "left",
            easing: "linear",
          },
        ]}
        selectedTransitionId="seam"
        disabled
        commit={commit}
        onSelectTransition={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "甩镜模糊" }));
    expect(commit).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "应用到片段之间" }),
    ).toBeDisabled();
  });
  it.each(effects)(
    "finds $label by category and search, without writing the project",
    (effect) => {
      const commit = vi.fn();
      render(
        <VideoEditorTransitionPanel
          clips={[]}
          tracks={[]}
          transitions={[]}
          commit={commit}
          onSelectTransition={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole("tab", { name: effect.category }));
      const button = screen.getByRole("button", { name: effect.label });
      button.focus();
      expect(document.activeElement).toBe(button);
      fireEvent.click(button);
      expect(button).toHaveAttribute("aria-pressed", "true");
      fireEvent.change(screen.getByRole("textbox", { name: "搜索转场" }), {
        target: { value: effect.search },
      });
      expect(screen.getByRole("button", { name: effect.label })).toBeVisible();
      expect(commit).not.toHaveBeenCalled();
      expect(transitionLabel(effect.kind)).toBe(effect.label);
    },
  );

  it.each(effects)(
    "applies $label with its default and a reversible seam operation",
    (effect) => {
      const left = makeClip("a", 0),
        right = makeClip("b", 2_000_000);
      const commit = vi.fn().mockResolvedValue(undefined);
      render(
        <VideoEditorTransitionPanel
          clips={[left, right]}
          tracks={[makeTrack([left, right])]}
          transitions={[]}
          target={{ fromClipId: "a", toClipId: "b" }}
          commit={commit}
          onSelectTransition={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: effect.label }));
      fireEvent.click(screen.getByRole("button", { name: "应用到片段之间" }));
      const [redo, undo] = commit.mock.calls[0];
      expect(redo[0].transition).toMatchObject({
        kind: effect.kind,
        direction: "left",
        durationUs: effect.durationUs,
        easing: "ease-in-out",
      });
      expect(undo).toEqual([
        { type: "removeTransition", transitionId: redo[0].transition.id },
      ]);
    },
  );

  it.each(
    effects.flatMap((effect) =>
      ["in", "out"].map((edge) => ({ ...effect, edge })),
    ),
  )(
    "fits $label at $edge to a short clip and keeps removal reversible",
    (effect) => {
      const clip = makeClip("short", 0, 125_001),
        commit = vi.fn().mockResolvedValue(undefined);
      render(
        <VideoEditorTransitionPanel
          clips={[clip]}
          tracks={[makeTrack([clip])]}
          transitions={[]}
          selectedClip={clip}
          commit={commit}
          onSelectTransition={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: effect.label }));
      fireEvent.click(
        screen.getByRole("button", {
          name: `应用到片段${effect.edge === "in" ? "头" : "尾"}`,
        }),
      );
      expect(commit.mock.calls[0][0][0].transition).toMatchObject({
        kind: effect.kind,
        durationUs: 125_001,
      });
      expect(commit.mock.calls[0][1]).toEqual([
        { type: "setTransition", clipId: "short", edge: effect.edge },
      ]);
    },
  );

  it.each(effects)(
    "updates all four directions for $label and preserves its undo",
    (effect) => {
      const left = makeClip("a", 0),
        right = makeClip("b", 2_000_000);
      const transition: VideoEditorTimelineTransition = {
        id: "seam",
        kind: effect.kind,
        fromClipId: "a",
        toClipId: "b",
        placement: "between",
        direction: "left",
        durationUs: effect.durationUs,
        easing: "ease-in-out",
      };
      const commit = vi.fn().mockResolvedValue(undefined);
      render(
        <VideoEditorTransitionPanel
          clips={[left, right]}
          tracks={[makeTrack([left, right])]}
          transitions={[transition]}
          selectedTransitionId="seam"
          commit={commit}
          onSelectTransition={vi.fn()}
        />,
      );
      for (const [label, direction] of [
        ["左", "left"],
        ["右", "right"],
        ["上", "up"],
        ["下", "down"],
      ]) {
        fireEvent.click(screen.getByRole("button", { name: label }));
        expect(commit.mock.lastCall?.[0][0]).toMatchObject({
          type: "updateTransition",
          patch: { direction },
        });
        expect(commit.mock.lastCall?.[1][0].patch).toMatchObject({
          direction: "left",
        });
      }
    },
  );
});

describe("directional preview evaluation", () => {
  it.each(["left", "right", "up", "down"] as const)(
    "switches once at the strongest %s whip without crossfade double images",
    (direction) => {
      const clips = [makeClip("a", 0), makeClip("b", 2_000_000)];
      const transition: VideoEditorTimelineTransition = {
        id: "seam",
        kind: "whip-pan",
        direction,
        fromClipId: "a",
        toClipId: "b",
        placement: "between",
        durationUs: 400_000,
        easing: "linear",
      };
      const layers = previewVisualLayers([makeTrack(clips)], 2_000_000, [
        transition,
      ]);
      expect(layers).toHaveLength(1);
      expect(layers[0].effect.opacityMultiplier).toBe(1);
      expect(layers[0].effect.whipPan).toEqual({ amount: -1, direction });
      expect(
        previewVisualLayers([makeTrack(clips)], 1_900_000, [transition])[0]
          .effect.whipPan,
      ).toEqual({ amount: 0.5, direction });
      expect(
        previewVisualLayers([makeTrack(clips)], 2_100_000, [transition])[0]
          .effect.whipPan,
      ).toEqual({ amount: -0.5, direction });
      expect(
        previewVisualLayers([makeTrack(clips)], 2_200_000, [transition])[0]
          .effect.whipPan,
      ).toBeUndefined();
    },
  );

  it("composites leak once at the program level, with no opacity fade or residue", () => {
    const clips = [makeClip("a", 0), makeClip("b", 2_000_000)];
    const transition: VideoEditorTimelineTransition = {
      id: "seam",
      kind: "light-leak",
      direction: "right",
      fromClipId: "a",
      toClipId: "b",
      placement: "between",
      durationUs: 500_000,
      easing: "linear",
    };
    const layers = previewVisualLayers([makeTrack(clips)], 2_000_000, [
      transition,
    ]);
    expect(layers).toHaveLength(1);
    expect(layers[0].effect.opacityMultiplier).toBe(1);
    expect(mergeTransitionOverlay(layers).lightLeak).toEqual({
      progress: 0.5,
      direction: "right",
    });
    expect(
      mergeTransitionOverlay(
        previewVisualLayers([makeTrack(clips)], 2_250_000, [transition]),
      ).lightLeak,
    ).toBeUndefined();
    const edge = {
      kind: "light-leak" as const,
      direction: "up" as const,
      durationUs: 500_000,
      easing: "linear" as const,
    };
    expect(
      clipEdgePreviewEffect({ ...clips[0], transitionIn: edge }, 250_000)
        ?.lightLeak?.progress,
    ).toBe(0.75);
    expect(
      clipEdgePreviewEffect({ ...clips[0], transitionOut: edge }, 1_750_000)
        ?.lightLeak?.progress,
    ).toBe(0.25);
  });

  it("uses a deterministic mirrored yellow-green illumination strip and clears its endpoints", () => {
    const a = lightLeakStrip(161, { progress: 0.3, direction: "left" });
    const b = lightLeakStrip(161, { progress: 0.3, direction: "right" });
    for (let x = 0; x < 161; x++) {
      expect([...a.slice(x * 4, x * 4 + 3)]).toEqual([
        ...b.slice((160 - x) * 4, (160 - x) * 4 + 3),
      ]);
      expect(a[x * 4 + 1]).toBeGreaterThanOrEqual(a[x * 4 + 2]);
    }
    expect([
      ...lightLeakStrip(161, { progress: 0.5, direction: "left" }).slice(
        320,
        324,
      ),
    ]).toEqual([255, 255, 255, 255]);
    for (const progress of [0, 1])
      expect(
        [...lightLeakStrip(16, { progress, direction: "left" })].filter(
          (_, i) => i % 4 !== 3,
        ),
      ).toEqual(Array(48).fill(0));
  });
});
