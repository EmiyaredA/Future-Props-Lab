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

    expect(screen.getByRole("button", { name: "音频淡化" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "擦除" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "应用到片段之间" }));

    expect(commit).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          type: "addTransition",
          transition: expect.objectContaining({
            kind: "audio-crossfade",
            durationUs: 750_000,
            fromClipId: "a",
            toClipId: "b",
          }),
        }),
      ],
      [expect.objectContaining({ type: "removeTransition" })],
    );
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
    expect(screen.getByRole("spinbutton")).toBeDisabled();
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
