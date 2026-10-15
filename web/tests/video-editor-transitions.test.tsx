import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoEditorTransitionPanel } from "@features/video-editor/VideoEditorTransitionPanel";
import type {
  VideoEditorClip,
  VideoEditorTrack,
} from "@features/video-editor/types";

const clip = (id: string, start: number): VideoEditorClip =>
  ({
    id,
    trackId: "v1",
    kind: "video",
    name: id,
    assetId: `${id}-asset`,
    timelineStartUs: start,
    durationUs: 1_000_000,
    sourceInUs: 0,
    sourceLoop: false,
    fitMode: "cover",
    flipX: false,
    fontSize: 72,
    textColor: "#ffffff",
    volume: 1,
    keyframes: [],
  }) as VideoEditorClip;

const track: VideoEditorTrack = {
  id: "v1",
  kind: "visual",
  name: "画面 1",
  order: 0,
  locked: false,
  hidden: false,
  muted: false,
  clips: [],
};

describe("VideoEditorTransitionPanel", () => {
  it.each([125_001, 33_333, 1])(
    "fits an eyelid seam to a %i microsecond freeze clip",
    (durationUs) => {
      const commit = vi.fn().mockResolvedValue(undefined);
      const from = { ...clip("freeze", 0), durationUs };
      const to = clip("video", durationUs);
      render(
        <VideoEditorTransitionPanel
          clips={[from, to]}
          tracks={[track]}
          transitions={[]}
          selectedClip={to}
          target={{ fromClipId: from.id, toClipId: to.id }}
          commit={commit}
          onSelectTransition={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "闭眼睁眼" }));
      fireEvent.click(screen.getByRole("button", { name: "应用到片段之间" }));
      expect(commit.mock.calls[0][0][0].transition.durationUs).toBe(durationUs);
    },
  );

  it.each(["头", "尾"])("fits a clip %s transition to a short clip", (edge) => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const short = { ...clip("freeze", 0), durationUs: 125_001 };
    render(
      <VideoEditorTransitionPanel
        clips={[short]}
        tracks={[track]}
        transitions={[]}
        selectedClip={short}
        commit={commit}
        onSelectTransition={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "闭眼睁眼" }));
    fireEvent.click(screen.getByRole("button", { name: `应用到片段${edge}` }));
    expect(commit.mock.calls[0][0][0].transition.durationUs).toBe(125_001);
  });

  it.each(["between", "in", "out"] as const)(
    "bounds duration edits for a short %s transition without rounding its limit",
    (placement) => {
      const commit = vi.fn().mockResolvedValue(undefined);
      const transition = {
        kind: "eyelid" as const,
        durationUs: 125_001,
        direction: "left" as const,
        easing: "linear" as const,
      };
      const from = {
        ...clip("freeze", 0),
        durationUs: 125_001,
        ...(placement === "in" ? { transitionIn: transition } : {}),
        ...(placement === "out" ? { transitionOut: transition } : {}),
      };
      render(
        <VideoEditorTransitionPanel
          clips={[from, clip("video", 125_001)]}
          tracks={[track]}
          transitions={
            placement === "between"
              ? [
                  {
                    ...transition,
                    id: "seam",
                    placement: "between",
                    fromClipId: from.id,
                    toClipId: "video",
                  },
                ]
              : []
          }
          selectedTransitionId={placement === "between" ? "seam" : undefined}
          selectedClip={from}
          clipEdgeFocus={placement === "out" ? "out" : "in"}
          commit={commit}
          onSelectTransition={vi.fn()}
        />,
      );
      const input = screen.getByRole("spinbutton");
      expect(input).toHaveValue(0.125001);
      expect(input).toHaveAttribute("max", "0.125001");
      for (const [value, expected] of [
        ["0.5", 125_001],
        ["-1", 1],
        ["0.1", 100_000],
      ] as const) {
        fireEvent.change(input, { target: { value } });
        const operation = commit.mock.calls.at(-1)![0][0];
        expect((operation.patch ?? operation.transition).durationUs).toBe(
          expected,
        );
        const inverse = commit.mock.calls.at(-1)![1][0];
        expect((inverse.patch ?? inverse.transition).durationUs).toBe(125_001);
      }
    },
  );

  it("adds a seam transition between adjacent clips", () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoEditorTransitionPanel
        clips={[clip("a", 0), clip("b", 1_000_000)]}
        tracks={[track]}
        transitions={[]}
        selectedClip={clip("a", 0)}
        target={{ fromClipId: "a", toClipId: "b" }}
        commit={commit}
        onSelectTransition={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("button", { name: "擦除" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "擦除" }));
    fireEvent.click(screen.getByRole("button", { name: "应用到片段之间" }));

    expect(commit).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          type: "addTransition",
          transition: expect.objectContaining({
            kind: "wipe",
            direction: "left",
            placement: "between",
            fromClipId: "a",
            toClipId: "b",
          }),
        }),
      ],
      [expect.objectContaining({ type: "removeTransition" })],
    );
  });

  it.each([
    ["风格", "闭眼睁眼", "eyelid"],
    ["模糊", "旋转模糊", "spin-blur"],
  ])(
    "adds %s / %s from the visual effects library",
    (category, label, kind) => {
      const commit = vi.fn().mockResolvedValue(undefined);
      render(
        <VideoEditorTransitionPanel
          clips={[clip("a", 0), clip("b", 1_000_000)]}
          tracks={[track]}
          transitions={[]}
          selectedClip={clip("a", 0)}
          target={{ fromClipId: "a", toClipId: "b" }}
          commit={commit}
          onSelectTransition={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole("tab", { name: category }));
      fireEvent.click(screen.getByRole("button", { name: label }));
      fireEvent.click(screen.getByRole("button", { name: "应用到片段之间" }));

      expect(commit).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            type: "addTransition",
            transition: expect.objectContaining({ kind }),
          }),
        ],
        [expect.objectContaining({ type: "removeTransition" })],
      );
    },
  );

  it("sets a clip-local in transition without touching seams", () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoEditorTransitionPanel
        clips={[clip("a", 0), clip("b", 1_000_000)]}
        tracks={[track]}
        transitions={[]}
        selectedClip={clip("b", 1_000_000)}
        clipEdgeFocus="in"
        commit={commit}
        onSelectTransition={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "闪白" }));
    fireEvent.click(screen.getByRole("button", { name: "应用到片段头" }));

    expect(commit).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          type: "setTransition",
          clipId: "b",
          edge: "in",
          transition: expect.objectContaining({
            kind: "flash",
          }),
        }),
      ],
      [
        expect.objectContaining({
          type: "setTransition",
          clipId: "b",
          edge: "in",
        }),
      ],
    );
  });

  it("creates an audio crossfade over the complete overlap", () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const audioTrack: VideoEditorTrack = {
      ...track,
      id: "a1",
      kind: "audio",
      name: "音频 1",
    };
    const audioClip = (id: string, start: number): VideoEditorClip =>
      ({
        ...clip(id, start),
        trackId: "a1",
        kind: "audio",
        durationUs: 2_000_000,
      }) as VideoEditorClip;
    render(
      <VideoEditorTransitionPanel
        clips={[audioClip("a", 0), audioClip("b", 1_250_000)]}
        tracks={[audioTrack]}
        transitions={[]}
        target={{ fromClipId: "a", toClipId: "b" }}
        commit={commit}
        onSelectTransition={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "交叉淡化" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "擦除" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "应用到片段之间" }));

    expect(commit).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          type: "setAudioTransition",
          kind: "audio-crossfade",
          durationUs: 750_000,
          fromClipId: "a",
          toClipId: "b",
        }),
      ],
      [expect.objectContaining({ type: "removeTransition" })],
    );
  });

  it("offers four audio effects and applies a half-second overlap to touching clips", () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const audioTrack: VideoEditorTrack = { ...track, id: "a1", kind: "audio" };
    const audioClip = (id: string, start: number): VideoEditorClip =>
      ({
        ...clip(id, start),
        trackId: "a1",
        kind: "audio",
        durationUs: 2_000_000,
      }) as VideoEditorClip;
    render(
      <VideoEditorTransitionPanel
        clips={[audioClip("a", 0), audioClip("b", 2_000_000)]}
        tracks={[audioTrack]}
        transitions={[]}
        target={{ fromClipId: "a", toClipId: "b" }}
        commit={commit}
        onSelectTransition={vi.fn()}
      />,
    );

    for (const name of ["交叉淡化", "等功率交叉淡化", "淡出再淡入", "频率扫掠"])
      expect(screen.getByRole("button", { name })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "等功率交叉淡化" }));
    expect(screen.getByRole("spinbutton")).toHaveValue(0.5);
    fireEvent.click(screen.getByRole("button", { name: "应用到片段之间" }));
    expect(commit).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          type: "setAudioTransition",
          kind: "audio-equal-power",
          durationUs: 500_000,
        }),
      ],
      [
        expect.objectContaining({ type: "removeTransition" }),
        expect.objectContaining({ type: "restoreClipStates" }),
      ],
    );
  });

  it("asks to separate audio linked to video before applying a seam", () => {
    const from = {
      ...clip("a", 0),
      kind: "audio" as const,
      trackId: "a1",
      durationUs: 2_000_000,
      linkGroupId: "av",
    };
    const to = {
      ...from,
      id: "b",
      timelineStartUs: 2_000_000,
      linkGroupId: undefined,
    };
    render(
      <VideoEditorTransitionPanel
        clips={[from, to]}
        tracks={[{ ...track, id: "a1", kind: "audio" }]}
        transitions={[]}
        target={{ fromClipId: "a", toClipId: "b" }}
        commit={vi.fn().mockResolvedValue(undefined)}
        onSelectTransition={vi.fn()}
      />,
    );
    expect(screen.getByText(/请先分离与画面关联的音频片段/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "应用到片段之间" }),
    ).toBeDisabled();
  });

  it("deletes an audio overlap transition with a reversible operation", () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const audioTrack: VideoEditorTrack = {
      ...track,
      id: "a1",
      kind: "audio",
    };
    const from = {
      ...clip("a", 0),
      trackId: "a1",
      kind: "audio" as const,
      durationUs: 2_000_000,
    };
    const to = {
      ...from,
      id: "b",
      timelineStartUs: 1_000_000,
    };
    const transition = {
      id: "audio-seam",
      kind: "audio-crossfade" as const,
      durationUs: 1_000_000,
      placement: "between" as const,
      fromClipId: "a",
      toClipId: "b",
      direction: "left" as const,
      easing: "linear" as const,
    };
    render(
      <VideoEditorTransitionPanel
        clips={[from, to]}
        tracks={[audioTrack]}
        transitions={[transition]}
        selectedTransitionId="audio-seam"
        commit={commit}
        onSelectTransition={vi.fn()}
      />,
    );
    expect(screen.getByRole("spinbutton")).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "删除当前转场" }));
    expect(commit).toHaveBeenCalledWith(
      [{ type: "removeTransition", transitionId: "audio-seam" }],
      [{ type: "addTransition", transition }],
    );
  });

  it("uses neutral position and easing labels", () => {
    render(
      <VideoEditorTransitionPanel
        clips={[clip("a", 0)]}
        tracks={[track]}
        transitions={[]}
        selectedClip={clip("a", 0)}
        commit={vi.fn().mockResolvedValue(undefined)}
        onSelectTransition={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "应用到片段头" })).toBeVisible();
    expect(screen.getByRole("button", { name: "应用到片段尾" })).toBeVisible();
    expect(screen.getByRole("button", { name: "前慢后快" })).toBeVisible();
    expect(screen.getByRole("button", { name: "前快后慢" })).toBeVisible();
    expect(screen.getByRole("button", { name: "两端平滑" })).toBeVisible();
    expect(screen.queryByText("方向")).toBeNull();
    expect(screen.queryByText(/入场|出场|淡入|淡出/)).toBeNull();
  });

  it("updates the selected seam transition from the library", () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoEditorTransitionPanel
        clips={[clip("a", 0), clip("b", 1_000_000)]}
        tracks={[track]}
        transitions={[
          {
            id: "t1",
            kind: "crossfade",
            durationUs: 500_000,
            placement: "between",
            fromClipId: "a",
            toClipId: "b",
            direction: "in",
            easing: "linear",
          },
        ]}
        selectedTransitionId="t1"
        commit={commit}
        onSelectTransition={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "闪白" }));
    expect(commit).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          type: "updateTransition",
          transitionId: "t1",
        }),
      ],
      [
        expect.objectContaining({
          type: "updateTransition",
          transitionId: "t1",
        }),
      ],
    );
  });
});
