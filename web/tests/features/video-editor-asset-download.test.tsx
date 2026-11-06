import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoEditorAssetRow } from "@features/video-editor/VideoEditorAssetRow";
import type { VideoEditorAsset } from "@features/video-editor/types";
import { fetchApiDownload, type ApiDownload } from "@platform/api/client";

vi.mock("@platform/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@platform/api/client")>()),
  fetchApiDownload: vi.fn(),
}));

const asset: VideoEditorAsset = {
  id: "asset/video",
  displayName: "结尾",
  originalFilename: "ending.mp4",
  mediaKind: "video",
  mimeType: "video/mp4",
  byteSize: 1024,
  processingStatus: "ready",
  probe: {},
  proxyUrl: "/v1/proxy.mp4",
  defaultEffects: {},
  revision: 0,
  createdAt: "2026-10-11T00:00:00Z",
};

function renderRow(current = asset, disabled = false) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <VideoEditorAssetRow
        projectId="project-1"
        asset={current}
        folderId={null}
        arranged={{ folders: [], rootAssetIds: [current.id] }}
        batchActive={false}
        selected={false}
        disabled={disabled}
        organizeOpen={false}
        onSelect={vi.fn()}
        onPreview={vi.fn()}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onToggleOrganize={vi.fn()}
        onCloseOrganize={vi.fn()}
        onOrganizationChange={vi.fn()}
        onDragOver={vi.fn()}
        onDrop={vi.fn()}
        organizeType="organize"
        timelineType="timeline"
      />
    </QueryClientProvider>,
  );
}

let saved: { href: string; filename: string }[];
beforeEach(() => {
  vi.clearAllMocks();
  saved = [];
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:original"),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ href: this.href, filename: this.download });
  });
  vi.mocked(fetchApiDownload).mockResolvedValue({
    blob: new Blob(["original media"]),
    filename: "结尾.mp4",
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("video editor original asset downloads", () => {
  it.each([
    ["video", "mp4", "video/mp4"],
    ["audio", "wav", "audio/wav"],
    ["image", "png", "image/png"],
  ])(
    "downloads the original %s with the server filename",
    async (kind, ext, mime) => {
      vi.mocked(fetchApiDownload).mockResolvedValue({
        blob: new Blob(["original media"], { type: mime }),
        filename: `结尾.${ext}`,
      });
      renderRow({
        ...asset,
        mediaKind: kind,
        originalFilename: `ending.${ext}`,
      });
      fireEvent.click(screen.getByRole("button", { name: "下载素材“结尾”" }));
      await waitFor(() =>
        expect(saved).toEqual([
          { href: "blob:original", filename: `结尾.${ext}` },
        ]),
      );
      expect(fetchApiDownload).toHaveBeenCalledWith(
        "/v1/files/asset%2Fvideo/download",
        expect.objectContaining({ onProgress: expect.any(Function) }),
      );
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:original");
      expect(document.querySelector("a[download]")).toBeNull();
    },
  );

  it("blocks repeated clicks until the request completes", async () => {
    let finish!: (result: ApiDownload) => void;
    vi.mocked(fetchApiDownload).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderRow();
    const button = screen.getByRole("button", { name: "下载素材“结尾”" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(fetchApiDownload).toHaveBeenCalledOnce();
    finish({ blob: new Blob(["media"]), filename: "结尾.mp4" });
    await waitFor(() => expect(button).toBeEnabled());
    expect(saved).toHaveLength(1);
  });

  it("shows a failure without downloading an error and allows retry", async () => {
    vi.mocked(fetchApiDownload).mockRejectedValueOnce(
      new Error("原文件不存在"),
    );
    renderRow();
    const button = screen.getByRole("button", { name: "下载素材“结尾”" });
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("原文件不存在");
    expect(saved).toHaveLength(0);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchApiDownload).toHaveBeenCalledTimes(2);
  });

  it.each(["queued", "processing", "failed"])(
    "allows original downloads when editing is disabled and proxy is %s",
    async (status) => {
      vi.mocked(fetchApiDownload).mockResolvedValue({
        blob: new Blob(["media"]),
        filename: null,
      });
      renderRow(
        {
          ...asset,
          processingStatus: status,
          originalFilename: "folder/ending.mp4",
        },
        true,
      );
      const button = screen.getByRole("button", { name: "下载素材“结尾”" });
      expect(button).toBeEnabled();
      fireEvent.click(button);
      await waitFor(() => expect(saved[0]?.filename).toBe("folder_ending.mp4"));
    },
  );
});
