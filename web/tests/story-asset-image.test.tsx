import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
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

  afterEach(() => vi.unstubAllGlobals());

  test("keeps the current image visible while the replacement loads", async () => {
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

    resolveNext?.(new Blob(["next"], { type: "image/png" }));
    await waitFor(() =>
      expect(screen.getByAltText("角色")).toHaveAttribute(
        "src",
        "blob:story-asset-1",
      ),
    );
  });
});
