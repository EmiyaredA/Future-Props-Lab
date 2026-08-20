import {
  buildProjectFile,
  buildSrt,
  buildTranscriptionFile,
  clampWaveformZoom,
  createSegment,
  duplicateSegmentForOverlap,
  formatSrtTimestamp,
  mergeImportedSpeakers,
  mergeWithNext,
  parseAudioAnnotationImportFile,
  parseProjectFile,
  parseTimestamp,
  segmentLanguageCodes,
  segmentSearchableText,
  splitSegment,
  updateSegmentBounds,
  waveformFocusZoom,
  waveformViewport,
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
    language: "zh",
    localized_texts: [],
    status: "reviewed",
  },
  {
    id: "two",
    start_ms: 1_200,
    end_ms: 2_000,
    speaker_id: "guest",
    text: "第二句",
    language: "zh",
    localized_texts: [],
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

test("calculates bounded waveform zoom and viewport around a selected range", () => {
  expect(clampWaveformZoom(0)).toBe(1);
  expect(clampWaveformZoom(999)).toBe(256);
  expect(waveformFocusZoom(1_800_000, 900_000, 910_000)).toBe(100);
  expect(waveformFocusZoom(1_800_000, 10_000, 10_100)).toBe(256);
  expect(waveformViewport(1_800_000, 100, 905_000)).toEqual({
    startMs: 896_000,
    endMs: 914_000,
  });
  expect(waveformViewport(1_800_000, 100, 2_000)).toEqual({
    startMs: 0,
    endMs: 18_000,
  });
});

test("collects and searches every language version of one audio segment", () => {
  const multilingual = {
    ...segments[0]!,
    language: "ja",
    text: "大丈夫。",
    localized_texts: [
      { language: "zh", text: "没问题。" },
      { language: "en", text: "Don't worry." },
    ],
  };
  expect(segmentLanguageCodes(multilingual)).toEqual(["ja", "zh", "en"]);
  expect(segmentSearchableText(multilingual)).toBe(
    "大丈夫。 没问题。 Don't worry.",
  );
});

test("imports Galgame character names without duplicating existing speakers", () => {
  expect(
    mergeImportedSpeakers(
      [{ id: "okabe", name: "冈部伦太郎", color: "#28B8A7" }],
      [
        { id: "okabe", name: "冈部伦太郎", color: "#E75B55" },
        { id: "kurisu", name: "牧濑红莉栖", color: "#4AA3DF" },
        { id: "mayuri", name: "椎名真由理", color: "not-a-color" },
      ],
      () => "generated-speaker",
    ),
  ).toEqual([
    { id: "okabe", name: "冈部伦太郎", color: "#28B8A7" },
    { id: "kurisu", name: "牧濑红莉栖", color: "#4AA3DF" },
    { id: "mayuri", name: "椎名真由理", color: "#9B62D0" },
  ]);
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

test("duplicates a time range for assigning another overlapping speaker", () => {
  expect(duplicateSegmentForOverlap(segments, "one", () => "overlap")).toEqual([
    segments[0],
    {
      ...segments[0],
      id: "overlap",
      speaker_id: null,
      text: "",
      status: "draft",
    },
    segments[1],
  ]);
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

test("creates overlapping segments and only clamps bounds to the audio", () => {
  expect(createSegment(segments, 1_025, 1_175, () => "gap")?.[1]).toEqual({
    id: "gap",
    start_ms: 1_025,
    end_ms: 1_175,
    speaker_id: null,
    text: "",
    language: null,
    localized_texts: [],
    status: "draft",
  });
  expect(createSegment(segments, 900, 1_300, () => "overlap")?.[1]).toEqual({
    id: "overlap",
    start_ms: 900,
    end_ms: 1_300,
    speaker_id: null,
    text: "",
    language: null,
    localized_texts: [],
    status: "draft",
  });
  expect(
    updateSegmentBounds(segments, "two", 800, 2_500, 2_200)?.[1],
  ).toMatchObject({
    start_ms: 800,
    end_ms: 2_200,
    status: "draft",
  });
});

test("merging a segment with a contained overlapping segment does not shorten it", () => {
  expect(
    mergeWithNext(
      [segments[0]!, { ...segments[1]!, start_ms: 200, end_ms: 800 }],
      "one",
    )?.[0],
  ).toMatchObject({ start_ms: 0, end_ms: 1_000 });
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

test("exports and parses the portable transcription JSON format", () => {
  const exported = buildTranscriptionFile({
    id: "transcription-1",
    provider_id: "provider-1",
    model_id: "model-1",
    provider_kind: "senseaudio_asr",
    provider_name: "专业识别",
    model_slug: "pro-asr",
    language: "ja",
    parameters: {
      language: "ja",
      target_language: null,
      enable_word_timestamps: false,
      enable_text_edit: true,
      enable_speaker_diarization: true,
      max_speakers: null,
      enable_punctuation: false,
      hotwords: null,
      abbreviations: false,
    },
    status: "completed",
    source: {
      kind: "library",
      source_asset_id: "asset-1",
      filename: "episode.wav",
      mime_type: "audio/wav",
      byte_size: 2048,
      available: true,
    },
    result_text: "识别全文",
    result_segments: [
      {
        speaker: "SPK_0",
        start_ms: 0,
        end_ms: 900,
        text: "第一句",
        is_overlap: false,
      },
    ],
    result_detail: { processing_status: "success" },
    error_message: null,
    log_id: "log-1",
    revision: 1,
    created_at: "2026-08-20T00:00:00Z",
    updated_at: "2026-08-20T00:00:01Z",
    started_at: "2026-08-20T00:00:00Z",
    completed_at: "2026-08-20T00:00:01Z",
  });

  expect(exported.kind).toBe("future-props-transcription");
  expect(exported.schema_version).toBe("1.1");
  expect(exported.source.asset_id).toBe("asset-1");
  expect(exported.recognition.segments[0]?.speaker).toBe("SPK_0");
  expect(parseAudioAnnotationImportFile(exported)).toEqual(exported);
  expect(() =>
    parseAudioAnnotationImportFile({
      kind: "future-props-transcription",
      schema_version: "0.9",
    }),
  ).toThrow("语音识别结果 JSON 1.0 或 1.1");

  expect(
    parseAudioAnnotationImportFile({
      ...exported,
      schema_version: "1.0",
      recognition: {
        ...exported.recognition,
        parameters: undefined,
        result_detail: undefined,
      },
    }),
  ).toMatchObject({ schema_version: "1.0" });
});
