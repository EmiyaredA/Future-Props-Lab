import { beforeEach, afterEach, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { OutputPreview } from "@features/visual-workshop/board/OutputPreview";
import { CanvasMediaPreview } from "@features/visual-workshop/canvas/CanvasMediaNode";
import { fetchApiBlob } from "@platform/api/client";
import type { VisualCanvasNode } from "@features/visual-workshop/api";

vi.mock("@platform/api/client", async (original) => ({
  ...(await original<typeof import("@platform/api/client")>()),
  fetchApiBlob: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:preview");
      static revokeObjectURL = vi.fn();
    },
  );
  vi.mocked(fetchApiBlob).mockResolvedValue(
    new Blob(["cover"], { type: "image/webp" }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const node: Extract<VisualCanvasNode, { kind: "video" }> = {
  id: "video-node",
  kind: "video",
  title: "视频",
  position: { x: 0, y: 0 },
  asset_id: "output",
};

test("compact video waits for visibility and requests a cover, never the full video", async () => {
  let reveal!: () => void;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        reveal = () =>
          callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
      }
      observe() {}
      disconnect() {}
    },
  );
  const { container } = render(
    <OutputPreview kind="video" assetId="clip" compact />,
  );
  expect(fetchApiBlob).not.toHaveBeenCalled();
  act(() => reveal());
  expect(await screen.findByAltText("视频缩略图")).toHaveAttribute(
    "src",
    "blob:preview",
  );
  expect(fetchApiBlob).toHaveBeenCalledExactlyOnceWith(
    "/v1/files/clip/thumbnail?size=320&preview_retry=0",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(container.querySelector("video")).toBeNull();
});

test("canvas cover uses the adopted video and loads the original only in playback mode", async () => {
  const ready = vi.fn();
  const { container, rerender, unmount } = render(
    <CanvasMediaPreview node={node} onVideoReadyChange={ready} />,
  );
  await screen.findByAltText("视频缩略图");
  expect(fetchApiBlob).toHaveBeenCalledExactlyOnceWith(
    "/v1/files/output/thumbnail?size=640",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(container.querySelector("video")).toBeNull();
  rerender(
    <CanvasMediaPreview node={node} interactive onVideoReadyChange={ready} />,
  );
  await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
  const video = container.querySelector("video")!;
  expect(video).toHaveAttribute("controls");
  expect(fetchApiBlob).toHaveBeenLastCalledWith(
    "/v1/files/output/content",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  fireEvent.loadedData(video);
  expect(ready).toHaveBeenLastCalledWith(video);
  unmount();
  expect(ready).toHaveBeenLastCalledWith(null);
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});

test("a draft without an output can show its video reference cover", async () => {
  render(
    <CanvasMediaPreview
      node={{
        ...node,
        asset_id: null,
        generation_draft: { video_asset_ids: ["reference"] } as never,
      }}
    />,
  );
  await screen.findByAltText("生成参考视频缩略图");
  expect(fetchApiBlob).toHaveBeenCalledExactlyOnceWith(
    "/v1/files/reference/thumbnail?size=640",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

test("failed covers stay unavailable without downloading the original", async () => {
  vi.mocked(fetchApiBlob).mockRejectedValue(new Error("not readable"));
  render(<CanvasMediaPreview node={node} />);
  await screen.findByText("预览不可用");
  expect(fetchApiBlob).toHaveBeenCalledTimes(1);
  expect(fetchApiBlob).not.toHaveBeenCalledWith(
    "/v1/files/output/content",
    expect.anything(),
  );
});

test("missing video outputs do not create media requests", () => {
  render(<OutputPreview kind="video" compact />);
  render(<CanvasMediaPreview node={{ ...node, asset_id: null }} />);
  expect(fetchApiBlob).not.toHaveBeenCalled();
});
