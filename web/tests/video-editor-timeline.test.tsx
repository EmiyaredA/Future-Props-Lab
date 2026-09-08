import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  it("labels every track by type even when it has a custom name", () => {
    const kinds = ["visual", "mixed", "audio"] as const;
    render(
      <VideoEditorTimeline
        timeline={{
          ...timeline,
          document: {
            ...timeline.document,
            tracks: kinds.map((kind, order) => ({
              ...timeline.document.tracks![0]!,
              id: kind,
              kind,
              order,
              name: `自定义名称 ${order}`,
              clips: [],
            })),
          },
        }}
        assets={[]}
        playheadUs={0}
        setPlayheadUs={vi.fn()}
        zoom={80}
        scrollLeft={0}
        onScrollLeftChange={vi.fn()}
        selectedClipIds={[]}
        selectClip={vi.fn()}
        commit={vi.fn().mockResolvedValue(undefined)}
        onDropAsset={vi.fn()}
      />,
    );
    for (const [index, label] of ["视觉轨", "混合轨", "音频轨"].entries()) {
      const group = screen.getByRole("group", {
        name: `${label}：自定义名称 ${index}`,
      });
      expect(within(group).getByText(label)).toBeVisible();
      expect(within(group).getByText(`自定义名称 ${index}`)).toBeVisible();
      expect(
        within(group).getByRole("button", { name: "锁定轨道" }),
      ).toBeVisible();
    }
  });
  it.each(["success", "failure"])(
    "holds the drop preview while saving and clears it on %s",
    async (outcome) => {
      let resolveSave!: () => void;
      let rejectSave!: () => void;
      const saving = new Promise<void>((resolve, reject) => {
        resolveSave = resolve;
        rejectSave = reject;
      });
      const commit = vi.fn(() => saving);
      render(
        <VideoEditorTimeline
          timeline={timeline}
          assets={[]}
          playheadUs={0}
          setPlayheadUs={vi.fn()}
          zoom={80}
          scrollLeft={0}
          onScrollLeftChange={vi.fn()}
          selectedClipIds={[]}
          selectClip={vi.fn()}
          commit={commit}
          onDropAsset={vi.fn()}
        />,
      );
      const clip = screen.getByRole("button", { name: /视频/ });
      fireEvent(
        clip,
        new MouseEvent("pointerdown", {
          bubbles: true,
          clientX: 20,
          button: 0,
        }),
      );
      // Releasing before the animation frame must still commit the final position.
      fireEvent(window, new MouseEvent("pointermove", { clientX: 80 }));
      fireEvent(window, new MouseEvent("pointerup", { clientX: 100 }));
      expect(commit).toHaveBeenCalledTimes(1);
      expect(clip).toHaveClass("dragging");
      expect(Number.parseFloat(clip.style.left)).toBeCloseTo(80, 2);
      await act(async () => {
        if (outcome === "success") resolveSave();
        else rejectSave();
      });
      expect(clip).not.toHaveClass("dragging");
    },
  );

  it.each(["visual", "mixed"] as const)(
    "commits an exact seam when dragging a video on a %s track",
    async (kind) => {
      const track = timeline.document.tracks![0]!;
      const first = { ...track.clips![0]!, durationUs: 2_333_333 };
      const second = {
        ...first,
        id: "video-right",
        name: "下一段",
        timelineStartUs: 2_500_000,
        durationUs: 3_042_000,
      };
      const commit = vi.fn().mockResolvedValue(undefined);
      const onNotice = vi.fn();
      render(
        <VideoEditorTimeline
          timeline={{
            ...timeline,
            document: {
              ...timeline.document,
              tracks: [{ ...track, kind, clips: [first, second] }],
            },
          }}
          assets={[]}
          playheadUs={0}
          setPlayheadUs={vi.fn()}
          zoom={80}
          scrollLeft={0}
          onScrollLeftChange={vi.fn()}
          selectedClipId={second.id}
          selectedClipIds={[second.id]}
          selectClip={vi.fn()}
          commit={commit}
          onDropAsset={vi.fn()}
          onNotice={onNotice}
        />,
      );
      const clip = screen.getByRole("button", { name: /下一段/ });
      fireEvent(
        clip,
        new MouseEvent("pointerdown", {
          bubbles: true,
          clientX: 220,
          button: 0,
        }),
      );
      fireEvent(
        window,
        new MouseEvent("pointermove", { bubbles: true, clientX: 207 }),
      );
      fireEvent(
        window,
        new MouseEvent("pointerup", { bubbles: true, clientX: 207 }),
      );

      expect(commit).toHaveBeenCalledWith(
        [
          {
            type: "moveClip",
            clipId: second.id,
            trackId: track.id,
            timelineStartUs: first.durationUs,
          },
        ],
        [
          {
            type: "moveClip",
            clipId: second.id,
            trackId: track.id,
            timelineStartUs: second.timelineStartUs,
          },
        ],
      );
      expect(onNotice).not.toHaveBeenCalled();
      await waitFor(() => expect(clip).not.toHaveClass("dragging"));
    },
  );

  it.each(["valid", "locked", "audio", "overlap"] as const)(
    "keeps cross-track previews stable and handles a %s destination",
    async (destination) => {
      const source = timeline.document.tracks![0]!;
      const commit = vi.fn().mockResolvedValue(undefined);
      const onNotice = vi.fn();
      const { container } = render(
        <VideoEditorTimeline
          timeline={{
            ...timeline,
            document: {
              ...timeline.document,
              tracks: [
                source,
                {
                  ...source,
                  id: "target",
                  order: 1,
                  locked: destination === "locked",
                  kind: destination === "audio" ? "audio" : "visual",
                  clips:
                    destination === "overlap"
                      ? [
                          {
                            ...source.clips![0]!,
                            id: "obstacle",
                            trackId: "target",
                            name: "障碍片段",
                          },
                        ]
                      : [],
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
          commit={commit}
          onDropAsset={vi.fn()}
          onNotice={onNotice}
        />,
      );
      const rows = container.querySelectorAll<HTMLElement>(".ve-track-row");
      rows.forEach((row, index) =>
        vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
          left: 0,
          right: 2400,
          top: 26 + index * 56,
          bottom: 82 + index * 56,
        } as DOMRect),
      );
      const clip = screen.getByRole("button", { name: /视频/ });
      // The translated clip remains under the cursor and belongs to the
      // source row: this is what caused the old hit test to oscillate.
      const elementFromPoint = Object.getOwnPropertyDescriptor(
        document,
        "elementFromPoint",
      );
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => clip,
      });
      try {
        fireEvent(
          clip,
          new MouseEvent("pointerdown", {
            bubbles: true,
            clientX: 20,
            clientY: 50,
            button: 0,
          }),
        );
        for (const y of [100, 101, 102, 100]) {
          fireEvent(
            window,
            new MouseEvent("pointermove", { clientX: 20, clientY: y }),
          );
          await act(
            () =>
              new Promise((resolve) => window.requestAnimationFrame(resolve)),
          );
          expect(clip).toHaveStyle({ transform: "translateY(56px)" });
        }
        if (destination !== "valid") expect(clip).toHaveClass("invalid");
        await act(async () => {
          fireEvent(
            window,
            new MouseEvent("pointerup", { clientX: 20, clientY: 100 }),
          );
        });
        if (destination === "valid") {
          expect(commit).toHaveBeenCalledExactlyOnceWith(
            [
              {
                type: "moveClip",
                clipId: "video-left",
                trackId: "target",
                timelineStartUs: 0,
              },
            ],
            [
              {
                type: "moveClip",
                clipId: "video-left",
                trackId: "visual-1",
                timelineStartUs: 0,
              },
            ],
          );
        } else {
          expect(commit).not.toHaveBeenCalled();
          const messages = {
            locked: "视觉轨「V1」已锁定，请先解锁再移动片段",
            audio: "音频轨「V1」只接收音频片段，画面素材请放入视觉轨",
            overlap: "视觉轨「V1」的该位置已有片段，请移到空白位置或其他轨道",
          };
          expect(onNotice).toHaveBeenCalledWith(messages[destination]);
        }
        expect(clip).not.toHaveClass("dragging");
      } finally {
        if (elementFromPoint)
          Object.defineProperty(document, "elementFromPoint", elementFromPoint);
        else Reflect.deleteProperty(document, "elementFromPoint");
      }
    },
  );

  it.each(["pointercancel", "blur", "unmount"])(
    "cancels a pending drag on %s without saving",
    async (reason) => {
      const commit = vi.fn().mockResolvedValue(undefined);
      const { unmount } = render(
        <VideoEditorTimeline
          timeline={timeline}
          assets={[]}
          playheadUs={0}
          setPlayheadUs={vi.fn()}
          zoom={80}
          scrollLeft={0}
          onScrollLeftChange={vi.fn()}
          selectedClipIds={[]}
          selectClip={vi.fn()}
          commit={commit}
          onDropAsset={vi.fn()}
        />,
      );
      const clip = screen.getByRole("button", { name: /视频/ });
      fireEvent(
        clip,
        new MouseEvent("pointerdown", {
          bubbles: true,
          clientX: 20,
          button: 0,
        }),
      );
      fireEvent(window, new MouseEvent("pointermove", { clientX: 100 }));
      await act(
        () => new Promise((resolve) => window.requestAnimationFrame(resolve)),
      );
      expect(clip).toHaveClass("dragging");
      fireEvent(window, new MouseEvent("pointermove", { clientX: 120 }));
      if (reason === "unmount") unmount();
      else fireEvent(window, new Event(reason));
      await act(
        () => new Promise((resolve) => window.requestAnimationFrame(resolve)),
      );
      fireEvent(window, new MouseEvent("pointerup", { clientX: 120 }));
      expect(commit).not.toHaveBeenCalled();
      if (reason !== "unmount") expect(clip).not.toHaveClass("dragging");
    },
  );

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

  it("requests segment export for a video clip from its context menu", () => {
    const onRequestSegmentExport = vi.fn();
    const selectClip = vi.fn();
    render(
      <VideoEditorTimeline
        timeline={timeline}
        assets={[]}
        playheadUs={0}
        setPlayheadUs={vi.fn()}
        zoom={80}
        scrollLeft={0}
        onScrollLeftChange={vi.fn()}
        selectedClipId="video-left"
        selectedClipIds={["video-left"]}
        selectClip={selectClip}
        commit={vi.fn().mockResolvedValue(undefined)}
        onDropAsset={vi.fn()}
        onRequestSegmentExport={onRequestSegmentExport}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /视频/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "导出视频片段" }));

    expect(onRequestSegmentExport).toHaveBeenCalledWith("video-left");
    expect(selectClip).toHaveBeenCalledWith("video-left");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("does not offer segment export for non-video clips", () => {
    const textTimeline = {
      ...timeline,
      document: {
        ...timeline.document,
        tracks: [
          {
            ...timeline.document.tracks![0]!,
            clips: [
              {
                ...timeline.document.tracks![0]!.clips![0]!,
                kind: "text",
                name: "文字卡",
              },
            ],
          },
        ],
      },
    } as unknown as Timeline;
    render(
      <VideoEditorTimeline
        timeline={textTimeline}
        assets={[]}
        playheadUs={0}
        setPlayheadUs={vi.fn()}
        zoom={80}
        scrollLeft={0}
        onScrollLeftChange={vi.fn()}
        selectedClipId="video-left"
        selectedClipIds={["video-left"]}
        selectClip={vi.fn()}
        commit={vi.fn().mockResolvedValue(undefined)}
        onDropAsset={vi.fn()}
        onRequestSegmentExport={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /文字卡/ }));
    expect(
      screen.queryByRole("menuitem", { name: "导出视频片段" }),
    ).not.toBeInTheDocument();
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
