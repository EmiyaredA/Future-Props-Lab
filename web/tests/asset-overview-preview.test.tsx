import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { AssetOverviewPreview } from "@features/galgame-workshop/editor/AssetOverviewPreview";
import type { AssetItem } from "@features/galgame-workshop/editor/assetOverviewModel";

const { imagePreview, audioPreview } = vi.hoisted(() => ({
  imagePreview: vi.fn(),
  audioPreview: vi.fn(),
}));

vi.mock("@features/galgame-workshop/editor/StoryAssetImage", () => ({
  StoryAssetImage: (props: { fileId?: string }) => {
    imagePreview(props);
    return <span>image:{props.fileId}</span>;
  },
}));

vi.mock("@features/galgame-workshop/editor/StoryAudioPreview", () => ({
  StoryAudioPreview: (props: { fileId?: string }) => {
    audioPreview(props);
    return <span>audio:{props.fileId}</span>;
  },
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

function asset(id: string, mediaKind: "image" | "audio"): AssetItem {
  return {
    id,
    display_name: `${id}.png`,
    original_filename: `${id}.png`,
    media_kind: mediaKind,
    mime_type: mediaKind === "image" ? "image/png" : "audio/wav",
    byte_size: 1024,
    revision: 0,
    created_at: "2026-08-27T00:00:00Z",
    updated_at: "2026-08-27T00:00:00Z",
    category: mediaKind === "image" ? "scene" : "voice",
    virtualPath: `assets/${id}.png`,
    packagingPolicy: "auto",
    reference_count: 0,
    references: [],
    orphaned: true,
    missing: false,
  } as AssetItem;
}

test("defers compact images until their card approaches the viewport", async () => {
  let notifyVisible: (() => void) | undefined;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        notifyVisible = () =>
          callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = "240px";
      thresholds = [0];
    },
  );

  render(<AssetOverviewPreview item={asset("cover", "image")} compact />);
  expect(imagePreview).not.toHaveBeenCalled();

  await act(async () => notifyVisible?.());
  expect(screen.getByText("image:cover")).toBeInTheDocument();
});

test("does not download audio just to render a compact asset card", () => {
  render(<AssetOverviewPreview item={asset("voice", "audio")} compact />);
  expect(audioPreview).not.toHaveBeenCalled();
});
