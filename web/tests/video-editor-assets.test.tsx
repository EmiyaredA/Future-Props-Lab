import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VideoEditorAssetPanel } from "@features/video-editor/VideoEditorAssetPanel";
import {
  deleteVideoEditorAsset,
  listVideoEditorImportSources,
} from "@features/video-editor/api";
import type { VideoEditorAsset } from "@features/video-editor/types";

vi.mock("@features/video-editor/api", () => ({
  deleteVideoEditorAsset: vi.fn(),
  importVideoEditorAssets: vi.fn(),
  listVideoEditorImportSources: vi.fn(),
  uploadVideoEditorAsset: vi.fn(),
}));

const asset: VideoEditorAsset = {
  id: "asset-video",
  displayName: "演示视频.mp4",
  originalFilename: "demo.mp4",
  mediaKind: "video",
  mimeType: "video/mp4",
  byteSize: 1024,
  processingStatus: "ready",
  probe: { durationUs: 3_000_000 },
  createdAt: "2026-08-29T00:00:00Z",
};

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <VideoEditorAssetPanel
        projectId="project-1"
        assets={[asset]}
        onAdd={vi.fn()}
        onAddGenerated={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listVideoEditorImportSources).mockResolvedValue({ items: [] });
});

describe("video editor asset panel", () => {
  it("confirms and deletes an uploaded asset", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteVideoEditorAsset).mockResolvedValue({ deleted: true });
    renderPanel();

    await user.click(
      screen.getByRole("button", { name: "删除素材“演示视频.mp4”" }),
    );
    expect(
      screen.getByRole("alertdialog", { name: "删除“演示视频.mp4”？" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() =>
      expect(deleteVideoEditorAsset).toHaveBeenCalledWith(
        "project-1",
        "asset-video",
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("keeps the confirmation open when the timeline still uses the asset", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteVideoEditorAsset).mockRejectedValue(
      new Error("素材仍被时间轴引用"),
    );
    renderPanel();

    await user.click(
      screen.getByRole("button", { name: "删除素材“演示视频.mp4”" }),
    );
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "素材仍被时间轴引用",
    );
    expect(screen.getByRole("alertdialog")).toBeVisible();
  });
});
