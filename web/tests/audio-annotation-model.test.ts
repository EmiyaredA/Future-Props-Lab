import {
  buildProjectFile,
  buildSrt,
  createSegmentInGap,
  formatSrtTimestamp,
  mergeWithNext,
  parseProjectFile,
  parseTimestamp,
  splitSegment,
  updateSegmentBounds,
} from "@features/audio-annotation/model";
import type {
  AudioAnnotationProject,
  AudioAnnotationSegment,
  AudioAnnotationSpeaker,
} from "@features/audio-annotation/types";

const speakers: AudioAnnotationSpeaker[] = [
  { id: "host", name: "主持人", color: "#28B8A7" },
  { id: "guest", name: "嘉宾", color: "#4C8FE8" },
];

const segments: AudioAnnotationSegment[] = [
  {
    id: "one",
    start_ms: 0,
    end_ms: 1_000,
    speaker_id: "host",
    text: "第一句",
    status: "reviewed",
  },
  {
    id: "two",
    start_ms: 1_200,
    end_ms: 2_000,
    speaker_id: "guest",
    text: "第二句",
    status: "reviewed",
  },
];

test("formats and parses millisecond timestamps", () => {
  expect(parseTimestamp("01:02.345")).toBe(62_345);
  expect(parseTimestamp("01:01:02.345")).toBe(3_662_345);
  expect(parseTimestamp("01:60.000")).toBeNull();
  expect(formatSrtTimestamp(0)).toBe("00:00:00,000");
  expect(formatSrtTimestamp(3_662_345)).toBe("01:01:02,345");
});

test("splits a segment while preserving the left text and resetting review", () => {
  const result = splitSegment(segments, "one", 600, () => "created");
  expect(result).toEqual([
    { ...segments[0], end_ms: 600, status: "draft" },
    {
      ...segments[0],
      id: "created",
      start_ms: 600,
      text: "",
      status: "draft",
    },
    segments[1],
  ]);
  expect(splitSegment(segments, "one", 50)).toBeNull();
});

test("merges through a gap and retains the current speaker", () => {
  const result = mergeWithNext(segments, "one");
  expect(result).toEqual([
    {
      ...segments[0],
      end_ms: 2_000,
      text: "第一句\n第二句",
      status: "draft",
    },
  ]);
});

test("only creates segments in free gaps and clamps dragged bounds", () => {
  expect(createSegmentInGap(segments, 1_025, 1_175, () => "gap")?.[1]).toEqual({
    id: "gap",
    start_ms: 1_025,
    end_ms: 1_175,
    speaker_id: null,
    text: "",
    status: "draft",
  });
  expect(createSegmentInGap(segments, 900, 1_300)).toBeNull();
  expect(
    updateSegmentBounds(segments, "two", 800, 2_500, 2_200)?.[1],
  ).toMatchObject({
    start_ms: 1_000,
    end_ms: 2_200,
    status: "draft",
  });
});

test("exports versioned JSON and speaker-prefixed SRT", () => {
  const project = {
    id: "project",
    title: "产品访谈",
    asset_id: "asset",
    asset_display_name: "访谈录音",
    original_filename: "interview.wav",
    mime_type: "audio/wav",
    byte_size: 1024,
    duration_ms: 2_000,
    segment_count: 2,
    reviewed_segment_count: 2,
    waveform_ready: true,
    document_revision: 3,
    revision: 1,
    created_at: "2026-08-20T00:00:00Z",
    updated_at: "2026-08-20T00:00:00Z",
  } satisfies AudioAnnotationProject;
  const exported = buildProjectFile(project, {
    schema_version: "1.0",
    speakers,
    segments,
  });
  expect(parseProjectFile(exported)).toBe(exported);
  expect(exported.project.source.original_filename).toBe("interview.wav");
  expect(buildSrt(segments, speakers)).toContain(
    "00:00:00,000 --> 00:00:01,000\n主持人：第一句",
  );
  expect(() => buildSrt([{ ...segments[0]!, text: "" }], speakers)).toThrow(
    "1 个片段缺少说话人或内容",
  );
});
