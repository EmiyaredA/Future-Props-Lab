import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { LoadingState, ProgressBar } from "@shared/ui/LoadingState";
import { ImagePreview } from "@shared/ui/ImagePreview";
import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { imagePreviewSource } from "@shared/lib/imageSources";
import { useTransferProgress } from "@platform/api/useTransferProgress";
import { TransferFeedback } from "@shared/ui/TransferFeedback";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("delays short loading feedback, announces long waits, and never invents a percentage", () => {
  vi.useFakeTimers();
  render(<LoadingState label="正在加载页面…" />);
  expect(
    screen.getByText("正在加载页面…").closest("[role=status]"),
  ).not.toHaveClass("is-visible");
  act(() => vi.advanceTimersByTime(150));
  expect(screen.getByRole("status")).toHaveClass("is-visible");
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  act(() => vi.advanceTimersByTime(10_000));
  expect(screen.getByText(/已等待 10 秒/)).toBeInTheDocument();
});

test("shows real byte totals and speed; upload processing is a separate indeterminate phase", () => {
  const { rerender } = render(
    <LoadingState
      delay={0}
      progress={{
        direction: "upload",
        phase: "transferring",
        loaded: 1024,
        total: 2048,
        bytesPerSecond: 2048,
      }}
    />,
  );
  expect(
    screen.getByText(/已上传 1.0 KB \/ 2.0 KB · 50% · 2.0 KB\/s/),
  ).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "50",
  );
  rerender(
    <LoadingState
      delay={0}
      progress={{
        direction: "upload",
        phase: "processing",
        loaded: 2048,
        total: 2048,
        bytesPerSecond: 0,
      }}
    />,
  );
  expect(screen.getByText("服务端处理中…")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
});

test("progress remains bounded and public icons select precomputed WebP files", () => {
  render(
    <>
      <ProgressBar value={120} />
      <ResponsiveImage
        src="/brand/thought-workshop-mark.png"
        alt="应用图标"
        width={64}
      />
    </>,
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
  const icon = screen.getByAltText("应用图标");
  expect(icon.getAttribute("src")).toMatch(
    /thumbnails\/thought-workshop-mark-.*-64.webp$/,
  );
  expect(icon.getAttribute("srcset")).toContain("256w");
  expect(icon).toHaveAttribute("sizes", "64px");
  expect(icon).toHaveAttribute("loading", "lazy");
});

test("community variant URLs preserve the article authorization context", () => {
  expect(imagePreviewSource("/v1/files/image/content", 320)).toBe(
    "/v1/files/image/thumbnail?size=320",
  );
  expect(
    imagePreviewSource(
      "/v1/thought-workshop/community/publications/pub/assets/image/content?note_id=note",
      1280,
    ),
  ).toBe(
    "/v1/thought-workshop/community/publications/pub/assets/image/content?note_id=note&size=1280",
  );
  expect(imagePreviewSource("https://outside.test/picture.png", 320)).toBe(
    "https://outside.test/picture.png",
  );
});

test("offscreen authenticated images do not fetch, and thumbnail failures never auto-download the original", async () => {
  let reveal: IntersectionObserverCallback = () => {};
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        reveal = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response("unsupported", { status: 422 }));
  vi.stubGlobal("fetch", fetch);
  render(<ImagePreview src="/v1/files/image/content" alt="图片" />);
  expect(fetch).not.toHaveBeenCalled();
  act(() =>
    reveal(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  await screen.findByText("图片暂时无法读取");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((fetch.mock.calls[0]![0] as Request).url).toContain("/thumbnail?");
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  await screen.findByText("图片暂时无法读取");
  fireEvent.click(screen.getByRole("button", { name: "查看原图" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect((fetch.mock.calls[2]![0] as Request).url).toContain("/content?");
});

test("an action failure clears its transfer UI and leaves retries with its owner", async () => {
  function Harness() {
    const transfer = useTransferProgress();
    return (
      <>
        <TransferFeedback progress={transfer.progress} />
        <button
          onClick={() =>
            void transfer
              .run(async (onProgress) => {
                onProgress({
                  direction: "upload",
                  phase: "processing",
                  loaded: 10,
                  total: 10,
                  bytesPerSecond: 0,
                });
                throw new Error("failed");
              })
              .catch(() => {})
          }
        >
          上传
        </button>
      </>
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByText("上传"));
  await waitFor(() =>
    expect(screen.queryByText("服务端处理中…")).not.toBeInTheDocument(),
  );
});

test("responsive public pictures use viewport sizing without implicit containment and preserve caller sizes", () => {
  render(
    <>
      <ResponsiveImage src="/brand/visual-workshop-mark.png" alt="自适应图片" />
      <ResponsiveImage
        src="/brand/visual-workshop-mark.png"
        alt="显式尺寸"
        sizes="(max-width: 600px) 46px, 42px"
      />
    </>,
  );
  expect(screen.getByAltText("自适应图片")).toHaveAttribute("sizes", "100vw");
  expect(screen.getByAltText("显式尺寸")).toHaveAttribute(
    "sizes",
    "(max-width: 600px) 46px, 42px",
  );
});
