import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { VideoEditorCachedPreview } from "@features/video-editor/VideoEditorCachedPreview";
import { usePreviewRender } from "@features/video-editor/usePreviewRender";
import { videoEditorQueryKeys } from "@features/video-editor/queryKeys";
import {
  listPreviewRenders,
  createPreviewRender,
  cancelPreviewRender,
  clearPreviewRenders,
  type PreviewRender,
} from "@features/video-editor/previewRenderApi";
import type { VideoEditorTimeline } from "@features/video-editor/types";

vi.mock("@features/video-editor/previewRenderApi", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@features/video-editor/previewRenderApi")
  >()),
  listPreviewRenders: vi.fn(),
  createPreviewRender: vi.fn(),
  cancelPreviewRender: vi.fn(),
  clearPreviewRenders: vi.fn(),
}));

const task: PreviewRender = {
  id: "cached",
  projectId: "project",
  requestId: "preview-request",
  kind: "preview_render",
  status: "completed",
  progress: 100,
  revision: 1,
  createdAt: "now",
  updatedAt: "now",
  resultDetail: {},
  valid: true,
  timelineRevision: 1,
  mediaUrl: "/preview.mp4",
};
const timeline: VideoEditorTimeline = {
  projectId: "project",
  revision: 1,
  updatedAt: "now",
  document: { schemaVersion: "1.0", tracks: [] },
};

function setup(items: PreviewRender[] = [task]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.mocked(listPreviewRenders).mockResolvedValue({ items });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const props = {
    projectId: "project",
    revision: 1,
    dirty: false,
    playing: false,
    waitForSavedTimeline: vi.fn(async () => timeline),
    setMediaClockActive: vi.fn(),
  };
  const hook = renderHook((props) => usePreviewRender(props), {
    initialProps: props,
    wrapper,
  });
  return { ...hook, props, client };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("preview cache selection and submission", () => {
  it("selects a cache only at playback start and stops using it on edits or failure", async () => {
    const { result, rerender, props } = setup();
    await waitFor(() =>
      expect(result.current.query.data?.items).toHaveLength(1),
    );
    rerender({ ...props, playing: true });
    await waitFor(() => expect(result.current.active?.id).toBe("cached"));
    expect(props.setMediaClockActive).toHaveBeenLastCalledWith(true);
    rerender({ ...props, playing: true, dirty: true });
    expect(result.current.active).toBeUndefined();
    expect(props.setMediaClockActive).toHaveBeenLastCalledWith(false);
    rerender({ ...props, playing: false });
    rerender({ ...props, playing: true });
    await waitFor(() => expect(result.current.active?.id).toBe("cached"));
    act(() => result.current.playbackFailed("cached"));
    expect(result.current.active).toBeUndefined();
    expect(result.current.playbackError).toContain("已切回实时预览");
    expect(props.setMediaClockActive).toHaveBeenLastCalledWith(false);
  });

  it("waits until the next play when rendering finishes during realtime playback", async () => {
    const { result, rerender, props, client } = setup([]);
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    rerender({ ...props, playing: true });
    act(() =>
      client.setQueryData(videoEditorQueryKeys.previewRenders("project", 1), {
        items: [task],
      }),
    );
    await waitFor(() =>
      expect(result.current.query.data?.items).toHaveLength(1),
    );
    expect(result.current.active).toBeUndefined();
    rerender(props);
    rerender({ ...props, playing: true });
    await waitFor(() => expect(result.current.active?.id).toBe("cached"));
    rerender({ ...props, playing: true, revision: 2 });
    expect(result.current.active).toBeUndefined();
  });

  it("waits for saved revision and prevents submission when saving fails", async () => {
    const { result, rerender, props } = setup([]);
    let save!: (value: VideoEditorTimeline) => void;
    const wait = vi.fn(
      () =>
        new Promise<VideoEditorTimeline>((resolve) => {
          save = resolve;
        }),
    );
    rerender({ ...props, waitForSavedTimeline: wait });
    vi.mocked(createPreviewRender).mockResolvedValue(task);
    let submitted!: Promise<PreviewRender>;
    act(() => {
      submitted = result.current.create.mutateAsync();
    });
    await waitFor(() => expect(wait).toHaveBeenCalledOnce());
    expect(createPreviewRender).not.toHaveBeenCalled();
    await act(async () => {
      save({ ...timeline, revision: 7 });
      await submitted;
    });
    expect(createPreviewRender).toHaveBeenCalledWith("project", 7);
    vi.mocked(createPreviewRender).mockClear();
    rerender({
      ...props,
      waitForSavedTimeline: vi.fn(async () => {
        throw new Error("保存失败");
      }),
    });
    await act(async () => {
      await expect(result.current.create.mutateAsync()).rejects.toThrow(
        "保存失败",
      );
    });
    expect(createPreviewRender).not.toHaveBeenCalled();
  });

  it("forwards cancellation and cache cleanup", async () => {
    const { result } = setup();
    vi.mocked(cancelPreviewRender).mockResolvedValue({
      ...task,
      status: "cancelled",
    });
    vi.mocked(clearPreviewRenders).mockResolvedValue({ deleted: true });
    await act(async () => {
      await result.current.cancel.mutateAsync(task.id);
      await result.current.clear.mutateAsync();
    });
    expect(cancelPreviewRender).toHaveBeenCalledWith("project", "cached");
    expect(clearPreviewRenders).toHaveBeenCalledWith("project");
  });
});

describe("cached media clock", () => {
  it("keeps the requested start before metadata, follows buffered media time and seeks only on user jumps", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => {});
    const props = {
      url: "/preview.mp4",
      playheadUs: 6_000_000,
      seekRevision: 0,
      durationUs: 10_000_000,
      onTime: vi.fn(),
      onEnded: vi.fn(),
      onError: vi.fn(),
    };
    const { rerender, unmount } = render(
      <VideoEditorCachedPreview {...props} />,
    );
    const node = screen.getByLabelText("预渲染节目预览") as HTMLVideoElement;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(props.onTime).not.toHaveBeenCalled();
    Object.defineProperty(node, "readyState", { configurable: true, value: 2 });
    fireEvent.loadedMetadata(node);
    expect(node.currentTime).toBe(6);
    await waitFor(() => expect(props.onTime).toHaveBeenCalledWith(6_000_000));
    node.currentTime = 6.2;
    rerender(<VideoEditorCachedPreview {...props} playheadUs={6_200_000} />);
    await waitFor(() => expect(props.onTime).toHaveBeenCalledWith(6_200_000));
    fireEvent.waiting(node);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(props.onTime).toHaveBeenLastCalledWith(6_200_000);
    rerender(
      <VideoEditorCachedPreview
        {...props}
        playheadUs={2_000_000}
        seekRevision={1}
      />,
    );
    expect(node.currentTime).toBe(2);
    expect(screen.getByLabelText("预渲染节目预览")).toBe(node);
    fireEvent.ended(node);
    expect(props.onTime).toHaveBeenLastCalledWith(10_000_000);
    expect(props.onEnded).toHaveBeenCalledOnce();
    fireEvent.error(node);
    expect(props.onError).toHaveBeenCalledOnce();
    unmount();
    expect(pause).toHaveBeenCalled();
  });
});
