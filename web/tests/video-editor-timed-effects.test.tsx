import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  activeTimedEffects,
  trimTimedEffects,
} from "@features/video-editor/timedEffects";
import { paintTimedEffectsCanvas } from "@features/video-editor/timedEffectsCanvas";
import { VideoEditorTimedEffects } from "@features/video-editor/VideoEditorTimedEffects";
import type { TimelineEditBuilder } from "@features/video-editor/timelineSaveQueue";
import type {
  VideoEditorClip,
  VideoEditorTimedEffect,
  VideoEditorTimeline,
} from "@features/video-editor/types";

const flash: VideoEditorTimedEffect = {
  id: "flash",
  kind: "flash",
  startUs: 2_000_000,
  durationUs: 1_000_000,
  progressStart: 0,
  progressEnd: 1,
  direction: "left",
  easing: "linear",
};
const clip = {
  id: "c",
  trackId: "v",
  kind: "video",
  timelineStartUs: 10_000_000,
  sourceInUs: 80_000_000,
  playbackRate: 2,
  durationUs: 6_000_000,
  timedEffects: [flash],
} as VideoEditorClip;
const timeline = {
  document: { tracks: [{ id: "v", clips: [clip] }] },
} as VideoEditorTimeline;

describe("clip-local timed effects", () => {
  it("pulses on the timeline clock without changing source sampling or visibility", () => {
    expect(activeTimedEffects(clip, 1_999_999)).toEqual([]);
    expect(activeTimedEffects(clip, 2_000_000)[0].amount).toBe(0);
    expect(activeTimedEffects(clip, 2_500_000)[0].amount).toBe(1);
    expect(activeTimedEffects(clip, 3_000_000)).toEqual([]);
    expect(clip.sourceInUs).toBe(80_000_000);
    expect(clip.playbackRate).toBe(2);
    expect(activeTimedEffects({ ...clip, kind: "audio" }, 2_500_000)).toEqual(
      [],
    );
  });

  it.each([30, 60])(
    "keeps a one-frame camera flash visible at %i fps",
    (fps) => {
      const frame = Math.round(1_000_000 / fps);
      const short = {
        ...clip,
        timedEffects: [{ ...flash, durationUs: frame }],
      };
      expect(activeTimedEffects(short, flash.startUs, fps)[0].amount).toBe(1);
      expect(activeTimedEffects(short, flash.startUs + frame, fps)).toEqual([]);
    },
  );

  it("preserves the original easing phase across left and right trims", () => {
    const effects = [{ ...flash, easing: "ease-in" as const }];
    const left = trimTimedEffects(effects, 2_250_000, 500_000);
    expect(left[0]).toMatchObject({
      startUs: 0,
      durationUs: 500_000,
      progressStart: 0.25,
      progressEnd: 0.75,
    });
    expect(
      activeTimedEffects({ ...clip, timedEffects: left }, 100_000)[0].amount,
    ).toBeCloseTo(
      activeTimedEffects({ ...clip, timedEffects: effects }, 2_350_000)[0]
        .amount,
    );
    expect(trimTimedEffects(effects, 3_000_000, 1_000_000)).toEqual([]);
    const extended = trimTimedEffects(effects, -1_000_000, 7_000_000);
    expect(extended[0]).toMatchObject({
      startUs: 3_000_000,
      progressStart: 0,
      progressEnd: 1,
    });
  });

  it("composites flash only into the clip pixels while preserving transparent alpha", () => {
    const data = { data: new Uint8ClampedArray([10, 30, 70, 128]) };
    const context = { getImageData: vi.fn(() => data), putImageData: vi.fn() };
    const canvas = {
      width: 1,
      height: 1,
      getContext: () => context,
    } as unknown as HTMLCanvasElement;
    paintTimedEffectsCanvas(canvas, activeTimedEffects(clip, 2_500_000));
    expect([...data.data]).toEqual([231, 233, 237, 128]);
    expect(context.putImageData).toHaveBeenCalledWith(data, 0, 0);
  });

  it("scales Gaussian radius to fitted size and pads all edges before filtering", () => {
    const draw = vi.fn();
    const context = {
      drawImage: draw,
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      filter: "none",
    };
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(context as never);
    try {
      const surface = document.createElement("canvas");
      surface.width = 80;
      surface.height = 40;
      const effect = {
        ...flash,
        kind: "blur" as const,
        progress: 0.5,
        amount: 1,
      };
      paintTimedEffectsCanvas(surface, [effect], 160);
      expect(context.filter).toBe("blur(5px)");
      const final = draw.mock.calls.at(-1)!;
      expect(final.slice(1)).toEqual([-22, -22]);
      expect(final[0]).toMatchObject({ width: 124, height: 84 });
      expect(draw.mock.calls).toEqual(
        expect.arrayContaining([
          [expect.anything(), 0, 0, 1, 40, 0, 22, 22, 40],
          [expect.anything(), 79, 0, 1, 40, 102, 22, 22, 40],
          [expect.anything(), 0, 0, 80, 1, 22, 0, 80, 22],
          [expect.anything(), 0, 39, 80, 1, 22, 62, 80, 22],
          [expect.anything(), 79, 39, 1, 1, 102, 62, 22, 22],
        ]),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("queues a new effect against the latest saved clip and records undo", async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoEditorTimedEffects
        clip={clip}
        playheadUs={14_000_000}
        disabled={false}
        commit={commit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "在播放头添加效果" }));
    await waitFor(() => expect(commit).toHaveBeenCalledOnce());
    const previous = { ...flash, id: "saved-later" };
    const current = {
      ...timeline,
      document: {
        ...timeline.document,
        tracks: [
          {
            ...timeline.document.tracks![0],
            clips: [{ ...clip, timedEffects: [flash, previous] }],
          },
        ],
      },
    };
    const result = (commit.mock.calls[0][0] as TimelineEditBuilder)(current);
    expect(result.redo[0]).toMatchObject({
      type: "updateClip",
      patch: {
        timedEffects: [
          flash,
          previous,
          { kind: "flash", startUs: 4_000_000, durationUs: 400_000 },
        ],
      },
    });
    expect(result.undo[0]).toMatchObject({
      patch: { timedEffects: [flash, previous] },
    });
  });

  it("rejects out-of-clip time edits and deletes only the chosen effect", async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoEditorTimedEffects
        clip={clip}
        playheadUs={0}
        disabled={false}
        commit={commit}
      />,
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "片内效果开始秒" }),
      { target: { value: "5.5" } },
    );
    expect(screen.getByRole("button", { name: "保存效果" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("当前片段内");
    fireEvent.click(screen.getByRole("button", { name: "删除片内效果 闪白" }));
    await waitFor(() => expect(commit).toHaveBeenCalledOnce());
    expect(
      (commit.mock.calls[0][0] as TimelineEditBuilder)(timeline).redo[0],
    ).toMatchObject({ patch: { timedEffects: [] } });
  });

  it("saves a rising envelope through the custom control and restores its old phase on undo", async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoEditorTimedEffects
        clip={clip}
        playheadUs={0}
        disabled={false}
        commit={commit}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "片内效果变化方式" }));
    fireEvent.click(screen.getByRole("option", { name: "渐强" }));
    fireEvent.click(screen.getByRole("button", { name: "保存效果" }));
    await waitFor(() => expect(commit).toHaveBeenCalledOnce());
    const result = (commit.mock.calls[0][0] as TimelineEditBuilder)(timeline);
    expect(result.redo[0]).toMatchObject({
      patch: { timedEffects: [{ ...flash, progressEnd: 0.5 }] },
    });
    expect(result.undo[0]).toMatchObject({ patch: { timedEffects: [flash] } });
  });
});
