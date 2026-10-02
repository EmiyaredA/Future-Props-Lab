import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoEditorInspector } from "@features/video-editor/VideoEditorInspector";
import type { VideoEditorClip } from "@features/video-editor/types";
import type { TimelineEditBuilder } from "@features/video-editor/timelineSaveQueue";
import { newTrack } from "@features/video-editor/editorModel";

const videoClip = {
  id: "video-1",
  trackId: "v1",
  kind: "video",
  name: "片段",
  assetId: "asset-1",
  timelineStartUs: 0,
  durationUs: 5_000_000,
  sourceInUs: 0,
  sourceLoop: false,
  fitMode: "cover",
  flipX: false,
  fontSize: 72,
  textColor: "#ffffff",
  volume: 1,
  keyframes: [],
  transitionOut: {
    kind: "crossfade",
    durationUs: 500_000,
    direction: "out",
    easing: "linear",
  },
} as VideoEditorClip;

describe("VideoEditorInspector clip transitions", () => {
  it("builds queued transform edits from the preceding saved clip", () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoEditorInspector clip={videoClip} playheadUs={0} commit={commit} />,
    );
    fireEvent.blur(screen.getByRole("spinbutton", { name: "位置 X" }), {
      target: { value: "1200" },
    });
    fireEvent.blur(screen.getByRole("spinbutton", { name: "旋转" }), {
      target: { value: "45" },
    });
    const track = { ...newTrack("visual", 0), id: "v1", clips: [videoClip] };
    const current = {
      projectId: "p",
      revision: 0,
      updatedAt: "now",
      document: { schemaVersion: "1.0" as const, tracks: [track] },
    };
    const first = (commit.mock.calls[0][0] as TimelineEditBuilder)(current);
    const firstOperation = first.redo[0];
    if (firstOperation.type !== "updateClip")
      throw new Error("expected clip update");
    const transform = firstOperation.patch
      .transform as VideoEditorClip["transform"];
    const second = (commit.mock.calls[1][0] as TimelineEditBuilder)({
      ...current,
      revision: 1,
      document: {
        ...current.document,
        tracks: [{ ...track, clips: [{ ...videoClip, transform }] }],
      },
    });
    expect(second.redo).toEqual([
      {
        type: "updateClip",
        clipId: videoClip.id,
        patch: { transform: { ...transform, x: 1200, rotation: 45 } },
      },
    ]);
    expect(second.undo).toEqual([
      { type: "updateClip", clipId: videoClip.id, patch: { transform } },
    ]);
  });
  it("cancels an existing clip-edge transition from the attributes panel", () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoEditorInspector clip={videoClip} playheadUs={0} commit={commit} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(commit).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          type: "setTransition",
          clipId: "video-1",
          edge: "out",
        }),
      ],
      [
        expect.objectContaining({
          type: "setTransition",
          clipId: "video-1",
          edge: "out",
          transition: expect.objectContaining({ kind: "crossfade" }),
        }),
      ],
    );
  });

  it("enables a default crossfade and can open the effect library", () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const openEdge = vi.fn();
    render(
      <VideoEditorInspector
        clip={{ ...videoClip, transitionOut: undefined }}
        playheadUs={0}
        commit={commit}
        onOpenClipEdgeTransition={openEdge}
      />,
    );

    const enableButtons = screen.getAllByRole("button", { name: "启用" });
    fireEvent.click(enableButtons[0]!);
    expect(commit).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          type: "setTransition",
          clipId: "video-1",
          edge: "in",
          transition: expect.objectContaining({ kind: "crossfade" }),
        }),
      ],
      [expect.objectContaining({ type: "setTransition", edge: "in" })],
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: "从效果库选择…" })[0]!,
    );
    expect(openEdge).toHaveBeenCalledWith("video-1", "in");
    expect(screen.getByText("片段头")).toBeVisible();
    expect(screen.getByText("片段尾")).toBeVisible();
    expect(screen.queryByText(/入场|出场/)).toBeNull();
  });

  it("uses audio effect and position names and records a reversible toggle", () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoEditorInspector
        clip={{
          ...videoClip,
          kind: "audio",
          trackId: "a1",
          transitionOut: undefined,
        }}
        playheadUs={0}
        commit={commit}
      />,
    );
    expect(screen.getByRole("heading", { name: "音频转场" })).toBeVisible();
    expect(screen.getByText("片段头")).toBeVisible();
    expect(screen.getByText("片段尾")).toBeVisible();
    expect(screen.queryByText(/淡入|淡出/)).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "启用" })[0]!);
    expect(commit).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          type: "setTransition",
          edge: "in",
          transition: expect.objectContaining({ kind: "audio-crossfade" }),
        }),
      ],
      [expect.objectContaining({ type: "setTransition", edge: "in" })],
    );
  });
});
