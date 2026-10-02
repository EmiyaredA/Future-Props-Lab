import { describe, expect, it } from "vitest";
import {
  audioTransitionOperations,
  reconcileAudioTransitionOperations,
} from "@features/video-editor/audioTransitionOperations";
import type {
  VideoEditorOperation,
  VideoEditorTimeline,
} from "@features/video-editor/types";

const timeline = {
  projectId: "project",
  revision: 1,
  updatedAt: "2026-09-25T00:00:00Z",
  document: {
    schemaVersion: "1.0",
    tracks: [
      {
        id: "a1",
        kind: "audio",
        name: "音频 1",
        order: 0,
        locked: false,
        hidden: false,
        muted: false,
        clips: [
          {
            id: "from",
            trackId: "a1",
            kind: "audio",
            name: "from",
            assetId: "one",
            timelineStartUs: 0,
            durationUs: 2_000_000,
            sourceInUs: 0,
            sourceLoop: false,
            fitMode: "cover",
            flipX: false,
            fontSize: 72,
            textColor: "#ffffff",
            volume: 1,
            keyframes: [],
          },
          {
            id: "to",
            trackId: "a1",
            kind: "audio",
            name: "to",
            assetId: "two",
            timelineStartUs: 1_000_000,
            durationUs: 2_000_000,
            sourceInUs: 0,
            sourceLoop: false,
            fitMode: "cover",
            flipX: false,
            fontSize: 72,
            textColor: "#ffffff",
            volume: 1,
            keyframes: [],
          },
        ],
      },
    ],
    transitions: [
      {
        id: "seam",
        kind: "audio-crossfade",
        durationUs: 1_000_000,
        placement: "between",
        fromClipId: "from",
        toClipId: "to",
        direction: "left",
        easing: "linear",
      },
    ],
  },
} as VideoEditorTimeline;

describe("reconcileAudioTransitionOperations", () => {
  it("captures the following linked group for one-batch undo", () => {
    const state = structuredClone(timeline);
    const audioTrack = state.document.tracks![0]!;
    const linked = {
      ...audioTrack.clips![1]!,
      id: "later-audio",
      timelineStartUs: 3_000_000,
      linkGroupId: "group",
    };
    audioTrack.clips!.push(linked);
    state.document.tracks!.push({
      ...audioTrack,
      id: "visual",
      kind: "visual",
      order: 1,
      clips: [
        { ...linked, id: "later-visual", trackId: "visual", kind: "image" },
      ],
    });
    const transition = state.document.transitions![0]!;
    const result = audioTransitionOperations(
      state,
      audioTrack.clips![0]!,
      audioTrack.clips![1]!,
      transition,
      "audio-dip",
      500_000,
      "ease-in-out",
    );
    expect(result.redo).toEqual([
      expect.objectContaining({
        type: "setAudioTransition",
        kind: "audio-dip",
      }),
    ]);
    expect(result.undo[1]).toEqual(
      expect.objectContaining({
        type: "restoreClipStates",
        clips: expect.arrayContaining([
          expect.objectContaining({ id: "to" }),
          expect.objectContaining({ id: "later-audio" }),
          expect.objectContaining({ id: "later-visual" }),
        ]),
      }),
    );
  });
  it("removes a zero-overlap seam in the move batch and restores it on undo", () => {
    const redo: VideoEditorOperation[] = [
      {
        type: "moveClip",
        clipId: "to",
        trackId: "a1",
        timelineStartUs: 2_000_000,
      },
    ];
    const undo: VideoEditorOperation[] = [
      {
        type: "moveClip",
        clipId: "to",
        trackId: "a1",
        timelineStartUs: 1_000_000,
      },
    ];
    const result = reconcileAudioTransitionOperations(timeline, redo, undo);
    expect(result.redo.at(-1)).toEqual({
      type: "removeTransition",
      transitionId: "seam",
    });
    expect(result.undo.at(-1)).toEqual({
      type: "addTransition",
      transition: timeline.document.transitions?.[0],
    });
  });

  it("keeps the seam when trimming leaves a positive overlap", () => {
    const redo: VideoEditorOperation[] = [
      {
        type: "trimClip",
        clipId: "from",
        timelineStartUs: 0,
        durationUs: 1_500_000,
        sourceInUs: 0,
      },
    ];
    expect(reconcileAudioTransitionOperations(timeline, redo, []).redo).toEqual(
      redo,
    );
  });
});
