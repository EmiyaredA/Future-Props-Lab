import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import { StoryImageCacheProvider } from "@features/galgame-workshop/editor/StoryImageCache";
import { fetchApiBlob } from "@platform/api/client";

vi.mock("@platform/api/client", () => ({
  fetchApiBlob: vi.fn(),
}));

class TestImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

describe("StoryAssetImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("Image", TestImage);
    let index = 0;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => `blob:story-asset-${index++}`),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("retries a portrait that initially fails to load", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchApiBlob)
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(new Blob(["retry"], { type: "image/png" }));

    render(
      <StoryAssetImage
        fileId="portrait-retry"
        alt="角色"
        fallback={<span>加载中</span>}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchApiBlob).toHaveBeenCalledTimes(1);
    expect(screen.getByText("加载中")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(180);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchApiBlob).toHaveBeenCalledTimes(2);
    expect(screen.getByAltText("角色")).toHaveAttribute(
      "src",
      "blob:story-asset-0",
    );
  });

  test("keeps the previous asset visible until a replacement is decoded", async () => {
    let resolveNext: ((blob: Blob) => void) | undefined;
    vi.mocked(fetchApiBlob).mockImplementation((path) => {
      if (path.endsWith("file-next/content")) {
        return new Promise((resolve) => {
          resolveNext = resolve;
        });
      }
      return Promise.resolve(new Blob(["current"], { type: "image/png" }));
    });

    const { rerender } = render(
      <StoryAssetImage
        fileId="file-current"
        alt="角色"
        fallback={<span>加载中</span>}
      />,
    );
    await waitFor(() =>
      expect(screen.getByAltText("角色")).toHaveAttribute(
        "src",
        "blob:story-asset-0",
      ),
    );

    rerender(
      <StoryAssetImage
        fileId="file-next"
        alt="角色"
        fallback={<span>加载中</span>}
      />,
    );
    expect(screen.getByAltText("角色")).toHaveAttribute(
      "src",
      "blob:story-asset-0",
    );
    expect(screen.queryByText("加载中")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:story-asset-0");

    resolveNext?.(new Blob(["next"], { type: "image/png" }));
    await waitFor(() =>
      expect(screen.getByAltText("角色")).toHaveAttribute(
        "src",
        "blob:story-asset-1",
      ),
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:story-asset-0");
  });

  test("keeps the previous asset when the replacement fails", async () => {
    vi.mocked(fetchApiBlob)
      .mockResolvedValueOnce(new Blob(["current"], { type: "image/png" }))
      .mockRejectedValueOnce(new Error("unavailable"));

    const { rerender } = render(
      <StoryAssetImage
        fileId="file-current"
        alt="角色"
        fallback={<span>加载中</span>}
      />,
    );
    await screen.findByAltText("角色");

    rerender(
      <StoryAssetImage
        fileId="file-next"
        alt="角色"
        fallback={<span>加载中</span>}
      />,
    );

    await waitFor(() =>
      expect(fetchApiBlob).toHaveBeenCalledWith("/v1/files/file-next/content"),
    );
    expect(screen.getByAltText("角色")).toHaveAttribute(
      "src",
      "blob:story-asset-0",
    );
    expect(screen.queryByText("加载中")).not.toBeInTheDocument();
  });

  test("keeps only the latest asset during rapid character switches", async () => {
    const pending = new Map<string, (blob: Blob) => void>();
    vi.mocked(fetchApiBlob).mockImplementation(
      (path) =>
        new Promise((resolve) => {
          pending.set(path, resolve);
        }),
    );

    const { rerender } = render(
      <StoryAssetImage
        fileId="portrait-a"
        alt="角色"
        fallback={<span>加载中</span>}
      />,
    );
    rerender(
      <StoryAssetImage
        fileId="portrait-b"
        alt="角色"
        fallback={<span>加载中</span>}
      />,
    );
    rerender(
      <StoryAssetImage
        fileId="portrait-c"
        alt="角色"
        fallback={<span>加载中</span>}
      />,
    );

    pending.get("/v1/files/portrait-c/content")?.(
      new Blob(["c"], { type: "image/png" }),
    );
    await waitFor(() =>
      expect(screen.getByAltText("角色")).toHaveAttribute(
        "src",
        "blob:story-asset-0",
      ),
    );

    pending.get("/v1/files/portrait-a/content")?.(
      new Blob(["a"], { type: "image/png" }),
    );
    pending.get("/v1/files/portrait-b/content")?.(
      new Blob(["b"], { type: "image/png" }),
    );

    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2));
    expect(screen.getByAltText("角色")).toHaveAttribute(
      "src",
      "blob:story-asset-0",
    );
  });

  test("cancels stale cached loads when the preview switches characters", async () => {
    const pending = new Map<string, (blob: Blob) => void>();
    const signals = new Map<string, AbortSignal | undefined>();
    vi.mocked(fetchApiBlob).mockImplementation(
      (path, init) =>
        new Promise((resolve, reject) => {
          pending.set(path, resolve);
          signals.set(path, init?.signal ?? undefined);
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const portrait = (fileId: string) => (
      <StoryImageCacheProvider>
        <StoryAssetImage
          fileId={fileId}
          alt="角色"
          fallback={<span>加载中</span>}
        />
      </StoryImageCacheProvider>
    );
    const { rerender } = render(portrait("portrait-a"));
    rerender(portrait("portrait-b"));

    await waitFor(() =>
      expect(signals.get("/v1/files/portrait-a/content")?.aborted).toBe(true),
    );
    expect(signals.get("/v1/files/portrait-b/content")?.aborted).toBe(false);

    pending.get("/v1/files/portrait-b/content")?.(
      new Blob(["b"], { type: "image/png" }),
    );
    await waitFor(() =>
      expect(screen.getByAltText("角色")).toHaveAttribute(
        "src",
        "blob:story-asset-0",
      ),
    );
  });
});
