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
  it("adds a transition to an adjacent seam", () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoEditorTransitionPanel
        clips={[clip("a", 0), clip("b", 1_000_000)]}
        tracks={[track]}
        transitions={[]}
        selectedClip={clip("a", 0)}
        target={{ placement: "between", fromClipId: "a", toClipId: "b" }}
        commit={commit}
        onSelectTransition={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "向左擦除" }));
    fireEvent.click(screen.getByRole("button", { name: "应用到接缝" }));

    expect(commit).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          type: "addTransition",
          transition: expect.objectContaining({
            kind: "wipe-left",
            placement: "between",
            fromClipId: "a",
            toClipId: "b",
          }),
        }),
      ],
      [expect.objectContaining({ type: "removeTransition" })],
    );
  });

  it("updates the selected transition from the library", () => {
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
