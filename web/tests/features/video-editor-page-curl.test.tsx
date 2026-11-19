import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  pageCurlForClip,
  pageCurlPixels,
} from "@features/video-editor/pageCurlCanvas";
import {
  previewVisualLayers,
  clipEdgePreviewEffect,
} from "@features/video-editor/previewTransitions";
import { VideoEditorTransitionPanel } from "@features/video-editor/VideoEditorTransitionPanel";
import type {
  VideoEditorClip,
  VideoEditorTrack,
  VideoEditorTimelineTransition,
} from "@features/video-editor/types";

const clips = ["a", "b"].map(
  (id, i) =>
    ({
      id,
      name: id,
      trackId: "v1",
      kind: "image",
      assetId: id,
      timelineStartUs: i * 2_000_000,
      durationUs: 2_000_000,
      sourceInUs: 0,
      keyframes: [],
      fitMode: "cover",
      flipX: false,
      fontSize: 72,
      sourceLoop: false,
      textColor: "#ffffff",
      volume: 1,
    }) as VideoEditorClip,
);
const track = {
  id: "v1",
  name: "V1",
  kind: "visual",
  order: 1,
  clips,
} as VideoEditorTrack;
const seam: VideoEditorTimelineTransition = {
  id: "seam",
  kind: "page-curl",
  durationUs: 800_000,
  placement: "between",
  fromClipId: "a",
  toClipId: "b",
  direction: "left",
  easing: "linear",
};

describe("paper curl preview", () => {
  it("places the next page underneath the sheet while preserving track order and sample continuity", () => {
    const top = {
      ...track,
      id: "top",
      order: 0,
      clips: [{ ...clips[0], id: "top", trackId: "top" }],
    };
    const layers = previewVisualLayers([top, track], 1_800_000, [seam]);
    expect(layers.map((layer) => layer.clip.id)).toEqual(["b", "a", "top"]);
    expect(layers[0].localUs).toBe(200_000);
    expect(layers[0].effect.pageCurl).toBeUndefined();
    expect(layers[1].effect.opacityMultiplier).toBe(1);
    expect(layers[1].effect.pageCurl).toEqual({
      progress: 0.25,
      direction: "left",
    });
    const after = previewVisualLayers([track], 2_400_000, [seam]);
    expect(after.map((layer) => layer.clip.id)).toEqual(["b"]);
    expect(after[0].localUs).toBe(800_000);
    expect(after[0].effect.pageCurl).toBeUndefined();
  });

  it("unrolls entrance, rolls away exit, applies easing and preserves screen direction when flipped", () => {
    const transition = {
      kind: "page-curl" as const,
      durationUs: 800_000,
      direction: "right" as const,
      easing: "ease-in" as const,
    };
    expect(
      clipEdgePreviewEffect({ ...clips[0], transitionIn: transition }, 400_000)
        ?.pageCurl,
    ).toEqual({ progress: 0.75, direction: "right" });
    expect(
      clipEdgePreviewEffect(
        { ...clips[0], transitionOut: transition },
        1_600_000,
      )?.pageCurl,
    ).toEqual({ progress: 0.25, direction: "right" });
    expect(
      pageCurlForClip({ progress: 0.5, direction: "right" }, true),
    ).toEqual({ progress: 0.5, direction: "left" });
  });

  it("switches a vertical wipe to a valid curl direction with a reversible edit", () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoEditorTransitionPanel
        clips={clips}
        tracks={[track]}
        transitions={[{ ...seam, kind: "wipe", direction: "up" }]}
        selectedTransitionId="seam"
        commit={commit}
        onSelectTransition={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "书页翻页" }));
    expect(commit.mock.lastCall?.[0][0].patch).toEqual({
      kind: "page-curl",
      direction: "left",
    });
    expect(commit.mock.lastCall?.[1][0].patch).toEqual({
      kind: "wipe",
      direction: "up",
    });
    expect(
      screen.queryByRole("button", { name: "上" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "下" }),
    ).not.toBeInTheDocument();
  });

  it("keeps empty source pixels empty, reveals background, and displays paper with local shadow", () => {
    const width = 160,
      height = 90;
    const source = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < source.length; i += 4)
      source.set([40, 80, 120, 128], i);
    const original = source.slice();
    const effect = { progress: 0.5, direction: "left" as const };
    const pixels = pageCurlPixels(source, width, height, effect);
    const pixel = (x: number) => [
      ...pixels.slice((45 * width + x) * 4, (45 * width + x) * 4 + 4),
    ];
    expect(pixel(10)).toEqual([40, 80, 120, 128]);
    expect(pixel(150)[3]).toBe(0);
    expect(pixel(90)[0]).toBeGreaterThan(160);
    expect(pixel(107)[3]).toBeGreaterThan(0);
    expect(pixel(107)[3]).toBeLessThan(128);
    expect(source).toEqual(original);
    expect(
      pageCurlPixels(source, width, height, { ...effect, progress: 0 }),
    ).toEqual(source);
    expect(
      pageCurlPixels(source, width, height, { ...effect, progress: 1 }).some(
        Boolean,
      ),
    ).toBe(false);
    const empty = pageCurlPixels(
      new Uint8ClampedArray(source.length),
      width,
      height,
      effect,
    );
    expect([...empty].filter((_, i) => i % 4 === 3).some(Boolean)).toBe(false);
    const right = pageCurlPixels(source, width, height, {
      ...effect,
      direction: "right",
    });
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const a = (y * width + x) * 4,
          b = (y * width + width - 1 - x) * 4;
        expect(pixels[a + 3]).toBe(right[b + 3]);
        if (pixels[a + 3])
          expect([...pixels.slice(a, a + 3)]).toEqual([
            ...right.slice(b, b + 3),
          ]);
      }
  });
});
