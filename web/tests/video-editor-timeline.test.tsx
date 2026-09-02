import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoEditorTimeline } from "@features/video-editor/VideoEditorTimeline";
import type { VideoEditorTimeline as Timeline } from "@features/video-editor/types";

const timeline: Timeline = {
  projectId: "editor-1",
  revision: 1,
  updatedAt: "2026-08-29T00:00:00Z",
  document: {
    schemaVersion: "1.0",
    settings: {
      width: 1920,
      height: 1080,
      fps: 30,
      backgroundColor: "#000000",
    },
    tracks: [
      {
        id: "visual-1",
        kind: "visual",
        name: "V1",
        order: 0,
        locked: false,
        hidden: false,
        muted: false,
        clips: [
          {
            id: "video-left",
            trackId: "visual-1",
            kind: "video",
            name: "视频",
            assetId: "asset-1",
            timelineStartUs: 0,
            durationUs: 10_000_000,
            sourceInUs: 0,
            sourceLoop: false,
            fitMode: "native",
            flipX: false,
            fontSize: 72,
            textColor: "#ffffff",
            volume: 1,
            keyframes: [],
          },
        ],
      },
    ],
  },
};

describe("video editor timeline", () => {
  it("selects the right-hand clip after splitting so it can be split again", async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const selectClip = vi.fn();
    render(
      <VideoEditorTimeline
        timeline={timeline}
        assets={[]}
        playheadUs={2_000_000}
        setPlayheadUs={vi.fn()}
        zoom={80}
        scrollLeft={0}
        onScrollLeftChange={vi.fn()}
        selectedClipId="video-left"
        selectedClipIds={["video-left"]}
        selectClip={selectClip}
        commit={commit}
        onDropAsset={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "分割" }));

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    const split = commit.mock.calls[0]?.[0]?.[0];
    expect(split).toMatchObject({
      type: "splitClip",
      clipId: "video-left",
    });
    expect(split.atUs).toBeCloseTo(2_000_000, -3);
    await waitFor(() =>
      expect(selectClip).toHaveBeenCalledWith(split.newClipId),
    );
  });

  it("restores and reports horizontal scroll position", () => {
    const onScrollLeftChange = vi.fn();
    const props = {
      timeline,
      assets: [],
      playheadUs: 0,
      setPlayheadUs: vi.fn(),
      zoom: 80,
      onScrollLeftChange,
      selectedClipId: undefined,
      selectedClipIds: [],
      selectClip: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
      onDropAsset: vi.fn(),
    };
    const { container, rerender } = render(
      <VideoEditorTimeline {...props} scrollLeft={320} />,
    );
    const scroller = container.querySelector<HTMLElement>(".ve-tracks-scroll")!;
    expect(scroller.scrollLeft).toBe(320);

    scroller.scrollLeft = 460;
    fireEvent.scroll(scroller);
    expect(onScrollLeftChange).toHaveBeenCalledWith(460);

    rerender(<VideoEditorTimeline {...props} scrollLeft={125} />);
    expect(scroller.scrollLeft).toBe(125);
  });

  it("toggles snapping from the timeline toolbar", () => {
    const setSnapEnabled = vi.fn();
    render(
      <VideoEditorTimeline
        timeline={timeline}
        assets={[]}
        playheadUs={0}
        setPlayheadUs={vi.fn()}
        zoom={80}
        scrollLeft={0}
        onScrollLeftChange={vi.fn()}
        selectedClipId={undefined}
        selectedClipIds={[]}
        selectClip={vi.fn()}
        commit={vi.fn().mockResolvedValue(undefined)}
        onDropAsset={vi.fn()}
        snapEnabled
        setSnapEnabled={setSnapEnabled}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "吸附" }));
    expect(setSnapEnabled).toHaveBeenCalledWith(false);
  });

  it("clears the clip selection when clicking empty timeline space", () => {
    const selectClip = vi.fn();
    const props = {
      timeline,
      assets: [],
      playheadUs: 0,
      setPlayheadUs: vi.fn(),
      zoom: 80,
      scrollLeft: 0,
      onScrollLeftChange: vi.fn(),
      selectedClipId: "video-left",
      selectedClipIds: ["video-left"],
      selectClip,
      commit: vi.fn().mockResolvedValue(undefined),
      onDropAsset: vi.fn(),
    };
    const { container } = render(<VideoEditorTimeline {...props} />);

    fireEvent.pointerDown(container.querySelector(".ve-ruler")!);
    fireEvent.pointerDown(container.querySelector(".ve-track-row")!);
    fireEvent.pointerDown(container.querySelector(".ve-tracks-scroll")!);

    expect(selectClip).toHaveBeenNthCalledWith(1, undefined);
    expect(selectClip).toHaveBeenNthCalledWith(2, undefined);
    expect(selectClip).toHaveBeenNthCalledWith(3, undefined);
  });
});
