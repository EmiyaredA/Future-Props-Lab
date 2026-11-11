import { describe, expect, it } from "vitest";
import { prepareAssetBatch } from "@features/video-editor/assetBatch";
import {
  audioSeamGainAt,
  clipAudioGainAt,
  clipPropertyAt,
  formatTime,
  frameUs,
  operationsForAsset,
  snapUs,
  timelineDuration,
} from "@features/video-editor/editorModel";
import {
  canPlaceClip,
  clipPlacementError,
  linkedClipIds,
  snapClipStartUs,
} from "@features/video-editor/timelineSnap";
import type {
  VideoEditorAsset,
  VideoEditorTimeline,
  VideoEditorTrack,
} from "@features/video-editor/types";

const tracks: VideoEditorTrack[] = [
  {
    id: "v1",
    kind: "visual",
    name: "V1",
    order: 0,
    locked: false,
    hidden: false,
    muted: false,
    clips: [],
  },
  {
    id: "a1",
    kind: "audio",
    name: "A1",
    order: 1,
    locked: false,
    hidden: false,
    muted: false,
    clips: [],
  },
];

const video: VideoEditorAsset = {
  id: "asset-video",
  displayName: "采访",
  originalFilename: "interview.mp4",
  revision: 0,
  mediaKind: "video",
  mimeType: "video/mp4",
  byteSize: 100,
  processingStatus: "ready",
  probe: { durationUs: 8_000_000 },
  createdAt: "2026-08-24T00:00:00Z",
};

describe("video editor timeline model", () => {
  it("applies audio fade envelopes at both clip edges", () => {
    const operation = operationsForAsset(video, tracks, 0)[1];
    if (operation?.type !== "addClip") throw new Error("unexpected operation");
    const clip = {
      ...operation.clip,
      transitionIn: {
        kind: "audio-crossfade" as const,
        durationUs: 1_000_000,
        direction: "left" as const,
        easing: "linear" as const,
      },
      transitionOut: {
        kind: "audio-crossfade" as const,
        durationUs: 2_000_000,
        direction: "left" as const,
        easing: "linear" as const,
      },
    };
    expect(clipAudioGainAt(clip, 0)).toBe(0);
    expect(clipAudioGainAt(clip, 500_000)).toBe(0.5);
    expect(clipAudioGainAt(clip, 2_000_000)).toBe(1);
    expect(clipAudioGainAt(clip, 7_000_000)).toBe(0.5);
    expect(
      clipAudioGainAt(
        { ...clip, transitionIn: { ...clip.transitionIn, durationUs: 0 } },
        0,
      ),
    ).toBe(1);
  });

  it("crossfades overlapping audio clips with the selected easing", () => {
    const operation = operationsForAsset(video, tracks, 0)[1];
    if (operation?.type !== "addClip") throw new Error("unexpected operation");
    const from = {
      ...operation.clip,
      id: "from",
      timelineStartUs: 0,
      durationUs: 2_000_000,
    };
    const to = {
      ...operation.clip,
      id: "to",
      timelineStartUs: 1_000_000,
      durationUs: 2_000_000,
    };
    const clips = new Map([
      [from.id, from],
      [to.id, to],
    ]);
    const transitions = [
      {
        id: "audio-seam",
        kind: "audio-crossfade" as const,
        durationUs: 1_000_000,
        placement: "between" as const,
        fromClipId: from.id,
        toClipId: to.id,
        direction: "left" as const,
        easing: "ease-in" as const,
      },
    ];
    expect(audioSeamGainAt(from, 1_000_000, transitions, clips)).toBe(1);
    expect(audioSeamGainAt(to, 1_000_000, transitions, clips)).toBe(0);
    expect(audioSeamGainAt(from, 1_500_000, transitions, clips)).toBe(0.75);
    expect(audioSeamGainAt(to, 1_500_000, transitions, clips)).toBe(0.25);
    expect(audioSeamGainAt(from, 2_000_000, transitions, clips)).toBe(0);
    expect(audioSeamGainAt(to, 2_000_000, transitions, clips)).toBe(1);

    const fadedTo = {
      ...to,
      transitionIn: {
        kind: "audio-crossfade" as const,
        durationUs: 1_000_000,
        direction: "left" as const,
        easing: "ease-in" as const,
      },
      keyframes: [
        {
          id: "volume",
          property: "volume" as const,
          timeUs: 0,
          value: 0.4,
          interpolation: "linear" as const,
        },
      ],
    };
    const localUs = 500_000;
    const combined =
      clipPropertyAt(fadedTo, "volume", localUs, fadedTo.volume) *
      clipAudioGainAt(fadedTo, localUs) *
      audioSeamGainAt(fadedTo, 1_500_000, transitions, clips);
    expect(combined).toBeCloseTo(0.025, 6);

    const extendedFrom = { ...from, durationUs: 3_000_000 };
    const shortTo = { ...to, durationUs: 1_000_000 };
    const contained = new Map([
      [extendedFrom.id, extendedFrom],
      [shortTo.id, shortTo],
    ]);
    expect(
      audioSeamGainAt(extendedFrom, 2_500_000, transitions, contained),
    ).toBe(1);
  });

  it("snaps microseconds to exact 30/60 fps grids", () => {
    expect(frameUs(30)).toBe(33_333);
    expect(frameUs(60)).toBe(16_667);
    expect(snapUs(34_000, 30)).toBe(33_333);
    expect(snapUs(49_000, 60)).toBe(50_001);
    expect(formatTime(61_234_000)).toBe("01:01.234");
  });

  it("creates linked picture and original audio clips for video", () => {
    const operations = operationsForAsset(video, tracks, 1_000_000);
    expect(operations).toHaveLength(2);
    expect(operations[0]?.type).toBe("addClip");
    expect(operations[1]?.type).toBe("addClip");
    if (operations[0]?.type !== "addClip" || operations[1]?.type !== "addClip")
      throw new Error("unexpected operation");
    expect(operations[0].clip.trackId).toBe("v1");
    expect(operations[1].clip.trackId).toBe("a1");
    expect(operations[0].clip.linkGroupId).toBe(operations[1].clip.linkGroupId);
    expect(operations[0].clip.durationUs).toBe(8_000_000);
  });

  it("derives the visible duration from every track", () => {
    const operation = operationsForAsset(video, tracks, 2_000_000)[0];
    if (operation?.type !== "addClip") throw new Error("unexpected operation");
    const timeline = {
      projectId: "project",
      revision: 1,
      updatedAt: "2026-08-24T00:00:00Z",
      document: {
        schemaVersion: "1.0",
        tracks: [
          {
            ...tracks[0],
            clips: [operation.clip],
          },
        ],
      },
    } as unknown as VideoEditorTimeline;
    expect(timelineDuration(timeline)).toBe(10_000_000);
  });

  it("snaps clip starts to the timeline edge and neighboring seams", () => {
    const firstOperation = operationsForAsset(video, tracks, 1_000_000)[0];
    if (firstOperation?.type !== "addClip")
      throw new Error("unexpected operation");
    const first = {
      ...firstOperation.clip,
      id: "first",
      timelineStartUs: 1_000_000,
      durationUs: 2_000_000,
      trackId: "v1",
    };
    const second = { ...first, id: "second", timelineStartUs: 5_000_000 };
    const visualTracks = [{ ...tracks[0]!, clips: [first, second] }];
    const moving = new Set([first.id]);
    expect(
      snapClipStartUs({
        candidateUs: 2_960_000,
        durationUs: first.durationUs,
        targetTrackId: "v1",
        tracks: visualTracks,
        movingClipIds: moving,
        fps: 30,
        zoom: 80,
        timelineEndUs: 30_000_000,
        enabled: true,
      }),
    ).toBe(3_000_000);
    expect(
      snapClipStartUs({
        candidateUs: 40_000,
        durationUs: first.durationUs,
        targetTrackId: "v1",
        tracks: visualTracks,
        movingClipIds: moving,
        fps: 30,
        zoom: 80,
        timelineEndUs: 30_000_000,
        enabled: false,
      }),
    ).toBe(33_333);
    expect(
      snapClipStartUs({
        candidateUs: 27_960_000,
        durationUs: first.durationUs,
        targetTrackId: "v1",
        tracks: visualTracks,
        movingClipIds: moving,
        fps: 30,
        zoom: 80,
        timelineEndUs: 30_000_000,
        enabled: true,
      }),
    ).toBe(28_000_000);
    expect(
      snapClipStartUs({
        candidateUs: 27_800_000,
        durationUs: first.durationUs,
        targetTrackId: "v1",
        tracks: visualTracks,
        movingClipIds: moving,
        fps: 30,
        zoom: 80,
        timelineEndUs: 30_000_000,
        enabled: true,
      }),
    ).toBe(snapUs(27_800_000, 30));
  });

  it("snaps clip edges to clips on other tracks", () => {
    const operation = operationsForAsset(video, tracks, 0)[0];
    if (operation?.type !== "addClip") throw new Error("unexpected operation");
    const onAudio = {
      ...operation.clip,
      id: "audio-anchor",
      kind: "audio" as const,
      trackId: "a1",
      timelineStartUs: 5_000_000,
      durationUs: 2_000_000,
    };
    const moving = {
      ...operation.clip,
      id: "visual-moving",
      trackId: "v1",
      timelineStartUs: 0,
      durationUs: 1_500_000,
    };
    const crossTracks: VideoEditorTrack[] = [
      { ...tracks[0]!, clips: [moving] },
      { ...tracks[1]!, clips: [onAudio] },
    ];
    const movingIds = new Set([moving.id]);
    expect(
      snapClipStartUs({
        candidateUs: 4_960_000,
        durationUs: moving.durationUs,
        targetTrackId: "v1",
        tracks: crossTracks,
        movingClipIds: movingIds,
        fps: 30,
        zoom: 80,
        timelineEndUs: 30_000_000,
        enabled: true,
      }),
    ).toBe(5_000_000);
    expect(
      snapClipStartUs({
        candidateUs: 5_460_000,
        durationUs: moving.durationUs,
        targetTrackId: "v1",
        tracks: crossTracks,
        movingClipIds: movingIds,
        fps: 30,
        zoom: 80,
        timelineEndUs: 30_000_000,
        enabled: true,
      }),
    ).toBe(5_500_000);
    expect(
      snapClipStartUs({
        candidateUs: 4_960_000,
        durationUs: moving.durationUs,
        targetTrackId: "v1",
        tracks: crossTracks,
        movingClipIds: movingIds,
        fps: 30,
        zoom: 80,
        timelineEndUs: 30_000_000,
        enabled: false,
      }),
    ).toBe(snapUs(4_960_000, 30));
  });

  it.each([30, 60])("preserves exact clip seams at %i fps", (fps) => {
    const operation = operationsForAsset(video, tracks, 0)[0];
    if (operation?.type !== "addClip") throw new Error("unexpected operation");
    const neighbor = {
      ...operation.clip,
      id: "neighbor",
      timelineStartUs: 4_000_000,
      durationUs: 2_333_333,
    };
    const moving = { ...neighbor, id: "moving", durationUs: 3_042_000 };
    for (const kind of ["visual", "mixed"] as const) {
      const seamTracks = [{ ...tracks[0]!, kind, clips: [neighbor] }];
      const movingIds = new Set([moving.id]);
      for (const expectedStartUs of [
        neighbor.timelineStartUs - moving.durationUs,
        neighbor.timelineStartUs + neighbor.durationUs,
      ]) {
        const startUs = snapClipStartUs({
          candidateUs: expectedStartUs + 20_000,
          durationUs: moving.durationUs,
          targetTrackId: "v1",
          tracks: seamTracks,
          movingClipIds: movingIds,
          fps,
          zoom: 80,
          timelineEndUs: 30_000_000,
          enabled: true,
        });
        expect(startUs).toBe(expectedStartUs);
        expect(canPlaceClip(moving, startUs, "v1", seamTracks, movingIds)).toBe(
          true,
        );
      }
      expect(
        canPlaceClip(
          moving,
          neighbor.timelineStartUs + neighbor.durationUs - 1,
          "v1",
          seamTracks,
          movingIds,
        ),
      ).toBe(false);
      expect(
        canPlaceClip(
          moving,
          neighbor.timelineStartUs - moving.durationUs + 1,
          "v1",
          seamTracks,
          movingIds,
        ),
      ).toBe(false);
    }
  });

  it("explains how to move video out of a mixed track", () => {
    const operation = operationsForAsset(video, tracks, 0)[0];
    if (operation?.type !== "addClip") throw new Error("unexpected operation");
    const clip = { ...operation.clip, trackId: "mixed" };
    const allTracks = [
      ...tracks,
      {
        ...tracks[0]!,
        id: "mixed",
        kind: "mixed" as const,
        name: "原声视频",
        clips: [clip],
      },
    ];
    expect(
      clipPlacementError(clip, 0, "v1", allTracks, new Set([clip.id])),
    ).toBe(
      "混合轨的视频不能直接移入视觉轨「V1」，请先右键片段选择「分离轨道」",
    );
    expect(
      clipPlacementError(clip, 0, "mixed", allTracks, new Set([clip.id])),
    ).toBeUndefined();
  });

  it("expands selected linked clips and rejects visual overlaps", () => {
    const operations = operationsForAsset(video, tracks, 0);
    if (operations[0]?.type !== "addClip" || operations[1]?.type !== "addClip")
      throw new Error("unexpected operation");
    const picture = {
      ...operations[0].clip,
      id: "picture",
      trackId: "v1",
      linkGroupId: "group",
    };
    const audio = {
      ...operations[1].clip,
      id: "audio",
      trackId: "a1",
      linkGroupId: "group",
    };
    const blocker = {
      ...picture,
      id: "blocker",
      linkGroupId: undefined,
      timelineStartUs: 2_000_000,
    };
    const allTracks = [
      { ...tracks[0]!, clips: [picture, blocker] },
      { ...tracks[1]!, clips: [audio] },
    ];
    expect(linkedClipIds([picture, audio, blocker], ["picture"])).toEqual(
      new Set(["picture", "audio"]),
    );
    expect(
      canPlaceClip(
        picture,
        1_000_000,
        "v1",
        allTracks,
        new Set(["picture", "audio"]),
      ),
    ).toBe(false);
  });
});

it("appends linked clips at consecutive frames and builds undo for each new clip", () => {
  let id = 0;
  const nextId = () => `generated-${++id}`;
  const frame = frameUs(30);
  const asset = { ...video, probe: { durationUs: 240 * frame } };
  const timeline: VideoEditorTimeline = {
    document: { schemaVersion: "1.0", tracks },
    projectId: "project",
    revision: 1,
    updatedAt: "",
  };
  const batch = prepareAssetBatch(
    [asset, asset],
    120 * frame,
    nextId,
  )(timeline);
  const clips = batch.redo.flatMap((op) =>
    op.type === "addClip" ? [op.clip] : [],
  );
  expect(clips.map(({ timelineStartUs }) => timelineStartUs)).toEqual([
    120 * frame,
    120 * frame,
    360 * frame,
    360 * frame,
  ]);
  expect(clips[0]?.linkGroupId).toBe(clips[1]?.linkGroupId);
  expect(clips[0]?.linkGroupId).not.toBe(clips[2]?.linkGroupId);
  expect(batch.undo).toEqual(
    clips.map(({ id }) => ({ type: "removeClip", clipId: id })),
  );
  expect(() =>
    prepareAssetBatch(
      [video],
      0,
      nextId,
    )({
      ...timeline,
      document: {
        ...timeline.document,
        tracks: tracks.map((track) => ({
          ...track,
          locked: track.kind === "audio",
        })),
      },
    }),
  ).toThrow("轨道锁定");
  expect(() => prepareAssetBatch(Array(101).fill(video), 0, nextId)).toThrow(
    "100",
  );
});
