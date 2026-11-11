import { describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { useSubtitleImport } from "@features/video-editor/useSubtitleImport";
import userEvent from "@testing-library/user-event";
import { VideoEditorSubtitleImportDialog } from "@features/video-editor/VideoEditorSubtitleImportDialog";
import {
  parseSubtitleText,
  subtitleImportOperations,
  type SubtitleParseResult,
} from "@features/video-editor/subtitleImport";
import type { VideoEditorTrack } from "@features/video-editor/types";

const track = (id: string, order: number): VideoEditorTrack => ({
  id,
  kind: "visual",
  name: id,
  order,
  locked: false,
  hidden: false,
  muted: false,
  clips: [],
});

describe("字幕文件解析", () => {
  it("parses SRT milliseconds, multiline text, and overlap warnings", () => {
    const result = parseSubtitleText(
      "song.srt",
      [
        "1",
        "00:00:01,2 --> 00:00:02,250",
        "第一行",
        "第二行",
        "",
        "2",
        "00:00:02,000 --> 00:00:03,000",
        "重叠字幕",
      ].join("\n"),
    );

    expect(result.cues).toHaveLength(1);
    expect(result.cues[0]).toMatchObject({
      startUs: 1_200_000,
      endUs: 2_250_000,
      text: "第一行\n第二行",
    });
    expect(result.skippedCount).toBe(1);
    expect(result.warnings[0]?.message).toContain("重叠");
  });

  it("parses VTT cue ids, settings, and markup", () => {
    const result = parseSubtitleText(
      "song.vtt",
      [
        "WEBVTT",
        "",
        "intro",
        "00:01.000 --> 00:02.500 align:center",
        "<i>Hello</i><br>世界",
      ].join("\n"),
    );

    expect(result.format).toBe("vtt");
    expect(result.cues).toEqual([
      expect.objectContaining({
        startUs: 1_000_000,
        endUs: 2_500_000,
        text: "Hello\n世界",
      }),
    ]);
  });

  it("parses ASS dialogue text and removes override tags", () => {
    const result = parseSubtitleText(
      "song.ass",
      [
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        "Dialogue: 0,0:00:01.00,0:00:03.25,Default,,0,0,0,,{\\i1}日本語\\N中文,含逗号",
      ].join("\n"),
    );

    expect(result.format).toBe("ass");
    expect(result.cues[0]).toMatchObject({
      startUs: 1_000_000,
      endUs: 3_250_000,
      text: "日本語\n中文,含逗号",
    });
  });

  it("reports malformed and empty cues without throwing", () => {
    const result = parseSubtitleText(
      "broken.srt",
      [
        "1",
        "bad timing",
        "text",
        "",
        "2",
        "00:00:01,000 --> 00:00:02,000",
        " ",
      ].join("\n"),
    );

    expect(result.cues).toHaveLength(0);
    expect(result.skippedCount).toBe(2);
    expect(result.warnings).toHaveLength(2);
  });
});

describe("字幕时间轴操作", () => {
  it("creates a new top subtitle track and supports playhead offset", () => {
    const parsed = parseSubtitleText(
      "song.srt",
      "1\n00:00:01,000 --> 00:00:02,000\n字幕",
    );
    const result = subtitleImportOperations(
      parsed.cues,
      [track("picture", 0), track("audio", 1)],
      5_000_000,
      "playhead",
    );

    expect(result.track).toMatchObject({
      name: "字幕",
      kind: "visual",
      order: 0,
    });
    expect(result.track.clips?.[0]).toMatchObject({
      timelineStartUs: 5_000_000,
      durationUs: 1_000_000,
      text: "字幕",
      fontSize: 48,
      textMaxWidth: 1600,
      textStyle: { strokeWidth: 2 },
      transform: { y: 1000, anchor: "bottomCenter" },
    });
    expect(result.offset).toBe(4_000_000);
    expect(result.redo.slice(0, 2)).toEqual([
      { type: "reorderTrack", trackId: "picture", order: 1 },
      { type: "reorderTrack", trackId: "audio", order: 2 },
    ]);
    expect(result.redo.at(-1)?.type).toBe("addTrack");
    expect(result.undo[0]).toEqual({
      type: "removeTrack",
      trackId: result.track.id,
    });
  });
});

describe("字幕导入预览", () => {
  it("lets the user choose timing mode and confirms valid cues", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const result: SubtitleParseResult = {
      format: "srt",
      cues: [{ startUs: 0, endUs: 1_000_000, text: "字幕", line: 2 }],
      warnings: [],
      skippedCount: 0,
    };
    render(
      <VideoEditorSubtitleImportDialog
        fileName="song.srt"
        result={result}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText("有效字幕：1 条")).toBeInTheDocument();
    await user.click(
      screen.getByRole("radio", { name: /首条字幕对齐当前播放头/ }),
    );
    await user.click(screen.getByRole("button", { name: "导入 1 条字幕" }));
    expect(onConfirm).toHaveBeenCalledWith("playhead");
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows parser warnings before import", () => {
    const result: SubtitleParseResult = {
      format: "vtt",
      cues: [],
      warnings: [{ line: 4, message: "时间码无法识别，已跳过" }],
      skippedCount: 1,
    };
    render(
      <VideoEditorSubtitleImportDialog
        fileName="broken.vtt"
        result={result}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText("已发现 1 个问题")).toBeInTheDocument();
    expect(
      screen.getByText("第 4 行：时间码无法识别，已跳过"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "导入 0 条字幕" }),
    ).toBeDisabled();
  });
});

it("ignores a previous subtitle parse after choosing a replacement and cancelling it", async () => {
  const view = renderHook(() =>
    useSubtitleImport({
      projectId: "project",
      playheadUs: 0,
      commit: vi.fn(),
      onCommitted: vi.fn(),
    }),
  );
  const first = new File([], "first.srt");
  let finishFirst!: (text: string) => void;
  Object.defineProperty(first, "text", {
    value: () =>
      new Promise<string>((resolve) => {
        finishFirst = resolve;
      }),
  });
  let pending!: Promise<void>;
  act(() => {
    pending = view.result.current.read(first);
  });
  const second = new File([], "second.srt");
  Object.defineProperty(second, "text", {
    value: async () => "1\n00:00:01,000 --> 00:00:02,000\n替换",
  });
  await act(() => view.result.current.read(second));
  expect(view.result.current.dialog?.result?.cues[0]?.text).toBe("替换");
  act(() => view.result.current.dialog?.onCancel());
  await act(async () => {
    finishFirst("1\n00:00:01,000 --> 00:00:02,000\n原文件");
    await pending;
  });
  expect(view.result.current.dialog).toBeUndefined();
});
