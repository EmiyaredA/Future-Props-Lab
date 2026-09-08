import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const secondAsset: VideoEditorAsset = {
  ...asset,
  id: "asset-audio",
  displayName: "配乐.wav",
  originalFilename: "music.wav",
  mediaKind: "audio",
  mimeType: "audio/wav",
};

function renderPanel({
  assets = [asset],
  organization,
  onOrganizationChange = vi.fn(),
}: {
  assets?: VideoEditorAsset[];
  organization?: {
    folders?: { id: string; name: string; assetIds?: string[] }[];
    rootAssetIds?: string[];
  };
  onOrganizationChange?: ReturnType<typeof vi.fn>;
} = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <VideoEditorAssetPanel
        projectId="project-1"
        assets={assets}
        organization={organization}
        onAdd={vi.fn()}
        onAddGenerated={vi.fn()}
        onOrganizationChange={onOrganizationChange}
      />
    </QueryClientProvider>,
  );
  return { ...view, onOrganizationChange };
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

  it("creates a trimmed unique folder and keeps new assets unclassified", async () => {
    const user = userEvent.setup();
    const { onOrganizationChange } = renderPanel({
      assets: [asset, secondAsset],
      organization: {
        folders: [{ id: "folder-scenes", name: "场景", assetIds: [asset.id] }],
        rootAssetIds: [],
      },
    });

    expect(screen.getByRole("button", { name: "未分类 1" })).toHaveTextContent(
      "1",
    );
    await user.click(screen.getByRole("button", { name: "新建素材文件夹" }));
    await user.type(
      screen.getByRole("textbox", { name: "文件夹名称" }),
      "  配乐  ",
    );
    await user.click(screen.getByRole("button", { name: "保存文件夹名称" }));

    expect(onOrganizationChange).toHaveBeenCalledWith({
      folders: [
        { id: "folder-scenes", name: "场景", assetIds: [asset.id] },
        { id: expect.any(String), name: "配乐", assetIds: [] },
      ],
      rootAssetIds: [secondAsset.id],
    });
  });

  it("renames, collapses and deletes folders without deleting their assets", async () => {
    const user = userEvent.setup();
    const { onOrganizationChange } = renderPanel({
      organization: {
        folders: [{ id: "folder-scenes", name: "场景", assetIds: [asset.id] }],
        rootAssetIds: [],
      },
    });

    await user.click(screen.getByRole("button", { name: "场景 1" }));
    expect(
      screen.queryByRole("button", { name: /双击将“演示视频/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "场景 1" }));
    await user.click(
      screen.getByRole("button", { name: "重命名文件夹“场景”" }),
    );
    const name = screen.getByRole("textbox", { name: "重命名文件夹“场景”" });
    await user.clear(name);
    await user.type(name, "镜头");
    await user.click(screen.getByRole("button", { name: "保存文件夹名称" }));
    expect(onOrganizationChange).toHaveBeenLastCalledWith({
      folders: [{ id: "folder-scenes", name: "镜头", assetIds: [asset.id] }],
      rootAssetIds: [],
    });

    await user.click(screen.getByRole("button", { name: "删除文件夹“场景”" }));
    expect(onOrganizationChange).toHaveBeenLastCalledWith({
      folders: [],
      rootAssetIds: [asset.id],
    });
  });

  it("moves and sorts assets from the accessible organize menu", async () => {
    const user = userEvent.setup();
    const { onOrganizationChange } = renderPanel({
      assets: [asset, secondAsset],
      organization: {
        folders: [
          {
            id: "folder-media",
            name: "媒体",
            assetIds: [asset.id, secondAsset.id],
          },
        ],
        rootAssetIds: [],
      },
    });

    await user.click(
      screen.getByRole("button", { name: "整理素材“配乐.wav”" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "上移" }));
    expect(onOrganizationChange).toHaveBeenLastCalledWith({
      folders: [
        {
          id: "folder-media",
          name: "媒体",
          assetIds: [secondAsset.id, asset.id],
        },
      ],
      rootAssetIds: [],
    });

    await user.click(
      screen.getByRole("button", { name: "整理素材“配乐.wav”" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "未分类" }));
    expect(onOrganizationChange).toHaveBeenLastCalledWith({
      folders: [{ id: "folder-media", name: "媒体", assetIds: [asset.id] }],
      rootAssetIds: [secondAsset.id],
    });
  });

  it("supports dragging an asset into a folder while retaining timeline drag data", () => {
    const { container, onOrganizationChange } = renderPanel({
      organization: {
        folders: [{ id: "folder-scenes", name: "场景", assetIds: [] }],
        rootAssetIds: [asset.id],
      },
    });
    const values = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "",
      types: [] as string[],
      setData(type: string, value: string) {
        values.set(type, value);
        if (!this.types.includes(type)) this.types.push(type);
      },
      getData(type: string) {
        return values.get(type) ?? "";
      },
    };
    const row = screen
      .getByRole("button", { name: /双击将“演示视频/ })
      .closest(".ve-asset-wrap");
    const folderRow = screen
      .getByRole("button", { name: "场景 0" })
      .closest(".ve-asset-folder-row");
    if (!row || !folderRow) throw new Error("missing drag targets");

    fireEvent.dragStart(row, { dataTransfer });
    expect(values.get("application/x-video-editor-asset")).toBe(asset.id);
    fireEvent.dragOver(folderRow, { dataTransfer });
    fireEvent.drop(folderRow, { dataTransfer });

    expect(onOrganizationChange).toHaveBeenCalledWith({
      folders: [{ id: "folder-scenes", name: "场景", assetIds: [asset.id] }],
      rootAssetIds: [],
    });
    expect(container.querySelector(".ve-assets-panel")).toBeInTheDocument();
  });
});
