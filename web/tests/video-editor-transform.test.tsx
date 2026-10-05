import { WorkspacePermissionsProvider } from "@platform/auth/WorkspacePermissions";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultTransform,
  transformAt,
  transformLocalUs,
  transformPoint,
  gestureTransform,
  handlePoints,
  transformOperations,
  transformEdit,
  type ClipTransform,
  type TransformDraft,
} from "@features/video-editor/transformModel";
import {
  previewMediaGeometry,
  previewLayerStyle,
} from "@features/video-editor/previewGeometry";
import { VideoEditorPreview } from "@features/video-editor/VideoEditorPreview";
import { VideoEditorTransformFields } from "@features/video-editor/VideoEditorTransformFields";
import {
  TimelineSaveQueue,
  type TimelineEditBuilder,
} from "@features/video-editor/timelineSaveQueue";
import type {
  VideoEditorClip,
  VideoEditorTimeline,
  VideoEditorOperation,
} from "@features/video-editor/types";

const clip: VideoEditorClip = {
  id: "clip",
  trackId: "track",
  kind: "color",
  name: "测试画面",
  color: "#ff0000",
  timelineStartUs: 0,
  durationUs: 5_000_000,
  sourceInUs: 0,
  sourceLoop: false,
  fitMode: "native",
  flipX: false,
  fontSize: 72,
  textColor: "#ffffff",
  volume: 1,
  transform: { ...defaultTransform, scaleX: 0.5, scaleY: 0.5 },
  keyframes: [],
};
const timeline: VideoEditorTimeline = {
  projectId: "project",
  revision: 1,
  updatedAt: "now",
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
        id: "track",
        name: "画面",
        kind: "visual",
        order: 0,
        locked: false,
        hidden: false,
        muted: false,
        clips: [clip],
      },
    ],
  },
};
const effect = {
  scaleMultiplier: 1.2,
  opacityMultiplier: 1,
  blurPx: 0,
  overlayOpacity: 0,
};
const pointClose = (
  actual: { x: number; y: number },
  expected: { x: number; y: number },
) => {
  expect(actual.x).toBeCloseTo(expected.x, 7);
  expect(actual.y).toBeCloseTo(expected.y, 7);
};

describe("transform geometry and operations", () => {
  for (const anchor of ["center", "topLeft", "bottomCenter"] as const)
    for (const flipX of [false, true]) {
      it(`fixes opposite resize points with ${anchor}, mirror=${flipX}, rotation and transition scale`, () => {
        const initial: ClipTransform = {
          ...defaultTransform,
          x: 800,
          y: 470,
          anchor,
          rotation: 37,
          scaleX: 0.8,
          scaleY: 0.5,
        };
        const geometry = { width: 800, height: 500, flipX, multiplier: 1.2 };
        for (const [handle, moving] of Object.entries(handlePoints)) {
          const start = transformPoint(moving, initial, geometry),
            fixed = { x: 1 - moving.x, y: 1 - moving.y };
          const next = gestureTransform(
            initial,
            geometry,
            handle as keyof typeof handlePoints,
            start,
            { x: start.x + 50, y: start.y + 35 },
          );
          pointClose(
            transformPoint(fixed, next, geometry),
            transformPoint(fixed, initial, geometry),
          );
          if (moving.x !== 0.5 && moving.y !== 0.5)
            expect(next.scaleX / next.scaleY).toBeCloseTo(
              initial.scaleX / initial.scaleY,
            );
          if (moving.x === 0.5) expect(next.scaleX).toBe(initial.scaleX);
          if (moving.y === 0.5) expect(next.scaleY).toBe(initial.scaleY);
        }
      });
    }
  it("moves without changing scale and rotates around the existing anchor with snapping and angle continuity", () => {
    const initial = { ...defaultTransform, x: 100, y: 100 };
    expect(
      gestureTransform(
        initial,
        { width: 300, height: 200 },
        "move",
        { x: 20, y: 20 },
        { x: 50, y: 60 },
      ),
    ).toEqual({ ...initial, x: 130, y: 140 });
    const rotated = gestureTransform(
      initial,
      { width: 300, height: 200 },
      "rotate",
      { x: 100, y: 0 },
      { x: 200, y: 100 },
      true,
    );
    expect(rotated.rotation).toBe(90);
    expect(rotated.x).toBe(100);
    expect(rotated.y).toBe(100);
    const radians = (194 * Math.PI) / 180;
    const snapped = gestureTransform(
      initial,
      { width: 1, height: 1 },
      "rotate",
      { x: 200, y: 100 },
      { x: 100 + 100 * Math.cos(radians), y: 100 + 100 * Math.sin(radians) },
      true,
      190,
    );
    expect(snapped.rotation).toBe(195);
  });
  it("clamps crossing and excessive resize while keeping the opposite corner fixed", () => {
    const initial = { ...defaultTransform };
    const geometry = { width: 100, height: 100 };
    const start = transformPoint(handlePoints.se, initial, geometry);
    for (const offset of [-1000, 10000]) {
      const next = gestureTransform(initial, geometry, "se", start, {
        x: start.x + offset,
        y: start.y + offset,
      });
      expect(next.scaleX).toBe(offset < 0 ? 0.01 : 20);
      pointClose(
        transformPoint(handlePoints.nw, next, geometry),
        transformPoint(handlePoints.nw, initial, geometry),
      );
    }
  });
  it("shares fit geometry and rotated/mirrored layer styling on a portrait canvas", () => {
    const video = {
      ...clip,
      kind: "video" as const,
      fitMode: "contain" as const,
      flipX: true,
    };
    const geometry = previewMediaGeometry(video, undefined, {
      width: 1080,
      height: 1920,
    })!;
    expect(geometry.width).toBe(1080);
    expect(geometry.height).toBe(607.5);
    const style = previewLayerStyle(
      video,
      0,
      effect,
      geometry,
      { width: 1080, height: 1920 },
      {
        ...defaultTransform,
        x: 540,
        y: 960,
        rotation: 25,
        scaleX: 0.5,
        scaleY: 0.5,
      },
    );
    expect(style.left).toBe("50%");
    expect(style.top).toBe("50%");
    expect(style.transform).toContain("rotate(25deg) scale(0.6, 0.6)");
  });
  it("updates animated properties at the current time and preserves existing interpolation and unrelated values", () => {
    const animated = {
      ...clip,
      keyframes: [
        {
          id: "x-key",
          property: "x" as const,
          timeUs: 1_000_000,
          value: 1100,
          interpolation: "ease-out" as const,
        },
        {
          id: "rotate-key",
          property: "rotation" as const,
          timeUs: 0,
          value: 10,
          interpolation: "linear" as const,
        },
      ],
    };
    const edit = transformOperations(animated, 1_000_000, {
      x: 1200,
      y: 600,
      rotation: 35,
    });
    expect(edit.redo[0]).toEqual({
      type: "updateKeyframe",
      clipId: "clip",
      keyframe: { ...animated.keyframes[0], value: 1200 },
    });
    expect(edit.redo[1]).toMatchObject({
      type: "addKeyframe",
      keyframe: { property: "rotation", timeUs: 1_000_000, value: 35 },
    });
    expect(edit.redo[2]).toMatchObject({
      type: "updateClip",
      patch: { transform: { ...clip.transform, y: 600 } },
    });
    expect(edit.undo).toContainEqual({
      type: "updateKeyframe",
      clipId: "clip",
      keyframe: animated.keyframes[0],
    });
    expect(edit.undo).toContainEqual(
      expect.objectContaining({ type: "removeKeyframe" }),
    );
    expect(transformAt(animated, 1_000_000).x).toBe(1100);
    expect(transformOperations(animated, 1_000_000, { x: 1100 }).redo).toEqual(
      [],
    );
  });
  it("keeps mirrored bounds at the same anchor and matches the renderer's seam property time", () => {
    const initial = { ...defaultTransform, anchor: "topLeft" as const };
    pointClose(
      transformPoint(handlePoints.se, initial, {
        width: 200,
        height: 100,
        flipX: true,
      }),
      transformPoint(handlePoints.se, initial, { width: 200, height: 100 }),
    );
    const state = structuredClone(timeline);
    const target = {
      ...clip,
      id: "next",
      timelineStartUs: 5_000_000,
      keyframes: [
        {
          id: "x",
          property: "x" as const,
          timeUs: 0,
          value: 960,
          interpolation: "linear" as const,
        },
        {
          id: "x-end",
          property: "x" as const,
          timeUs: 1_000_000,
          value: 1200,
          interpolation: "linear" as const,
        },
      ],
    };
    state.document.tracks![0].clips!.push(target);
    state.document.transitions = [
      {
        id: "seam",
        kind: "crossfade",
        durationUs: 1_000_000,
        placement: "between",
        fromClipId: "clip",
        toClipId: "next",
        direction: "left",
        easing: "linear",
      },
    ];
    expect(transformLocalUs(target, 5_000_000, state)).toBe(500_000);
    expect(
      transformEdit("next", 5_000_000, { x: 1400 })(state).redo[0],
    ).toMatchObject({
      type: "addKeyframe",
      keyframe: { timeUs: 500_000, value: 1400 },
    });
    render(
      <VideoEditorTransformFields
        clip={target}
        timeline={state}
        playheadUs={5_000_000}
        commit={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByLabelText("位置 X")).toHaveValue(1080);
  });
  it("builds edits from the latest snapshot and rejects stale gestures or newly locked tracks", () => {
    const latest = structuredClone(timeline);
    latest.document.tracks![0].clips![0].transform!.brightness = 0.8;
    expect(transformEdit("clip", 0, { x: 1200 })(latest).redo[0]).toMatchObject(
      { patch: { transform: { brightness: 0.8, x: 1200 } } },
    );
    expect(() =>
      transformEdit("clip", 0, { x: 1200 }, { revision: 0 })(latest),
    ).toThrow("工程已变化");
    latest.document.tracks![0].locked = true;
    expect(() => transformEdit("clip", 0, { x: 1200 })(latest)).toThrow("锁定");
  });
  it("records a mixed keyframe/base transform batch as a single undoable queue entry", async () => {
    let current = structuredClone(timeline);
    current.document.tracks![0].clips![0].keyframes = [
      {
        id: "x",
        property: "x",
        timeUs: 0,
        value: 960,
        interpolation: "linear",
      },
    ];
    const writes: VideoEditorOperation[][] = [];
    const queue = new TimelineSaveQueue({
      read: () => current,
      write: async (_revision, operations) => {
        writes.push(operations);
        return { ...current, revision: current.revision + 1 };
      },
      saved: (next) => {
        current = next;
      },
      failed: vi.fn(),
      changed: vi.fn(),
    });
    await queue.enqueue(
      "edit",
      transformEdit("clip", 0, { x: 1200, scaleX: 0.8 }),
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]).toHaveLength(2);
    expect(queue.canUndo).toBe(true);
    await queue.enqueue("undo");
    expect(writes[1]).toContainEqual({
      type: "updateKeyframe",
      clipId: "clip",
      keyframe: {
        id: "x",
        property: "x",
        timeUs: 0,
        value: 960,
        interpolation: "linear",
      },
    });
    await queue.enqueue("redo");
    expect(writes[2]).toEqual(writes[0]);
  });
});

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}
let stageWidth = 960;
const props = {
  projectId: "project",
  timeline,
  assets: [],
  playheadUs: 1_000_000,
  setPlayheadUs: vi.fn(),
  playing: false,
  setPlaying: vi.fn(),
  selectedClipId: "clip",
  selectedClipIds: ["clip"],
  preciseFrame: true,
  onPreciseFrameChange: vi.fn(),
};
function pointer(
  node: Element,
  type: "pointerDown" | "pointerMove" | "pointerUp",
  x: number,
  y: number,
) {
  fireEvent[type](node, { pointerId: 1, button: 0, clientX: x, clientY: y });
}
beforeEach(() => {
  stageWidth = 960;
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("ve-stage")
        ? new DOMRect(0, 0, stageWidth, (stageWidth * 1080) / 1920)
        : original.call(this);
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("preview transform interaction", () => {
  it("shows eight handles and a rotation handle above the precise frame, with a live draft and one save", async () => {
    let resolve!: () => void;
    const commit = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const onDraft = vi.fn();
    const view = render(
      <VideoEditorPreview
        {...props}
        commit={commit}
        onTransformDraft={onDraft}
      />,
    );
    expect(
      screen.getAllByRole("button", { name: /等比缩放|拉伸|旋转画面/ }),
    ).toHaveLength(9);
    const frame = screen.getByAltText("后端精确停帧");
    fireEvent.load(frame);
    expect(frame).toBeVisible();
    const move = screen.getByRole("button", { name: "移动画面" });
    pointer(move, "pointerDown", 480, 270);
    pointer(move, "pointerMove", 510, 290);
    expect(commit).not.toHaveBeenCalled();
    expect(screen.queryByAltText("后端精确停帧")).toBeNull();
    expect(
      view.container.querySelector<HTMLElement>(".ve-stage-layer")!.style.left,
    ).toBe("53.125%");
    expect(onDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ values: { x: 1020, y: 580 } }),
    );
    pointer(move, "pointerUp", 510, 290);
    expect(commit).toHaveBeenCalledTimes(1);
    const edit = (commit.mock.calls[0] as unknown as [TimelineEditBuilder])[0](
      timeline,
    );
    expect(edit.redo[0]).toMatchObject({
      type: "updateClip",
      patch: { transform: { x: 1020, y: 580 } },
    });
    const next = structuredClone(timeline);
    next.revision++;
    next.document.tracks![0].clips![0].transform = {
      ...clip.transform!,
      x: 1020,
      y: 580,
    };
    view.rerender(
      <VideoEditorPreview
        {...props}
        timeline={next}
        commit={commit}
        onTransformDraft={onDraft}
      />,
    );
    await act(async () => resolve());
    const fresh = screen.getByAltText("后端精确停帧");
    expect(fresh).not.toBeVisible();
    fireEvent.load(fresh);
    expect(fresh).toBeVisible();
    expect(fresh.getAttribute("src")).toContain("revision=2");
  });
  it("scales a corner and stretches an edge with a fixed opposite point", async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    render(<VideoEditorPreview {...props} commit={commit} />);
    const corner = screen.getByRole("button", { name: "右下等比缩放" });
    pointer(corner, "pointerDown", 720, 405);
    pointer(corner, "pointerMove", 840, 472.5);
    pointer(corner, "pointerUp", 840, 472.5);
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    const first = (commit.mock.calls[0][0] as TimelineEditBuilder)(timeline);
    expect(first.redo[0]).toMatchObject({
      patch: { transform: { scaleX: 0.625, scaleY: 0.625, x: 1080, y: 607.5 } },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "右侧拉伸" })).toBeEnabled(),
    );
    const edge = screen.getByRole("button", { name: "右侧拉伸" });
    pointer(edge, "pointerDown", 720, 270);
    pointer(edge, "pointerUp", 840, 270);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "右侧拉伸" })).toBeEnabled(),
    );
    expect(
      (commit.mock.calls[1][0] as TimelineEditBuilder)(timeline).redo[0],
    ).toMatchObject({
      patch: { transform: { scaleX: 0.625, scaleY: 0.5, x: 1080, y: 540 } },
    });
  });
  it("cancels Escape, pointer loss, time/revision changes and stage resizing without writes", () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const view = render(<VideoEditorPreview {...props} commit={commit} />);
    const drag = () => {
      const move = screen.getByRole("button", { name: "移动画面" });
      pointer(move, "pointerDown", 480, 270);
      pointer(move, "pointerMove", 510, 290);
      return move;
    };
    let move = drag();
    fireEvent.keyDown(window, { key: "Escape" });
    pointer(move, "pointerUp", 510, 290);
    move = drag();
    fireEvent.lostPointerCapture(move);
    pointer(move, "pointerUp", 510, 290);
    move = drag();
    view.rerender(
      <VideoEditorPreview {...props} playheadUs={2_000_000} commit={commit} />,
    );
    pointer(move, "pointerUp", 510, 290);
    move = drag();
    view.rerender(
      <VideoEditorPreview
        {...props}
        timeline={{ ...timeline, revision: 2 }}
        commit={commit}
      />,
    );
    pointer(move, "pointerUp", 510, 290);
    move = drag();
    stageWidth = 800;
    fireEvent(window, new Event("resize"));
    pointer(move, "pointerUp", 510, 290);
    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByAltText("后端精确停帧")).toBeInTheDocument();
  });
  it("moves with keyboard, keeps arrows out of timeline playback and reports save failure without retry", async () => {
    const commit = vi.fn().mockRejectedValue(new Error("版本冲突"));
    render(<VideoEditorPreview {...props} commit={commit} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "移动画面" }), {
      key: "ArrowRight",
      shiftKey: true,
    });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("版本冲突"),
    );
    expect(
      (commit.mock.calls[0][0] as TimelineEditBuilder)(timeline).redo[0],
    ).toMatchObject({ patch: { transform: { x: 970 } } });
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it("hides editing controls for playback, multiple selection, locked tracks and source preview", () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <VideoEditorPreview {...props} playing commit={commit} />,
    );
    expect(screen.queryByRole("group", { name: "画面变换操作框" })).toBeNull();
    view.rerender(
      <VideoEditorPreview
        {...props}
        selectedClipIds={["clip", "other"]}
        commit={commit}
      />,
    );
    expect(screen.queryByRole("group", { name: "画面变换操作框" })).toBeNull();
    const locked = structuredClone(timeline);
    locked.document.tracks![0].locked = true;
    view.rerender(
      <VideoEditorPreview {...props} timeline={locked} commit={commit} />,
    );
    expect(screen.queryByRole("group", { name: "画面变换操作框" })).toBeNull();
    view.rerender(
      <VideoEditorPreview
        {...props}
        selectedClipId="outside"
        commit={commit}
      />,
    );
    expect(screen.queryByRole("group", { name: "画面变换操作框" })).toBeNull();
  });
  it("keeps comparison dragging available and exits comparison when a transform handle is used", () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const keyed = structuredClone(timeline);
    keyed.document.tracks![0].clips![0].chromaKey = {
      enabled: true,
      color: "#00ff00",
      similarity: 42,
      softness: 18,
      despill: 30,
    };
    const view = render(
      <VideoEditorPreview {...props} timeline={keyed} commit={commit} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "抠像对比" }));
    expect(screen.getByLabelText("调整抠像前后对比分界线")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移动画面" })).toHaveStyle({
      pointerEvents: "none",
    });
    const handle = screen.getByRole("button", { name: "右侧拉伸" });
    pointer(handle, "pointerDown", 720, 270);
    expect(screen.queryByLabelText("调整抠像前后对比分界线")).toBeNull();
    fireEvent.pointerCancel(handle);
    view.rerender(
      <VideoEditorPreview
        {...props}
        commit={commit}
        previewingAsset={{
          id: "source",
          displayName: "源素材",
          originalFilename: "source.mp4",
          revision: 0,
          mediaKind: "video",
          mimeType: "video/mp4",
          byteSize: 100,
          processingStatus: "ready",
          createdAt: "now",
        }}
      />,
    );
    expect(screen.queryByRole("group", { name: "画面变换操作框" })).toBeNull();
    view.rerender(<VideoEditorPreview {...props} commit={commit} />);
    expect(
      screen.getByRole("button", { name: "移动画面" }),
    ).toBeInTheDocument();
  });
  it("does not expose gestures without write permission or while saves are pending", () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <WorkspacePermissionsProvider permissions={[]}>
        <VideoEditorPreview {...props} commit={commit} />
      </WorkspacePermissionsProvider>,
    );
    expect(screen.queryByRole("group", { name: "画面变换操作框" })).toBeNull();
    view.rerender(<VideoEditorPreview {...props} saving commit={commit} />);
    expect(screen.queryByRole("group", { name: "画面变换操作框" })).toBeNull();
    expect(commit).not.toHaveBeenCalled();
  });
  it("refreshes inspector values from drafts and saved snapshots while preserving typed input", () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const draft: TransformDraft = {
      clipId: "clip",
      revision: 1,
      playheadUs: 0,
      values: { x: 1200, rotation: 35 },
    };
    const view = render(
      <VideoEditorTransformFields
        clip={clip}
        playheadUs={0}
        revision={1}
        commit={commit}
      />,
    );
    const x = screen.getByLabelText("位置 X");
    fireEvent.focus(x);
    fireEvent.change(x, { target: { value: "1300" } });
    view.rerender(
      <VideoEditorTransformFields
        clip={clip}
        playheadUs={0}
        revision={1}
        draft={draft}
        commit={commit}
      />,
    );
    expect(x).toHaveValue(1300);
    expect(screen.getByLabelText("旋转")).toHaveValue(35);
    fireEvent.blur(x);
    expect(
      (commit.mock.calls[0][0] as TimelineEditBuilder)(timeline).redo[0],
    ).toMatchObject({ patch: { transform: { x: 1300 } } });
    const saved = { ...clip, transform: { ...clip.transform!, x: 1300 } };
    view.rerender(
      <VideoEditorTransformFields
        clip={saved}
        playheadUs={0}
        revision={2}
        commit={commit}
      />,
    );
    expect(x).toHaveValue(1300);
    fireEvent.focus(x);
    fireEvent.change(x, { target: { value: "1500" } });
    fireEvent.keyDown(x, { key: "Escape" });
    fireEvent.blur(x);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(x).toHaveValue(1300);
  });
});
