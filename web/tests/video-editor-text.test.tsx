import { createRef } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  textClipOperations,
  textPositionOperations,
} from "@features/video-editor/textModel";
import { VideoEditorTextInspector } from "@features/video-editor/VideoEditorTextInspector";
import { VideoEditorTextLayer } from "@features/video-editor/VideoEditorTextLayer";
import type { VideoEditorTrack } from "@features/video-editor/types";

vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: () => ({ url: "blob:text", loading: false, error: null }),
}));

const track: VideoEditorTrack = {
  id: "text",
  kind: "visual",
  name: "文字",
  order: 0,
  clips: [],
  locked: false,
  hidden: false,
  muted: false,
};

describe("文字添加与撤销", () => {
  it("reuses an available top text track and snaps subtitle timing", () => {
    const result = textClipOperations([track], 123456, 30, "subtitle");
    expect(result.redo).toHaveLength(1);
    expect(result.clip.trackId).toBe("text");
    expect(result.clip.timelineStartUs).toBeCloseTo(133333, 0);
    expect(result.clip.durationUs).toBe(3000000);
    expect(result.clip).toMatchObject({
      fontSize: 48,
      textMaxWidth: 1600,
      fitMode: "native",
      textStyle: { strokeWidth: 2 },
      transform: { y: 1000, anchor: "bottomCenter" },
    });
    expect(result.undo).toEqual([
      { type: "removeClip", clipId: result.clip.id },
    ]);
  });
  it.each([
    { locked: true },
    { hidden: true },
    { name: "画面" },
    { clips: [textClipOperations([track], 0, 30, "plain").clip] },
  ])(
    "creates a top visual track when an existing track cannot accept text (%o)",
    (patch) => {
      const result = textClipOperations(
        [{ ...track, ...patch }],
        0,
        30,
        "title",
      );
      expect(result.clip.trackId).not.toBe(track.id);
      expect(result.redo).toContainEqual({
        type: "reorderTrack",
        trackId: "text",
        order: 1,
      });
      expect(result.redo[1]).toMatchObject({
        type: "addTrack",
        track: { order: 0, kind: "visual", name: "文字" },
      });
      expect(result.undo.map((op) => op.type)).toEqual([
        "removeClip",
        "removeTrack",
        "reorderTrack",
      ]);
      expect(result.clip.fontSize).toBe(72);
    },
  );
  it("inserts position keyframes and restores existing keys on undo", () => {
    const clip = textClipOperations([track], 0, 30, "subtitle").clip;
    const key = {
      id: "x-key",
      property: "x" as const,
      timeUs: 500000,
      value: 500,
      interpolation: "linear" as const,
    };
    clip.keyframes = [key];
    const result = textPositionOperations(clip, 500000, 700, 800);
    expect(result.redo[0]).toMatchObject({
      type: "updateKeyframe",
      keyframe: { id: "x-key", value: 700 },
    });
    expect(result.redo[1]).toMatchObject({
      type: "addKeyframe",
      keyframe: { property: "y", timeUs: 500000, value: 800 },
    });
    expect(result.undo[0]).toMatchObject({
      type: "updateKeyframe",
      keyframe: key,
    });
    expect(result.undo[1].type).toBe("removeKeyframe");
  });
});

describe("文字属性草稿", () => {
  it("focuses content, rejects blank text, and keeps failed drafts across refetch", async () => {
    const clip = textClipOperations([track], 0, 30, "subtitle").clip;
    const commit = vi
      .fn()
      .mockRejectedValueOnce(new Error("版本冲突，请重试"))
      .mockResolvedValue(undefined);
    const view = render(
      <VideoEditorTextInspector clip={clip} playheadUs={0} commit={commit} />,
    );
    const content = screen.getByLabelText("文字内容");
    expect(content).toHaveFocus();
    fireEvent.change(content, { target: { value: " \n " } });
    fireEvent.blur(content);
    expect(screen.getByRole("alert")).toHaveTextContent("文字内容不能为空");
    expect(commit).not.toHaveBeenCalled();
    fireEvent.change(content, {
      target: { value: "我们一起出发\nHello 世界" },
    });
    fireEvent.blur(content);
    await screen.findByText("版本冲突，请重试");
    view.rerender(
      <VideoEditorTextInspector
        clip={{ ...clip, text: "远端修改" }}
        playheadUs={0}
        commit={commit}
      />,
    );
    expect(content).toHaveValue("我们一起出发\nHello 世界");
    fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
    expect(commit.mock.calls[1][0][0].patch.text).toBe(
      "我们一起出发\nHello 世界",
    );
  });
  it("saves style with undo data and validates number ranges", async () => {
    const clip = textClipOperations([track], 0, 30, "subtitle").clip;
    const commit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoEditorTextInspector clip={clip} playheadUs={0} commit={commit} />,
    );
    const font = screen.getByLabelText("字号");
    fireEvent.change(font, { target: { value: "401" } });
    fireEvent.blur(font);
    expect(commit).not.toHaveBeenCalled();
    fireEvent.change(font, { target: { value: "64" } });
    fireEvent.blur(font);
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(commit.mock.calls[0][0][0].patch.fontSize).toBe(64);
    expect(commit.mock.calls[0][1][0].patch.fontSize).toBe(48);
  });
});

function pointer(target: Element, type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 1, clientX: x, clientY: y, button: 0 });
  fireEvent(target, event);
}

describe("文字画布拖动", () => {
  it("converts scaled preview pixels, saves once, and cancels with Escape", async () => {
    const clip = textClipOperations([track], 0, 30, "subtitle").clip;
    const stage = document.createElement("div");
    stage.getBoundingClientRect = () => ({
      width: 960,
      height: 540,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 540,
      right: 960,
      toJSON: () => ({}),
    });
    const ref = createRef<HTMLDivElement>();
    ref.current = stage;
    const commit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoEditorTextLayer
        projectId="project"
        revision={1}
        clip={clip}
        style={{}}
        canvasWidth={1920}
        canvasHeight={1080}
        stageRef={ref}
        playheadUs={0}
        selected
        disabled={false}
        setPlaying={vi.fn()}
        onDragging={vi.fn()}
        commit={commit}
      />,
    );
    const img = screen.getByRole("img");
    Object.defineProperties(img, {
      naturalWidth: { value: 1600 },
      naturalHeight: { value: 100 },
    });
    fireEvent.load(img);
    const hit = screen.getByRole("button", { name: /移动文字/ });
    pointer(hit, "pointerdown", 480, 500);
    pointer(hit, "pointermove", 580, 400);
    pointer(hit, "pointerup", 580, 400);
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(commit.mock.calls[0][0][0].patch.transform).toMatchObject({
      x: 1160,
      y: 800,
    });
    await act(async () => {});
    pointer(hit, "pointerdown", 480, 500);
    pointer(hit, "pointermove", 520, 470);
    fireEvent.keyDown(window, { key: "Escape" });
    pointer(hit, "pointerup", 520, 470);
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it("does not expose editing controls on locked or read-only text", () => {
    const clip = textClipOperations([track], 0, 30, "subtitle").clip;
    render(
      <VideoEditorTextLayer
        projectId="p"
        revision={1}
        clip={clip}
        style={{}}
        canvasWidth={1920}
        canvasHeight={1080}
        stageRef={createRef()}
        playheadUs={0}
        selected
        disabled
        setPlaying={vi.fn()}
        onDragging={vi.fn()}
        commit={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /移动文字/ }),
    ).not.toBeInTheDocument();
  });
});
