import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoEditorAudioSeamPanel } from "@features/video-editor/VideoEditorAudioSeamPanel";
import { VideoEditorClipWaveform } from "@features/video-editor/VideoEditorClipWaveform";
import {
  audioSeamOperations,
  audioSeamPairForSelection,
} from "@features/video-editor/audioSeamModel";
import type {
  AudioSeamCandidates,
  VideoEditorAsset,
  VideoEditorClip,
  VideoEditorTimeline,
} from "@features/video-editor/types";

const clip = (id: string, start: number, sourceIn: number): VideoEditorClip =>
  ({
    id,
    trackId: "audio-1",
    kind: "audio",
    name: id,
    assetId: "song",
    timelineStartUs: start,
    durationUs: 5_000_000,
    sourceInUs: sourceIn,
    playbackRate: 1,
    keyframes: [],
  }) as unknown as VideoEditorClip;

const from = clip("a", 0, 0);
const to = clip("b", 5_000_000, 8_000_000);
const later = clip("c", 10_000_000, 13_000_000);
const timeline = {
  projectId: "project",
  revision: 4,
  updatedAt: "2026-10-02T00:00:00Z",
  document: {
    settings: {
      width: 1920,
      height: 1080,
      fps: 30,
      backgroundColor: "#000000",
    },
    tracks: [
      {
        id: "audio-1",
        kind: "audio",
        order: 0,
        name: "music",
        clips: [from, to, later],
      },
    ],
    transitions: [],
  },
} as unknown as VideoEditorTimeline;

const candidates = {
  assetId: "song",
  referenceStartUs: 3_000_000,
  referencePeaks: [0.1, 0.2, 0.1],
  candidates: [
    {
      sourceInUs: 9_000_000,
      suggestedFadeUs: 300_000,
      matchReasons: ["节奏接近"],
      peaks: [0.2, 0.1],
    },
    {
      sourceInUs: 10_000_000,
      suggestedFadeUs: 150_000,
      matchReasons: ["音色接近"],
      peaks: [0.1, 0.2],
    },
  ],
} as AudioSeamCandidates;

describe("audio seam assistant", () => {
  it("finds the adjacent pair and snapshots following clips for one undoable operation", () => {
    expect(
      audioSeamPairForSelection(timeline.document.tracks!, ["b"])?.from.id,
    ).toBe("a");
    const operations = audioSeamOperations(
      timeline,
      from,
      to,
      9_000_000,
      300_000,
    );
    expect(operations.redo).toMatchObject([
      {
        type: "alignAudioSeam",
        fromClipId: "a",
        toClipId: "b",
        sourceInUs: 9_000_000,
      },
    ]);
    expect(operations.undo[0]).toMatchObject({ type: "removeTransition" });
    expect(operations.undo[1]).toMatchObject({
      type: "restoreClipStates",
      clips: [to, later],
    });
  });

  it("maps the source waveform offset and playback rate into clip width", () => {
    const asset = {
      probe: { durationUs: 20_000_000 },
    } as unknown as VideoEditorAsset;
    const { container } = render(
      <VideoEditorClipWaveform
        asset={asset}
        clip={{ ...to, playbackRate: 2 }}
        url="blob:wave"
      />,
    );
    const image = container.querySelector("img")!;
    expect(image.style.width).toBe("200%");
    expect(image.style.left).toBe("-80%");
  });

  it("keeps candidate selection read-only until applying the chosen cut", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    const onSelect = vi.fn();
    const { rerender } = render(
      <VideoEditorAudioSeamPanel
        from={from}
        to={to}
        data={candidates}
        loading={false}
        selected={0}
        onSelect={onSelect}
        onApply={onApply}
        onClose={vi.fn()}
        fps={30}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /候选 2/ }));
    expect(onSelect).toHaveBeenCalledWith(1);
    expect(onApply).not.toHaveBeenCalled();
    rerender(
      <VideoEditorAudioSeamPanel
        from={from}
        to={to}
        data={candidates}
        loading={false}
        selected={1}
        onSelect={onSelect}
        onApply={onApply}
        onClose={vi.fn()}
        fps={30}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "应用修剪与淡化" }));
    await waitFor(() =>
      expect(onApply).toHaveBeenCalledWith(10_000_000, 150_000),
    );
  });
});
