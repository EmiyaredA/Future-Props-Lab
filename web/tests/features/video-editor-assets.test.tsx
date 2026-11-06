import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VideoEditorAssetPanel } from "@features/video-editor/VideoEditorAssetPanel";
import { ApiError } from "@platform/api/errors";
import { videoEditorQueryKeys } from "@features/video-editor/queryKeys";
import {
  applyVideoEditorOperations,
  deleteVideoEditorAsset,
  getVideoEditorTimeline,
  importVideoEditorAssets,
  listVideoEditorAssets,
  listVideoEditorImportSources,
  renameVideoEditorAsset,
  uploadVideoEditorAsset,
} from "@features/video-editor/api";
import type { VideoEditorAsset } from "@features/video-editor/types";

vi.mock("@features/video-editor/api", () => ({
  applyVideoEditorOperations: vi.fn(),
  createVideoEditorAssetBake: vi.fn(),
  deleteVideoEditorAsset: vi.fn(),
  getVideoEditorAssetBake: vi.fn(),
  getVideoEditorTimeline: vi.fn(),
  listVideoEditorAssets: vi.fn(),
  importVideoEditorAssets: vi.fn(),
  listVideoEditorImportSources: vi.fn(),
  patchVideoEditorAsset: vi.fn(),
  renameVideoEditorAsset: vi.fn(),
  uploadVideoEditorAsset: vi.fn(),
}));

vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: (path: string | null | undefined) => ({
    url: path ? `blob:preview-${path}` : "",
    loading: false,
    error: null,
  }),
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
  defaultEffects: {},
  revision: 0,
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
  onAddBatch = vi.fn(),
  onImportSubtitles = vi.fn(),
  disabled = false,
}: {
  assets?: VideoEditorAsset[];
  organization?: {
    folders?: { id: string; name: string; assetIds?: string[] }[];
    rootAssetIds?: string[];
  };
  onOrganizationChange?: ReturnType<typeof vi.fn>;
  onAddBatch?: ReturnType<typeof vi.fn>;
  onImportSubtitles?: ReturnType<typeof vi.fn>;
  disabled?: boolean;
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
        disabled={disabled}
        assets={assets}
        organization={organization}
        onAdd={vi.fn()}
        onAddBatch={onAddBatch}
        onAddGenerated={vi.fn()}
        onImportSubtitles={onImportSubtitles}
        onOrganizationChange={onOrganizationChange}
      />
    </QueryClientProvider>,
  );
  return {
    ...view,
    client,
    onOrganizationChange,
    onAddBatch,
    onImportSubtitles,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listVideoEditorImportSources).mockResolvedValue({ items: [] });
});

describe("video editor asset panel", () => {
  async function openRename(user: ReturnType<typeof userEvent.setup>) {
    await user.click(
      screen.getByRole("button", { name: `重命名素材“${asset.displayName}”` }),
    );
    return screen.getByRole("textbox", { name: "素材名称" });
  }

  it("renames a video with its revision and refreshes the asset query", async () => {
    const user = userEvent.setup();
    const { client } = renderPanel({ assets: [{ ...asset, revision: 7 }] });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    vi.mocked(renameVideoEditorAsset).mockResolvedValue({
      ...asset,
      displayName: "镜头一",
      revision: 8,
    });
    const input = await openRename(user);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(input).toHaveValue(asset.displayName);
    expect(input).toHaveAttribute("maxlength", "255");
    await user.clear(input);
    await user.type(input, "  镜头一  {Enter}");
    await waitFor(() =>
      expect(renameVideoEditorAsset).toHaveBeenCalledWith(
        "project-1",
        asset.id,
        7,
        "镜头一",
      ),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: videoEditorQueryKeys.assets("project-1"),
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("rejects blank names and allows Escape to cancel without a request", async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = await openRename(user);
    await user.clear(input);
    await user.type(input, "   {Enter}");
    expect(screen.getByRole("button", { name: "保存名称" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(renameVideoEditorAsset).not.toHaveBeenCalled();
  });

  it("preserves a failed name for an explicit retry", async () => {
    const user = userEvent.setup();
    vi.mocked(renameVideoEditorAsset)
      .mockRejectedValueOnce(new Error("连接失败"))
      .mockResolvedValueOnce({ ...asset, displayName: "新镜头", revision: 1 });
    renderPanel();
    const input = await openRename(user);
    await user.clear(input);
    await user.type(input, "新镜头{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("连接失败");
    expect(input).toHaveValue("新镜头");
    await user.click(screen.getByRole("button", { name: "保存名称" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(renameVideoEditorAsset).toHaveBeenCalledTimes(2);
  });

  it("keeps a conflict visible and requires reopening before another submission", async () => {
    const user = userEvent.setup();
    vi.mocked(renameVideoEditorAsset).mockRejectedValue(
      new ApiError("版本冲突", {}, 409),
    );
    renderPanel();
    const input = await openRename(user);
    await user.clear(input);
    await user.type(input, "新镜头{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("素材已被修改");
    expect(input).toHaveValue("新镜头");
    expect(screen.getByRole("button", { name: "保存名称" })).toBeDisabled();
    await user.keyboard("{Enter}");
    expect(renameVideoEditorAsset).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("blocks repeat submissions and closing while the name is saving", async () => {
    const user = userEvent.setup();
    let complete!: (value: VideoEditorAsset) => void;
    vi.mocked(renameVideoEditorAsset).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    renderPanel();
    const input = await openRename(user);
    await user.clear(input);
    await user.type(input, "新镜头{Enter}");
    expect(screen.getByRole("button", { name: "保存中…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    await user.keyboard("{Escape}{Enter}");
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(renameVideoEditorAsset).toHaveBeenCalledTimes(1);
    complete({ ...asset, displayName: "新镜头", revision: 1 });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("disables asset organization in read-only mode", () => {
    renderPanel({ disabled: true });
    expect(
      screen.getByRole("button", { name: `整理素材“${asset.displayName}”` }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: `重命名素材“${asset.displayName}”` }),
    ).toBeDisabled();
  });

  it("opens the subtitle file picker from the text menu", async () => {
    const user = userEvent.setup();
    const { onImportSubtitles } = renderPanel();
    await user.click(screen.getByRole("combobox", { name: "添加文字" }));
    await user.click(screen.getByRole("option", { name: "导入字幕文件" }));
    const file = new File(
      ["1\n00:00:00,000 --> 00:00:01,000\n字幕"],
      "caption.srt",
      {
        type: "text/plain",
      },
    );
    await user.upload(screen.getByLabelText("选择字幕文件"), file);
    await waitFor(() => expect(onImportSubtitles).toHaveBeenCalledWith(file));
  });

  it("uploads into a chosen folder and saves the organization", async () => {
    const user = userEvent.setup();
    vi.mocked(uploadVideoEditorAsset).mockResolvedValue(asset);
    vi.mocked(getVideoEditorTimeline).mockResolvedValue({
      projectId: "project-1",
      revision: 2,
      updatedAt: "2026-09-19",
      document: {
        folders: [],
        tracks: [],
        assetOrganization: {
          folders: [{ id: "folder", name: "特效", assetIds: [] }],
          rootAssetIds: [],
        },
      },
    } as never);
    vi.mocked(listVideoEditorAssets).mockResolvedValue({ items: [asset] });
    vi.mocked(applyVideoEditorOperations).mockResolvedValue({
      revision: 3,
    } as never);
    renderPanel({
      assets: [asset],
      organization: {
        folders: [{ id: "folder", name: "特效", assetIds: [] }],
        rootAssetIds: [asset.id],
      },
    });
    await user.click(
      screen.getByRole("button", { name: "向文件夹“特效”添加素材" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "本地上传" }));
    await user.upload(
      screen.getByLabelText("上传素材（可多选）"),
      new File(["a"], "a.mp4", { type: "video/mp4" }),
    );
    await waitFor(() => expect(applyVideoEditorOperations).toHaveBeenCalled());
    expect(vi.mocked(applyVideoEditorOperations).mock.calls[0]?.[2]).toEqual([
      {
        type: "setAssetOrganization",
        organization: {
          folders: [{ id: "folder", name: "特效", assetIds: [asset.id] }],
          rootAssetIds: [],
        },
      },
    ]);
  });

  it("keeps uploaded assets recoverable when folder placement fails", async () => {
    const user = userEvent.setup();
    vi.mocked(uploadVideoEditorAsset).mockResolvedValue(asset);
    vi.mocked(getVideoEditorTimeline).mockResolvedValue({
      projectId: "project-1",
      revision: 2,
      updatedAt: "2026-09-19",
      document: {
        tracks: [],
        assetOrganization: {
          folders: [{ id: "folder", name: "特效", assetIds: [] }],
          rootAssetIds: [],
        },
      },
    } as never);
    vi.mocked(listVideoEditorAssets).mockResolvedValue({ items: [asset] });
    vi.mocked(applyVideoEditorOperations).mockRejectedValue(
      new Error("版本冲突"),
    );
    renderPanel({
      organization: {
        folders: [{ id: "folder", name: "特效", assetIds: [] }],
        rootAssetIds: [],
      },
    });
    await user.click(
      screen.getByRole("button", { name: "向文件夹“特效”添加素材" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "本地上传" }));
    await user.upload(
      screen.getByLabelText("上传素材（可多选）"),
      new File(["a"], "a.mp4", { type: "video/mp4" }),
    );
    expect(
      await screen.findByRole("button", { name: /重试将 1 个素材归入/ }),
    ).toBeVisible();
    expect(screen.getByText(/暂在“未分类”/)).toBeVisible();
    expect(applyVideoEditorOperations).toHaveBeenCalledTimes(1);
  });

  it("selects folder assets for ordered batch actions", async () => {
    const user = userEvent.setup();
    const { onAddBatch, onOrganizationChange } = renderPanel({
      assets: [asset, secondAsset],
      organization: {
        folders: [
          { id: "folder", name: "特效", assetIds: [asset.id, secondAsset.id] },
        ],
        rootAssetIds: [],
      },
    });
    await user.click(
      screen.getByRole("button", { name: "批量选择文件夹“特效”中的素材" }),
    );
    await user.click(screen.getByRole("button", { name: "全选" }));
    expect(screen.getByText("已选择 2 项")).toBeVisible();
    expect(screen.getByRole("button", { name: "取消全选" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "添加到时间轴" }));
    await waitFor(() =>
      expect(onAddBatch).toHaveBeenCalledWith([asset, secondAsset]),
    );
    await user.click(screen.getByRole("button", { name: "全选" }));
    await user.click(screen.getByRole("button", { name: "移动到文件夹" }));
    await user.click(screen.getByRole("menuitem", { name: "未分类" }));
    expect(onOrganizationChange).toHaveBeenCalledWith({
      folders: [{ id: "folder", name: "特效", assetIds: [] }],
      rootAssetIds: [asset.id, secondAsset.id],
    });
  });

  it("adds manually selected assets in folder order rather than click order", async () => {
    const user = userEvent.setup();
    const { onAddBatch } = renderPanel({
      assets: [asset, secondAsset],
      organization: {
        folders: [
          { id: "folder", name: "特效", assetIds: [asset.id, secondAsset.id] },
        ],
        rootAssetIds: [],
      },
    });
    await user.click(
      screen.getByRole("button", { name: "批量选择文件夹“特效”中的素材" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "选择素材“配乐.wav”" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "选择素材“演示视频.mp4”" }),
    );
    await user.click(screen.getByRole("button", { name: "添加到时间轴" }));
    await waitFor(() =>
      expect(onAddBatch).toHaveBeenCalledWith([asset, secondAsset]),
    );
  });

  it("keeps only failed items selected after a partial batch deletion", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteVideoEditorAsset)
      .mockResolvedValueOnce({ deleted: true })
      .mockRejectedValueOnce(new Error("素材仍被时间轴引用"));
    renderPanel({
      assets: [asset, secondAsset],
      organization: {
        folders: [
          { id: "folder", name: "特效", assetIds: [asset.id, secondAsset.id] },
        ],
        rootAssetIds: [],
      },
    });
    await user.click(
      screen.getByRole("button", { name: "批量选择文件夹“特效”中的素材" }),
    );
    await user.click(screen.getByRole("button", { name: "全选" }));
    await user.click(screen.getByRole("button", { name: /^删除$/ }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "素材仍被时间轴引用",
      ),
    );
    expect(
      screen.getByRole("checkbox", { name: "选择素材“配乐.wav”" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "选择素材“演示视频.mp4”" }),
    ).not.toBeChecked();
  });
  it("uploads multiple selected files in order and allows choosing the same file again", async () => {
    const user = userEvent.setup();
    vi.mocked(uploadVideoEditorAsset).mockResolvedValue(asset);
    renderPanel();
    const input = screen.getByLabelText(
      "上传素材（可多选）",
    ) as HTMLInputElement;
    expect(input).toHaveAttribute("multiple");
    const files = [
      new File(["one"], "one.mp4", { type: "video/mp4" }),
      new File(["two"], "two.mp4", { type: "video/mp4" }),
    ];
    await user.upload(input, files);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "上传完成：成功 2 个",
      ),
    );
    expect(uploadVideoEditorAsset).toHaveBeenNthCalledWith(
      1,
      "project-1",
      files[0],
      undefined,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    expect(uploadVideoEditorAsset).toHaveBeenNthCalledWith(
      2,
      "project-1",
      files[1],
      undefined,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    expect(input.value).toBe("");
    await user.upload(input, files[0]!);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "上传完成：成功 1 个",
      ),
    );
    expect(uploadVideoEditorAsset).toHaveBeenCalledTimes(3);
  });

  it("continues after an individual failure and reports the failed filename", async () => {
    const user = userEvent.setup();
    vi.mocked(uploadVideoEditorAsset)
      .mockResolvedValueOnce(asset)
      .mockRejectedValueOnce(new Error("文件过大"))
      .mockResolvedValueOnce(asset);
    renderPanel();
    const files = ["one.mp4", "failed.mp4", "last.mp4"].map(
      (name) => new File([name], name, { type: "video/mp4" }),
    );
    await user.upload(screen.getByLabelText("上传素材（可多选）"), files);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "上传完成：成功 2 个，失败 1 个",
      ),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("failed.mp4：文件过大");
    expect(uploadVideoEditorAsset).toHaveBeenNthCalledWith(
      3,
      "project-1",
      files[2],
      undefined,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
  });

  it("displays batch progress and prevents another selection while uploading", async () => {
    const user = userEvent.setup();
    let complete!: (value: VideoEditorAsset) => void;
    vi.mocked(uploadVideoEditorAsset)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValueOnce(asset);
    renderPanel();
    const files = ["first.mp4", "second.mp4"].map(
      (name) => new File([name], name, { type: "video/mp4" }),
    );
    await user.upload(screen.getByLabelText("上传素材（可多选）"), files);
    expect(screen.getByRole("status")).toHaveTextContent(
      "正在上传 0/2：first.mp4",
    );
    expect(
      screen.getByRole("button", { name: "向未分类添加素材" }),
    ).toBeDisabled();
    expect(uploadVideoEditorAsset).toHaveBeenCalledTimes(1);
    complete(asset);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "上传完成：成功 2 个",
      ),
    );
    expect(
      screen.getByRole("button", { name: "向未分类添加素材" }),
    ).toBeEnabled();
  });

  it("does not upload when file selection is cancelled", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("上传素材（可多选）"), {
      target: { files: [] },
    });
    expect(uploadVideoEditorAsset).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("allows editing after duration detection while preview media is still preparing", () => {
    renderPanel({ assets: [{ ...asset, processingStatus: "processing" }] });
    expect(screen.getByText("可剪辑 · 预览准备中")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: `将“${asset.displayName}”添加到时间轴`,
      }),
    ).toBeEnabled();
  });

  it("explains missing duration and carries the asset identity for drop feedback", () => {
    renderPanel({
      assets: [{ ...asset, processingStatus: "processing", probe: {} }],
    });
    expect(screen.getByText("正在读取媒体信息")).toBeVisible();
    const add = screen.getByRole("button", {
      name: `将“${asset.displayName}”添加到时间轴`,
    });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute(
      "title",
      expect.stringContaining("正在读取时长"),
    );
    const values = new Map<string, string>();
    const row = add.closest(".ve-asset-wrap")!;
    fireEvent.dragStart(row, {
      dataTransfer: {
        setData: (key: string, value: string) => values.set(key, value),
      },
    });
    expect(values.get("application/x-video-editor-asset")).toBe(asset.id);
  });

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
      screen.queryByRole("button", { name: /预览素材“演示视频/ }),
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
      .getByRole("button", { name: /预览素材“演示视频/ })
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

  it("shows a new-folder tooltip and supports root batch selection", async () => {
    const user = userEvent.setup();
    const { onAddBatch } = renderPanel({
      assets: [asset, secondAsset],
      organization: {
        folders: [],
        rootAssetIds: [asset.id, secondAsset.id],
      },
    });
    expect(
      screen.getByRole("button", { name: "新建素材文件夹" }),
    ).toHaveAttribute("data-tooltip", "新建文件夹");
    await user.click(
      screen.getByRole("button", { name: "批量选择未分类中的素材" }),
    );
    await user.click(screen.getByRole("button", { name: "全选" }));
    expect(screen.getByText("已选择 2 项")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "添加到时间轴" }));
    await waitFor(() =>
      expect(onAddBatch).toHaveBeenCalledWith([asset, secondAsset]),
    );
  });

  it("opens the import dialog from the add menu with previews", async () => {
    const user = userEvent.setup();
    vi.mocked(listVideoEditorImportSources).mockResolvedValue({
      items: [
        {
          id: "src-image",
          displayName: "海报.png",
          mediaKind: "image",
          mimeType: "image/png",
          sourceApplication: "visual-workshop",
        },
        {
          id: "src-audio",
          displayName: "旁白.wav",
          mediaKind: "audio",
          mimeType: "audio/wav",
          sourceApplication: "file-library",
        },
      ],
    });
    vi.mocked(importVideoEditorAssets).mockResolvedValue({
      items: [{ ...asset, id: "imported-1", displayName: "海报.png" }],
    });
    vi.mocked(getVideoEditorTimeline).mockResolvedValue({
      projectId: "project-1",
      revision: 2,
      updatedAt: "2026-09-19",
      document: {
        tracks: [],
        assetOrganization: {
          folders: [{ id: "folder", name: "特效", assetIds: [] }],
          rootAssetIds: [],
        },
      },
    } as never);
    vi.mocked(listVideoEditorAssets).mockResolvedValue({
      items: [{ ...asset, id: "imported-1", displayName: "海报.png" }],
    });
    vi.mocked(applyVideoEditorOperations).mockResolvedValue({
      revision: 3,
    } as never);
    renderPanel({
      organization: {
        folders: [{ id: "folder", name: "特效", assetIds: [] }],
        rootAssetIds: [],
      },
    });
    await user.click(
      screen.getByRole("button", { name: "向文件夹“特效”添加素材" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "从其他项目导入" }));
    expect(
      await screen.findByRole("dialog", { name: "从其他应用复制素材" }),
    ).toBeVisible();
    expect(
      document.querySelector(".ve-import-preview")?.getAttribute("src"),
    ).toContain("/v1/files/src-image/content");
    await user.click(screen.getByRole("button", { name: /海报\.png/ }));
    await user.click(screen.getByRole("button", { name: /复制 1 项/ }));
    await waitFor(() =>
      expect(importVideoEditorAssets).toHaveBeenCalledWith("project-1", [
        "src-image",
      ]),
    );
    await waitFor(() => expect(applyVideoEditorOperations).toHaveBeenCalled());
  });
});
