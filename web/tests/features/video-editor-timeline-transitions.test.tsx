import { fireEvent, render, screen } from "@testing-library/react";
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

describe("video editor timeline transitions and batch splitting", () => {
  it("splits every selected clip that intersects the playhead", async () => {
    const track = timeline.document.tracks![0]!;
    const first = {
      ...track.clips![0]!,
      id: "text-a",
      kind: "text" as const,
      name: "字幕A",
      timelineStartUs: 0,
      durationUs: 4_000_000,
    };
    const second = {
      ...first,
      id: "text-b",
      name: "字幕B",
      timelineStartUs: 1_000_000,
      durationUs: 4_000_000,
    };
    const missed = {
      ...first,
      id: "text-c",
      name: "字幕C",
      timelineStartUs: 5_000_000,
      durationUs: 2_000_000,
    };
    const commit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoEditorTimeline
        timeline={{
          ...timeline,
          document: {
            ...timeline.document,
            tracks: [{ ...track, clips: [first, second, missed] }],
          },
        }}
        assets={[]}
        playheadUs={2_000_000}
        setPlayheadUs={vi.fn()}
        zoom={80}
        scrollLeft={0}
        onScrollLeftChange={vi.fn()}
        selectedClipIds={["text-a", "text-b", "text-c"]}
        selectClip={vi.fn()}
        commit={commit}
        onDropAsset={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /分割/ }));
    expect(commit).toHaveBeenCalledTimes(1);
    const [redo] = commit.mock.calls[0]!;
    expect(redo).toHaveLength(2);
    expect(redo).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "splitClip", clipId: "text-a" }),
        expect.objectContaining({ type: "splitClip", clipId: "text-b" }),
      ]),
    );
    expect(redo.some((op: { clipId?: string }) => op.clipId === "text-c")).toBe(
      false,
    );
  });

  it("draws clip-local in/out transitions on the clip body", () => {
    const openClipEdgeTransition = vi.fn();
    render(
      <VideoEditorTimeline
        timeline={{
          ...timeline,
          document: {
            ...timeline.document,
            tracks: [
              {
                ...timeline.document.tracks![0]!,
                clips: [
                  {
                    ...timeline.document.tracks![0]!.clips![0]!,
                    transitionIn: {
                      kind: "crossfade",
                      durationUs: 500_000,
                      direction: "left",
                      easing: "linear",
                    },
                    transitionOut: {
                      kind: "flash",
                      durationUs: 1_000_000,
                      direction: "left",
                      easing: "linear",
                    },
                  },
                ],
              },
            ],
          },
        }}
        assets={[]}
        playheadUs={0}
        setPlayheadUs={vi.fn()}
        zoom={80}
        scrollLeft={0}
        onScrollLeftChange={vi.fn()}
        selectedClipIds={["video-left"]}
        selectClip={vi.fn()}
        openClipEdgeTransition={openClipEdgeTransition}
        commit={vi.fn().mockResolvedValue(undefined)}
        onDropAsset={vi.fn()}
      />,
    );

    const inBand = screen.getByRole("button", {
      name: "视频：片段头转场 0.50s",
    });
    const outBand = screen.getByRole("button", {
      name: "视频：片段尾转场 1.00s",
    });
    expect(inBand).toHaveStyle({ width: "5%" });
    expect(outBand).toHaveStyle({ width: "10%" });

    fireEvent.click(outBand);
    expect(openClipEdgeTransition).toHaveBeenCalledWith("video-left", "out");
  });

  it("shows add and transition controls across an audio overlap", () => {
    const base = timeline.document.tracks![0]!.clips![0]!;
    const first = {
      ...base,
      id: "audio-left",
      trackId: "audio-1",
      kind: "audio" as const,
      name: "前一段音频",
      durationUs: 2_000_000,
    };
    const second = {
      ...first,
      id: "audio-right",
      name: "后一段音频",
      timelineStartUs: 1_000_000,
    };
    const selectTransition = vi.fn();
    const audioTimeline = {
      ...timeline,
      document: {
        ...timeline.document,
        tracks: [
          {
            ...timeline.document.tracks![0]!,
            id: "audio-1",
            kind: "audio" as const,
            clips: [first, second],
          },
        ],
      },
    };
    const props = {
      assets: [],
      playheadUs: 0,
      setPlayheadUs: vi.fn(),
      zoom: 80,
      scrollLeft: 0,
      onScrollLeftChange: vi.fn(),
      selectedClipIds: [],
      selectClip: vi.fn(),
      selectTransition,
      commit: vi.fn().mockResolvedValue(undefined),
      onDropAsset: vi.fn(),
    };
    const { rerender } = render(
      <VideoEditorTimeline timeline={audioTimeline} {...props} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "添加片段之间音频转场" }),
    );
    expect(selectTransition).toHaveBeenCalledWith(undefined, {
      fromClipId: "audio-left",
      toClipId: "audio-right",
    });

    rerender(
      <VideoEditorTimeline
        timeline={{
          ...audioTimeline,
          document: {
            ...audioTimeline.document,
            transitions: [
              {
                id: "audio-seam",
                kind: "audio-crossfade",
                durationUs: 1_000_000,
                placement: "between",
                fromClipId: "audio-left",
                toClipId: "audio-right",
                direction: "left",
                easing: "linear",
              },
            ],
          },
        }}
        {...props}
      />,
    );
    expect(
      screen.getByRole("button", { name: "片段之间交叉淡化" }),
    ).toHaveTextContent("交叉淡化");
  });
});
