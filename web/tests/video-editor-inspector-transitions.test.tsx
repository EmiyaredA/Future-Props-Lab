import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoEditorInspector } from "@features/video-editor/VideoEditorInspector";
import type { VideoEditorClip } from "@features/video-editor/types";

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
  it("cancels an existing clip-edge transition from the attributes panel", () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoEditorInspector
        clip={videoClip}
        playheadUs={0}
        commit={commit}
      />,
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

    fireEvent.click(screen.getAllByRole("button", { name: "从效果库选择…" })[0]!);
    expect(openEdge).toHaveBeenCalledWith("video-1", "in");
  });
});
