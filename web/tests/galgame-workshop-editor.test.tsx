import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { GalgameWorkshopEditorPage } from "@features/galgame-workshop/editor";
import {
  batchUploadGalgameProjectAssets,
  getGalgameStoryDocument,
  getGalgameStoryReport,
  getGalgameAssetOverview,
  getGalgamePackageManifest,
  getGalgameProjectAssets,
  getGalgameWorkshopProject,
  patchGalgameProjectAsset,
  patchGalgameWorkshopProject,
  previewGalgameAssetImport,
  putGalgameStoryDocument,
  repairGalgameMissingAsset,
  scanGalgameAssetMetadata,
  uploadGalgameProjectAsset,
  type GalgameStoryDocument,
  type GalgameProjectAsset,
} from "@features/galgame-workshop/api";
import { ApiError } from "@platform/api/client";

vi.mock("@platform/api/client", async () => {
  const actual = await vi.importActual<typeof import("@platform/api/client")>(
    "@platform/api/client",
  );
  return {
    ...actual,
    fetchApiBlob: vi.fn().mockResolvedValue(new Blob(["audio"])),
  };
});

class EditorMockAudio {
  static instances: EditorMockAudio[] = [];
  src = "";
  currentTime = 0;
  duration = 1780.344;
  readyState = 1;
  volume = 1;
  loop = false;
  paused = true;
  preload = "";
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  removeAttribute = vi.fn();

  constructor() {
    EditorMockAudio.instances.push(this);
  }
}

vi.mock("@features/galgame-workshop/api", async () => {
  const actual = await vi.importActual<
    typeof import("@features/galgame-workshop/api")
  >("@features/galgame-workshop/api");
  return {
    ...actual,
    getGalgameStoryDocument: vi.fn(),
    getGalgameStoryReport: vi.fn(),
    getGalgameAssetOverview: vi.fn(),
    getGalgamePackageManifest: vi.fn(),
    getGalgameProjectAssets: vi.fn(),
    getGalgameWorkshopProject: vi.fn(),
    patchGalgameWorkshopProject: vi.fn(),
    putGalgameStoryDocument: vi.fn(),
    patchGalgameProjectAsset: vi.fn(),
    previewGalgameAssetImport: vi.fn(),
    batchUploadGalgameProjectAssets: vi.fn(),
    deleteGalgameProjectAsset: vi.fn(),
    repairGalgameMissingAsset: vi.fn(),
    scanGalgameAssetMetadata: vi.fn(),
    uploadGalgameProjectAsset: vi.fn(),
  };
});

vi.mock("@features/galgame-workshop/editor/StoryAssetImage", () => ({
  StoryAssetImage: ({ fileId }: { fileId?: string }) => (
    <span data-file-id={fileId ?? ""}>图片</span>
  ),
}));

vi.mock("@features/galgame-workshop/editor/StoryAudioPreview", () => ({
  StoryAudioPreview: ({ label }: { label: string }) => (
    <span data-testid="audio-preview">{label}</span>
  ),
}));

const project = {
  id: "project-1",
  title: "纵向切片",
  status: "draft" as const,
  revision: 0,
  created_at: "2026-08-05T08:00:00Z",
  updated_at: "2026-08-05T08:00:00Z",
};
const story = {
  project_id: "project-1",
  revision: 0,
  updated_at: "2026-08-05T08:00:00Z",
  document: {
    schemaVersion: "1.0" as const,
    synopsis: "",
    characters: [],
    scenes: [],
    variables: [],
    assets: [],
    chapters: [
      {
        id: "chapter-1",
        title: "第一章",
        order: 1,
        entryFragmentId: "main",
        fragments: [{ id: "main", title: "main", blocks: [] }],
      },
    ],
  },
};

type AssetOverviewItem = Awaited<
  ReturnType<typeof getGalgameAssetOverview>
>["items"][number];
type StrictProjectAsset = Awaited<ReturnType<typeof patchGalgameProjectAsset>>;

function overviewItem(
  overrides: Partial<AssetOverviewItem> &
    Pick<AssetOverviewItem, "id" | "display_name">,
): AssetOverviewItem {
  const { id, display_name, ...rest } = overrides;
  return {
    id,
    display_name,
    media_kind: "image",
    mime_type: "image/png",
    byte_size: 1024,
    category: "other",
    virtualPath: `other/${overrides.display_name}`,
    packagingPolicy: "auto",
    revision: 0,
    orphaned: false,
    missing: false,
    reference_count: 0,
    created_at: "2026-08-05T08:00:00Z",
    updated_at: "2026-08-05T08:00:00Z",
    ...rest,
  };
}

async function openAssetSection(
  user: ReturnType<typeof userEvent.setup>,
  section: "角色" | "场景" | "BGM" | "音效" | "语音",
) {
  const workspace = screen.getByRole("navigation", { name: "创作工作区" });
  await user.click(within(workspace).getByRole("button", { name: "资产" }));
  const heading = await screen.findByText("资产中心");
  await user.click(
    within(heading.closest("aside")!).getByRole("button", { name: section }),
  );
}

const branchingStory = {
  ...story,
  document: {
    ...story.document,
    chapters: [
      {
        ...story.document.chapters[0],
        fragments: [
          {
            id: "main",
            title: "实验室日常",
            blocks: [
              {
                id: "branch-one",
                type: "branch" as const,
                prompt: "选择调查方向",
                choices: [
                  {
                    id: "choice-device",
                    text: "检查设备",
                    targetFragmentId: "ending-device",
                  },
                  {
                    id: "choice-clock",
                    text: "检查时钟",
                    targetFragmentId: "ending-clock",
                  },
                ],
              },
            ],
          },
          {
            id: "ending-device",
            title: "设备结局",
            blocks: [
              {
                id: "end-device",
                type: "endChapter" as const,
                endingId: "device",
                label: "设备结局",
              },
            ],
          },
          {
            id: "ending-clock",
            title: "时钟结局",
            blocks: [
              {
                id: "end-clock",
                type: "endChapter" as const,
                endingId: "clock",
                label: "时钟结局",
              },
            ],
          },
        ],
      },
    ],
  },
};

const clearBranchingReport = {
  project_id: "project-1",
  story_revision: 0,
  ready: true,
  errors: [],
  warnings: [],
  chapters: [
    {
      chapter_id: "chapter-1",
      reachable_fragment_ids: ["main", "ending-device", "ending-clock"],
      unreachable_fragment_ids: [],
      ending_ids: ["device", "clock"],
      cycles: [],
    },
  ],
};

function renderEditor() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GalgameWorkshopEditorPage projectId="project-1" onOverview={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  EditorMockAudio.instances = [];
  vi.stubGlobal("Audio", EditorMockAudio);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:editor-audio"),
    revokeObjectURL: vi.fn(),
  });
  localStorage.removeItem("future_props_theme");
  localStorage.removeItem("future_props_galgame_editor_sidebar_widths");
  localStorage.removeItem("future_props_galgame_editor_script_layout_v2");
  localStorage.removeItem("future_props_galgame_editor_script_view");
  Object.defineProperty(window, "PointerEvent", {
    configurable: true,
    writable: true,
    value: MouseEvent,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
  document.documentElement.dataset.theme = "light";
  vi.mocked(getGalgameWorkshopProject).mockResolvedValue(project);
  vi.mocked(patchGalgameWorkshopProject).mockImplementation(
    async (current, changes) => ({
      ...current,
      ...changes,
      revision: current.revision + 1,
    }),
  );
  vi.mocked(getGalgameStoryDocument).mockResolvedValue(story);
  vi.mocked(getGalgameStoryReport).mockResolvedValue({
    project_id: "project-1",
    story_revision: 0,
    ready: false,
    errors: [
      { code: "open_fragment", message: "线路尚未结束", path: "/chapters/0" },
    ],
    warnings: [],
    chapters: [],
  });
  vi.mocked(getGalgameProjectAssets).mockResolvedValue({ items: [] });
  vi.mocked(getGalgameAssetOverview).mockResolvedValue({
    items: [],
    missing_items: [],
  });
  vi.mocked(getGalgamePackageManifest).mockResolvedValue({
    ready: true,
    totalBytes: 0,
    items: [],
    issues: [],
  });
  vi.mocked(scanGalgameAssetMetadata).mockResolvedValue({ items: [] });
  vi.mocked(uploadGalgameProjectAsset).mockResolvedValue({
    id: "file-dialogue-frame",
    display_name: "dialogue-frame.png",
    media_kind: "image",
    mime_type: "image/png",
    byte_size: 256,
    revision: 0,
    created_at: "2026-08-05T08:00:00Z",
    updated_at: "2026-08-05T08:00:00Z",
  });
  vi.mocked(putGalgameStoryDocument).mockImplementation(
    async (_projectId, document, expectedRevision) => ({
      project_id: "project-1",
      document,
      revision: expectedRevision + 1,
      updated_at: "2026-08-05T09:00:00Z",
    }),
  );
});

test("filters, summarizes, switches, and edits the aligned asset overview", async () => {
  const user = userEvent.setup();
  const particle = overviewItem({
    id: "asset-particle",
    display_name: "spark.png",
    virtualPath: "particles/spark.png",
    byte_size: 1024,
    reference_count: 1,
    references: [
      {
        kind: "block",
        label: "第一章 · main · Block 1",
        chapterId: "chapter-1",
        fragmentId: "main",
        blockId: "block-1",
      },
    ],
  });
  const music = overviewItem({
    id: "asset-music",
    display_name: "主题曲.mp3",
    media_kind: "audio",
    mime_type: "audio/mpeg",
    category: "bgm",
    virtualPath: "bgm/主题曲.mp3",
    byte_size: 4096,
    durationMs: 65_000,
    reference_count: 1,
  });
  const frame = overviewItem({
    id: "asset-frame",
    display_name: "frame.png",
    category: "other",
    virtualPath: "ui/frame.png",
    byte_size: 2048,
    orphaned: true,
  });
  vi.mocked(getGalgameAssetOverview).mockResolvedValue({
    items: [particle, music, frame],
    missing_items: [],
    totalBytes: 7168,
    referencedCount: 2,
    orphanedCount: 1,
    estimatedPackageBytes: 5120,
    largestAssetIds: ["asset-music", "asset-frame", "asset-particle"],
    moduleHealth: { bgm: "ready" },
  });
  vi.mocked(getGalgamePackageManifest).mockResolvedValue({
    ready: true,
    totalBytes: 5120,
    items: [
      {
        assetId: "asset-particle",
        virtualPath: "particles/spark.png",
        byteSize: 1024,
        reason: "referenced",
      },
      {
        assetId: "asset-music",
        virtualPath: "bgm/主题曲.mp3",
        byteSize: 4096,
        reason: "referenced",
      },
    ],
    issues: [],
  });
  vi.mocked(patchGalgameProjectAsset).mockResolvedValue(
    frame as unknown as StrictProjectAsset,
  );

  renderEditor();
  await screen.findByText("纵向切片");
  await user.click(
    within(screen.getByRole("navigation", { name: "创作工作区" })).getByRole(
      "button",
      { name: "资产" },
    ),
  );

  expect(await screen.findByText(/共 3 项 · 1 项游离/)).toBeInTheDocument();
  expect(screen.getByText("减少 29%")).toBeInTheDocument();
  const filters = screen.getByRole("complementary", { name: "资源筛选" });
  await user.click(within(filters).getByRole("button", { name: /粒子/ }));
  let results = document.querySelector<HTMLElement>(".galgame-assets-results")!;
  expect(within(results).getByText("spark.png")).toBeInTheDocument();
  expect(within(results).queryByText("主题曲.mp3")).not.toBeInTheDocument();

  await user.click(within(filters).getByRole("button", { name: /不限类型/ }));
  await user.type(within(filters).getByLabelText("搜索资源"), "主题");
  results = document.querySelector<HTMLElement>(".galgame-assets-results")!;
  expect(within(results).getAllByText("主题曲.mp3").length).toBeGreaterThan(0);
  expect(within(results).queryByText("frame.png")).not.toBeInTheDocument();
  await user.click(
    within(filters).getByRole("button", { name: "清除资源搜索" }),
  );

  await user.click(screen.getByRole("button", { name: "列表视图" }));
  expect(document.querySelector(".galgame-assets-results")).toHaveClass(
    "is-list",
  );
  await user.click(screen.getByRole("button", { name: /frame.png，游离/ }));
  const inspector = screen.getByRole("complementary", { name: "资源详情" });
  await user.clear(within(inspector).getByLabelText("文件名"));
  await user.type(
    within(inspector).getByLabelText("文件名"),
    "dialogue-frame.png",
  );
  await user.click(
    within(inspector).getByRole("button", { name: "保存资源信息" }),
  );
  await waitFor(() =>
    expect(patchGalgameProjectAsset).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ id: "asset-frame" }),
      expect.objectContaining({ display_name: "dialogue-frame.png" }),
    ),
  );

  const workbench = document.querySelector<HTMLElement>(
    ".galgame-assets-workbench",
  )!;
  const summary = screen.getByRole("region", { name: "资源统计" });
  Object.defineProperty(workbench, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      width: 1000,
      height: 800,
      top: 0,
      right: 1000,
      bottom: 800,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
  Object.defineProperty(summary, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      width: 1000,
      height: 270,
      top: 46,
      right: 1000,
      bottom: 316,
      left: 0,
      x: 0,
      y: 46,
      toJSON: () => ({}),
    }),
  });
  const summaryDivider = screen.getByRole("separator", {
    name: "调整资源统计与资源列表高度",
  });
  fireEvent.pointerDown(summaryDivider, {
    button: 0,
    clientY: 316,
    pointerId: 3,
  });
  fireEvent.pointerMove(window, { clientY: 356, pointerId: 3 });
  fireEvent.pointerUp(window, { clientY: 356, pointerId: 3 });
  await waitFor(() =>
    expect(workbench.style.getPropertyValue("--asset-summary-height")).toBe(
      "310px",
    ),
  );
  expect(
    localStorage.getItem("future_props_galgame_asset_summary_height"),
  ).toBe("310");
  fireEvent.keyDown(summaryDivider, { key: "ArrowUp" });
  expect(workbench.style.getPropertyValue("--asset-summary-height")).toBe(
    "294px",
  );
  fireEvent.doubleClick(summaryDivider);
  expect(workbench.style.getPropertyValue("--asset-summary-height")).toBe("");
  expect(
    localStorage.getItem("future_props_galgame_asset_summary_height"),
  ).toBeNull();

  await user.click(screen.getByRole("button", { name: "收起资源统计" }));
  expect(
    screen.queryByRole("region", { name: "资源统计" }),
  ).not.toBeInTheDocument();
});

test("previews batch imports and repairs missing assets with the latest Story revision", async () => {
  const user = userEvent.setup();
  const replacement = overviewItem({
    id: "asset-replacement",
    display_name: "replacement.png",
    category: "scene",
    virtualPath: "backgrounds/replacement.png",
  });
  const storyWithMissing = structuredClone(story) as GalgameStoryDocument;
  storyWithMissing.document.assets = [
    {
      id: "story-missing",
      type: "image",
      role: "sceneLayer",
      fileId: "deleted-file",
      status: "ready",
    },
  ];
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce(storyWithMissing);
  vi.mocked(getGalgameProjectAssets).mockResolvedValue({
    items: [replacement as GalgameProjectAsset],
  });
  vi.mocked(getGalgameAssetOverview).mockResolvedValue({
    items: [replacement],
    missing_items: [
      {
        story_asset_id: "story-missing",
        story_role: "sceneLayer",
        file_id: "deleted-file",
        missing: true,
        references: [],
      },
    ],
    totalBytes: 1024,
    referencedCount: 0,
    orphanedCount: 0,
    estimatedPackageBytes: 0,
  });
  vi.mocked(getGalgamePackageManifest).mockResolvedValue({
    ready: false,
    totalBytes: 0,
    items: [],
    issues: [
      {
        code: "missing_asset_record",
        storyAssetId: "story-missing",
        message: "被剧本引用的素材记录不存在",
      },
    ],
  });
  vi.mocked(previewGalgameAssetImport).mockResolvedValue({
    items: [
      {
        originalName: "new-bg.png",
        finalName: "new-bg.png",
        virtualPath: "backgrounds/new-bg.png",
        reasons: [],
      },
    ],
  });
  vi.mocked(batchUploadGalgameProjectAssets).mockResolvedValue({
    items: [
      overviewItem({
        id: "asset-new",
        display_name: "new-bg.png",
      }) as unknown as StrictProjectAsset,
    ],
    importItems: [],
  });
  vi.mocked(repairGalgameMissingAsset).mockResolvedValue({
    ...storyWithMissing,
    revision: 2,
    document: {
      ...storyWithMissing.document,
      assets: storyWithMissing.document.assets?.map((asset) => ({
        ...asset,
        fileId: "asset-replacement",
        status: "ready" as const,
      })),
    },
  });

  renderEditor();
  await screen.findByText("纵向切片");
  await user.click(
    within(screen.getByRole("navigation", { name: "创作工作区" })).getByRole(
      "button",
      { name: "资产" },
    ),
  );
  await screen.findByText(/共 1 项/);

  await user.click(screen.getByRole("button", { name: "批量导入资源" }));
  const importDialog = screen.getByRole("dialog", { name: "批量导入资源" });
  const upload =
    importDialog.querySelector<HTMLInputElement>('input[type="file"]')!;
  await user.upload(
    upload,
    new File(["image"], "new-bg.png", { type: "image/png" }),
  );
  await user.click(within(importDialog).getByLabelText("业务分类"));
  await user.click(within(importDialog).getByRole("option", { name: "场景" }));
  await user.click(
    within(importDialog).getByRole("button", { name: "预览目标路径" }),
  );
  expect(
    await within(importDialog).findByText("backgrounds/new-bg.png"),
  ).toBeInTheDocument();
  await user.click(
    within(importDialog).getByRole("button", { name: "确认导入" }),
  );
  await waitFor(() =>
    expect(batchUploadGalgameProjectAssets).toHaveBeenCalledWith(
      "project-1",
      expect.arrayContaining([expect.objectContaining({ name: "new-bg.png" })]),
      "scene",
    ),
  );

  await user.click(
    screen.getByRole("button", { name: "被剧本引用的素材记录不存在" }),
  );
  const inspector = screen.getByRole("complementary", { name: "资源详情" });
  await user.click(within(inspector).getByLabelText("替换文件"));
  await user.click(
    within(inspector).getByRole("option", {
      name: "backgrounds/replacement.png",
    }),
  );
  await user.click(
    within(inspector).getByRole("button", { name: "重新绑定并保存 Story" }),
  );
  await waitFor(() =>
    expect(repairGalgameMissingAsset).toHaveBeenCalledWith(
      "project-1",
      1,
      "story-missing",
      "asset-replacement",
    ),
  );
});

test("keeps route checks in the editor inspector and closes the report accessibly", async () => {
  const user = userEvent.setup();
  renderEditor();
  await screen.findByText("纵向切片");

  const workspaceNavigation = screen.getByRole("navigation", {
    name: "创作工作区",
  });
  expect(
    within(workspaceNavigation).queryByRole("button", { name: /检查/ }),
  ).not.toBeInTheDocument();

  const inspectorNavigation = screen.getByRole("navigation", {
    name: "Block 检查器",
  });
  const checkTab = within(inspectorNavigation).getByRole("button", {
    name: /检查\s*1/,
  });
  await user.click(checkTab);
  expect(screen.getByText("线路尚未完成")).toBeInTheDocument();
  expect(screen.getByText("1 错误 · 0 警告")).toBeInTheDocument();

  const openReport = screen.getByRole("button", { name: "查看完整报告" });
  await user.click(openReport);
  const dialog = await screen.findByRole("dialog", { name: "工程检查" });
  expect(dialog).toHaveTextContent("开放断点");
  expect(document.body.style.overflow).toBe("hidden");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(openReport).toHaveFocus();
  expect(document.body.style.overflow).toBe("");

  await user.click(openReport);
  const backdrop = document.querySelector<HTMLElement>(
    ".galgame-route-report-backdrop",
  )!;
  fireEvent.mouseDown(backdrop);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("navigates the five creator workspaces and locates global search results", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...branchingStory,
    document: {
      ...branchingStory.document,
      variables: [
        {
          id: "trust",
          name: "信任度",
          type: "number",
          defaultValue: 0,
          persistence: "session",
          description: "",
        },
      ],
    },
  });
  renderEditor();
  const workspace = await screen.findByRole("navigation", {
    name: "创作工作区",
  });
  for (const label of ["剧本", "资产", "叙事地图", "个性化", "设置"])
    expect(
      within(workspace).getByRole("button", { name: label }),
    ).toBeVisible();

  await user.click(screen.getByRole("button", { name: /搜索台词/ }));
  const search = screen.getByRole("dialog", { name: "搜索项目内容" });
  await user.type(within(search).getByRole("textbox"), "选择调查方向");
  await user.click(
    within(search).getByRole("button", {
      name: /选择调查方向.*实验室日常/,
    }),
  );
  expect(screen.getByLabelText("选择提示")).toHaveValue("选择调查方向");

  await user.click(within(workspace).getByRole("button", { name: "叙事地图" }));
  expect(await screen.findByText("由 Story 文档实时派生")).toBeInTheDocument();
  expect(screen.getByDisplayValue("信任度")).toBeInTheDocument();

  await user.click(within(workspace).getByRole("button", { name: "个性化" }));
  expect(await screen.findByText("实时游戏预览")).toBeInTheDocument();

  await user.click(within(workspace).getByRole("button", { name: "设置" }));
  expect(
    await screen.findByRole("heading", { name: "项目设置" }),
  ).toBeInTheDocument();
  const projectTitle = screen.getByDisplayValue("纵向切片");
  await user.clear(projectTitle);
  await user.type(projectTitle, "新的项目名称");
  await user.click(screen.getByRole("button", { name: "保存名称" }));
  await waitFor(() =>
    expect(patchGalgameWorkshopProject).toHaveBeenCalledWith(project, {
      title: "新的项目名称",
    }),
  );
});

test("hides the issue badge when the saved route report is clear", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce(branchingStory);
  vi.mocked(getGalgameStoryReport).mockResolvedValueOnce(clearBranchingReport);
  const { container } = renderEditor();
  await screen.findByText("纵向切片");

  const checkTab = screen.getByRole("button", {
    name: "检查",
  });
  expect(
    container.querySelector(".galgame-inspector-count"),
  ).not.toBeInTheDocument();
  await user.click(checkTab);
  expect(screen.getByText("线路检查通过")).toBeInTheDocument();
});

test("derives complete route metrics and only offers valid issue locations", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce(branchingStory);
  vi.mocked(getGalgameStoryReport).mockResolvedValueOnce({
    ...clearBranchingReport,
    ready: false,
    errors: [
      {
        code: "open_fragment",
        message: "Fragment 尚未结束",
        path: "/chapters/0/fragments/2/blocks",
        chapter_id: "chapter-1",
        fragment_id: "ending-clock",
      },
      {
        code: "trapped_cycle",
        message: "线路存在无法抵达结局的循环",
        path: "/chapters/0/fragments",
        chapter_id: "chapter-1",
        fragment_id: "main",
      },
      {
        code: "missing_asset_file",
        message: "背景素材文件不存在",
        path: "/assets/0/fileId",
      },
    ],
    warnings: [
      {
        code: "cycle",
        message: "线路存在可以退出的循环",
        path: "/chapters/0/fragments",
        chapter_id: "chapter-1",
        fragment_id: "main",
      },
    ],
    chapters: [
      {
        chapter_id: "chapter-1",
        reachable_fragment_ids: ["main", "ending-device"],
        unreachable_fragment_ids: ["ending-clock"],
        ending_ids: ["device"],
        cycles: [["main", "ending-device"]],
      },
    ],
  });
  renderEditor();
  await screen.findByText("纵向切片");
  await user.click(screen.getByRole("button", { name: /检查\s*4/ }));

  expect(screen.getByText("线路尚未完成")).toBeInTheDocument();
  expect(
    screen.getByText("2", { selector: ".galgame-inspector-metrics strong" }),
  ).toBeInTheDocument();
  expect(screen.getByText("实验室日常 → 设备结局")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "查看完整报告" }));
  const dialog = screen.getByRole("dialog", { name: "工程检查" });
  expect(within(dialog).getByText("第一章")).toBeInTheDocument();
  expect(
    within(dialog).getByText("不可达").closest("article"),
  ).toHaveTextContent("1");
  expect(
    within(dialog).getByText("开放断点").closest("article"),
  ).toHaveTextContent("1");
  expect(
    within(dialog).getByText("循环 / 困住").closest("article"),
  ).toHaveTextContent("1 / 1");
  const missingAsset = within(dialog)
    .getByText("背景素材文件不存在")
    .closest("div")!;
  expect(
    within(missingAsset).queryByRole("button", { name: "定位" }),
  ).not.toBeInTheDocument();

  const firstRoute = within(dialog)
    .getByText("实验室日常 → 设备结局")
    .closest("li")!;
  await user.click(within(firstRoute).getByRole("button", { name: "定位" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "属性" })).toHaveClass("active");
  expect(screen.getByLabelText("选择提示")).toHaveValue("选择调查方向");

  await user.click(screen.getByRole("button", { name: /检查\s*4/ }));
  await user.click(screen.getByRole("button", { name: "查看完整报告" }));
  const openFragmentIssue = within(
    screen.getByRole("dialog", { name: "工程检查" }),
  )
    .getByText("Fragment 尚未结束")
    .closest("div")!;
  await user.click(
    within(openFragmentIssue).getByRole("button", { name: "定位" }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /检查\s*4/ })).toHaveClass(
    "active",
  );
  expect(
    screen
      .getByText("时钟结局", { selector: ".galgame-fragment-list strong" })
      .closest("button"),
  ).toHaveClass("active");
});

test("shows warning-only status and retries a failed saved-story report", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryReport)
    .mockRejectedValueOnce(new Error("network unavailable"))
    .mockResolvedValueOnce({
      ...clearBranchingReport,
      ready: true,
      warnings: [
        {
          code: "cycle",
          message: "线路存在可以退出的循环，请确认是有意设计",
          path: "/chapters/0/fragments",
          chapter_id: "chapter-1",
          fragment_id: "main",
        },
      ],
      chapters: [
        {
          chapter_id: "chapter-1",
          reachable_fragment_ids: ["main"],
          unreachable_fragment_ids: [],
          ending_ids: [],
          cycles: [["main"]],
        },
      ],
    });
  renderEditor();
  await screen.findByText("纵向切片");
  await user.click(screen.getByRole("button", { name: /^检查$/ }));
  expect(await screen.findByText("线路报告暂时无法读取")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /重试/ }));
  expect(await screen.findByText("线路可玩，但存在警告")).toBeInTheDocument();
  expect(getGalgameStoryReport).toHaveBeenCalledTimes(2);
});

test("resizes both script sidebars and remembers their widths", async () => {
  const { container } = renderEditor();
  expect(await screen.findByText("纵向切片")).toBeInTheDocument();
  const grid = container.querySelector<HTMLElement>(".galgame-editor-grid")!;
  Object.defineProperty(grid, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      width: 1536,
      height: 800,
      top: 0,
      right: 1536,
      bottom: 800,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });

  const storyDivider = screen.getByRole("separator", {
    name: "调整故事结构栏宽度",
  });
  fireEvent.pointerDown(storyDivider, {
    button: 0,
    clientX: 210,
    pointerId: 1,
  });
  fireEvent.pointerMove(window, { clientX: 300, pointerId: 1 });
  fireEvent.pointerUp(window, { clientX: 300, pointerId: 1 });
  await waitFor(() =>
    expect(
      Number(grid.style.getPropertyValue("--galgame-script-left-ratio")),
    ).toBeCloseTo(19.69, 1),
  );

  const previewDivider = screen.getByRole("separator", {
    name: "调整预览检查栏宽度",
  });
  fireEvent.keyDown(previewDivider, { key: "ArrowLeft" });
  expect(
    Number(grid.style.getPropertyValue("--galgame-script-center-ratio")),
  ).toBe(24.5);
  expect(
    JSON.parse(
      localStorage.getItem("future_props_galgame_editor_script_layout_v2")!,
    ),
  ).toMatchObject({ version: 2, centerRatio: 24.5 });

  fireEvent.doubleClick(storyDivider);
  expect(grid.style.getPropertyValue("--galgame-script-left-ratio")).toBe(
    "16.5",
  );
});

test("opens and closes the compact script structure drawer", async () => {
  const previousWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1100,
  });
  window.dispatchEvent(new Event("resize"));
  const { container } = renderEditor();
  expect(await screen.findByText("纵向切片")).toBeInTheDocument();
  const structure = container.querySelector<HTMLElement>(
    ".galgame-fragment-panel",
  )!;
  expect(structure).not.toHaveClass("is-drawer-open");
  fireEvent.click(
    screen.getByRole("button", { name: "打开剧本结构", hidden: true }),
  );
  expect(structure).toHaveClass("is-drawer-open");
  fireEvent.click(
    container.querySelector<HTMLButtonElement>(
      ".galgame-structure-drawer-backdrop",
    )!,
  );
  expect(structure).not.toHaveClass("is-drawer-open");
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: previousWidth,
  });
  window.dispatchEvent(new Event("resize"));
});

test("resizes the stage preview vertically and remembers its height", async () => {
  const { container } = renderEditor();
  expect(await screen.findByText("纵向切片")).toBeInTheDocument();
  const grid = container.querySelector<HTMLElement>(".galgame-editor-grid")!;
  const previewMode = container.querySelector<HTMLElement>(
    ".galgame-preview-mode",
  )!;
  Object.defineProperty(grid, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      width: 1536,
      height: 800,
      top: 100,
      right: 1536,
      bottom: 900,
      left: 0,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    }),
  });
  Object.defineProperty(previewMode, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      width: 900,
      height: 42,
      top: 100,
      right: 1120,
      bottom: 142,
      left: 220,
      x: 220,
      y: 100,
      toJSON: () => ({}),
    }),
  });

  const divider = screen.getByRole("separator", {
    name: "调整舞台与剧情时间轴高度",
  });
  fireEvent.pointerDown(divider, {
    button: 0,
    clientY: 478,
    pointerId: 1,
  });
  fireEvent.pointerMove(window, { clientY: 502, pointerId: 1 });
  fireEvent.pointerUp(window, { clientY: 502, pointerId: 1 });

  await waitFor(() =>
    expect(grid.style.getPropertyValue("--galgame-stage-split")).toBe("50.25%"),
  );
  expect(
    JSON.parse(
      localStorage.getItem("future_props_galgame_editor_script_layout_v2")!,
    ),
  ).toMatchObject({ version: 2, previewSplitRatio: 50.25 });

  fireEvent.doubleClick(divider);
  expect(grid.style.getPropertyValue("--galgame-stage-split")).toBe("60%");
});

test("creates, renames, copies, reorders, and selects entry chapters", async () => {
  const user = userEvent.setup();
  renderEditor();
  expect(await screen.findByText("纵向切片")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "新建章节" }));
  expect(screen.getByText("第 2 章")).toBeInTheDocument();
  const fragmentName = screen.getByLabelText("结构树 Fragment 名称");
  await user.clear(fragmentName);
  await user.type(fragmentName, "第二章入口");
  await user.click(screen.getByRole("button", { name: "设为入口章" }));

  await waitFor(() => {
    const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
    expect(saved?.chapters).toHaveLength(2);
    expect(saved?.entryChapterId).toBe(saved?.chapters?.[1].id);
    expect(saved?.chapters?.[1].fragments?.[0].title).toBe("第二章入口");
  });
  expect(screen.getByRole("button", { name: "禁用" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "复制章节" }));
  expect(screen.getByText("第 2 章 副本")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "章节上移" }));
  await waitFor(() => {
    const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
    expect(saved?.chapters).toHaveLength(3);
    expect(saved?.chapters?.map((chapter) => chapter.order)).toEqual([1, 2, 3]);
  });

  await user.click(screen.getByRole("button", { name: "复制 Fragment" }));
  expect(screen.getByLabelText("结构树 Fragment 名称")).toHaveValue(
    "第二章入口 副本",
  );
});

test("uploads dialogue and custom Gal component images with auto-save", async () => {
  const user = userEvent.setup();
  const { container } = renderEditor();
  expect(await screen.findByText("纵向切片")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "样式" }));
  const uploadButton = await screen.findByRole("button", { name: "上传底图" });

  const uploadInput = container.querySelector<HTMLInputElement>(
    '.galgame-dialogue-style-inspector input[type="file"]',
  )!;
  await user.click(uploadButton);
  await user.upload(
    uploadInput,
    new File(["dialogue-frame"], "dialogue-frame.png", {
      type: "image/png",
    }),
  );
  await waitFor(
    () => {
      const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
      const skinAsset = saved?.assets?.find(
        (asset) => asset.role === "dialogueBox",
      );
      expect(skinAsset).toMatchObject({
        fileId: "file-dialogue-frame",
        status: "ready",
      });
      expect(saved?.presentation?.dialogueBox?.assetId).toBe(skinAsset?.id);
    },
    { timeout: 2000 },
  );

  vi.mocked(uploadGalgameProjectAsset).mockResolvedValueOnce({
    id: "file-status-panel",
    display_name: "status-panel.png",
    media_kind: "image",
    mime_type: "image/png",
    byte_size: 128,
    revision: 0,
    created_at: "2026-08-05T08:00:00Z",
    updated_at: "2026-08-05T08:00:00Z",
  });
  await user.click(screen.getByRole("button", { name: "添加组件" }));
  const componentName = screen.getByLabelText("组件 1 名称");
  await user.clear(componentName);
  await user.type(componentName, "实验状态条");
  await user.click(screen.getByRole("button", { name: "上传实验状态条" }));
  await user.upload(
    uploadInput,
    new File(["status-panel"], "status-panel.png", { type: "image/png" }),
  );
  await waitFor(
    () => {
      const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
      const componentAsset = saved?.assets?.find(
        (asset) => asset.role === "uiComponent",
      );
      expect(componentAsset).toMatchObject({
        fileId: "file-status-panel",
        status: "ready",
      });
      expect(saved?.presentation?.ui?.components?.[0]).toMatchObject({
        name: "实验状态条",
        assetId: componentAsset?.id,
        visibility: "always",
        x: 4,
        y: 4,
        width: 24,
      });
    },
    { timeout: 2000 },
  );

  fireEvent.change(screen.getByLabelText("对话框底板透明度"), {
    target: { value: "65" },
  });
  fireEvent.change(screen.getByLabelText("对话框圆角"), {
    target: { value: "20" },
  });
  await waitFor(
    () =>
      expect(
        vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1].presentation
          ?.dialogueBox,
      ).toMatchObject({
        preset: "custom",
        backgroundOpacity: 0.65,
        borderRadius: 20,
      }),
    { timeout: 2000 },
  );

  await user.click(screen.getByRole("button", { name: "样式" }));
  fireEvent.change(screen.getByLabelText("非说话者亮度"), {
    target: { value: "0.45" },
  });
  await waitFor(
    () =>
      expect(
        vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1].presentation
          ?.stage?.inactiveBrightness,
      ).toBe(0.45),
    { timeout: 2000 },
  );
});

test("creates character and scene entities and auto-saves typed story data", async () => {
  const user = userEvent.setup();
  const { container } = renderEditor();
  expect(await screen.findByText("纵向切片")).toBeInTheDocument();
  expect(
    container.querySelector(".galgame-editor-project img"),
  ).toHaveAttribute("src", "/brand/galgame-workshop-mark-cutout.png");
  await openAssetSection(user, "角色");
  await user.click(screen.getByRole("button", { name: "新建角色" }));
  await waitFor(() => expect(putGalgameStoryDocument).toHaveBeenCalled(), {
    timeout: 2000,
  });
  expect(
    vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1].characters,
  ).toHaveLength(1);

  await openAssetSection(user, "场景");
  const assetHeading = screen.getByText("资产中心");
  expect(
    within(assetHeading.closest("aside")!).queryByRole("button", {
      name: "CG",
    }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "剧情 CG" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "新建场景" }));
  await waitFor(
    () =>
      expect(
        vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1].scenes,
      ).toHaveLength(1),
    { timeout: 2000 },
  );
  await user.click(screen.getByRole("button", { name: "新建 CG" }));
  await waitFor(
    () =>
      expect(
        vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1].cgs,
      ).toHaveLength(1),
    { timeout: 2000 },
  );
});

test("merges scenes and CGs into one searchable asset workspace", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      scenes: [
        {
          id: "scene-lab",
          name: "夜间研究所",
          description: "雨夜场景",
          groupId: "group-city",
          layers: [],
        },
      ],
      sceneGroups: [
        {
          id: "group-city",
          name: "城市",
          color: "#7586E5",
          collapsed: false,
        },
      ],
      cgs: [
        {
          id: "cg-confession",
          name: "雨夜告白",
          description: "关键剧情画面",
          variants: [],
          defaultVariantId: null,
        },
      ],
    },
  });
  renderEditor();
  await screen.findByText("纵向切片");
  await openAssetSection(user, "场景");

  const assetHeading = screen.getByText("资产中心");
  const assetNavigation = assetHeading.closest("aside")!;
  expect(
    within(assetNavigation).getByRole("button", { name: "场景" }),
  ).toHaveTextContent("2");
  expect(
    within(assetNavigation).queryByRole("button", { name: "CG" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /场景 0/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "剧情 CG" })).toBeInTheDocument();
  const sceneItem = screen.getByRole("button", {
    name: "图片 夜间研究所 0 层",
  });
  expect(sceneItem.closest(".galgame-visual-browser-item")).toHaveAttribute(
    "draggable",
    "true",
  );
  expect(screen.getByLabelText("场景名称")).toHaveValue("夜间研究所");
  expect(screen.queryByLabelText("场景说明")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("场景分组")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "添加分组" })).toBeInTheDocument();

  await user.type(screen.getByLabelText("搜索场景和 CG"), "告白");
  await user.click(
    screen.getByRole("button", { name: "图片 雨夜告白 0 个差分" }),
  );
  expect(screen.getByLabelText("CG 名称")).toHaveValue("雨夜告白");
  expect(screen.queryByRole("button", { name: "图层定位" })).toBeNull();

  await user.clear(screen.getByLabelText("搜索场景和 CG"));
  await user.click(
    screen.getByRole("button", { name: "图片 夜间研究所 0 层" }),
  );
  await user.click(screen.getByRole("button", { name: /搜索台词/ }));
  const globalSearch = screen.getByRole("dialog", { name: "搜索项目内容" });
  await user.type(within(globalSearch).getByRole("textbox"), "雨夜告白");
  await user.click(
    within(globalSearch).getByRole("button", { name: /雨夜告白.*CG/ }),
  );
  expect(screen.getByLabelText("CG 名称")).toHaveValue("雨夜告白");
});

test("operates on scene and CG rows through item menus", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      sceneGroups: [
        {
          id: "group-city",
          name: "城市",
          color: "#7586E5",
          collapsed: false,
        },
        {
          id: "group-suburb",
          name: "郊区",
          color: "#6EAF88",
          collapsed: false,
        },
      ],
      scenes: [
        {
          id: "scene-hall",
          name: "大厅",
          description: "入口",
          layers: [
            {
              id: "layer-hall",
              name: "大厅背景",
              assetId: "asset-hall",
              distance: 1,
              offsetX: 0,
              offsetY: 0,
            },
          ],
        },
        {
          id: "scene-roof",
          name: "天台",
          description: "夜景",
          groupId: "group-city",
          layers: [],
        },
      ],
      cgs: [
        {
          id: "cg-rain",
          name: "雨夜 CG",
          description: "关键画面",
          variants: [
            { id: "variant-rain", label: "默认", assetId: "asset-rain" },
          ],
          defaultVariantId: "variant-rain",
        },
      ],
      chapters: [
        {
          ...story.document.chapters[0],
          fragments: [
            {
              id: "main",
              title: "main",
              blocks: [
                { id: "scene-block", type: "scene", sceneId: "scene-hall" },
                {
                  id: "cg-block",
                  type: "showCg",
                  cgId: "cg-rain",
                  variantId: null,
                  displayMode: "fullscreen",
                  fit: "cover",
                },
              ],
            },
          ],
        },
      ],
    },
  });
  renderEditor();
  await screen.findByText("纵向切片");
  await openAssetSection(user, "场景");

  const roofTrigger = screen.getByRole("button", {
    name: "更多操作 天台",
  });
  await user.click(roofTrigger);
  const roofMenu = screen.getByRole("menu", { name: "天台 操作" });
  expect(screen.getByLabelText("场景名称")).toHaveValue("大厅");
  expect(
    within(roofMenu).getByRole("menuitem", { name: "移动到 城市" }),
  ).toBeDisabled();
  expect(
    within(roofMenu).getByRole("menuitem", { name: "移动到 郊区" }),
  ).toBeEnabled();
  expect(
    within(roofMenu).queryByRole("menuitem", { name: "移动到 CG" }),
  ).not.toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu", { name: "天台 操作" })).toBeNull();
  expect(roofTrigger).toHaveFocus();

  await user.click(roofTrigger);
  await user.click(screen.getByLabelText("搜索场景和 CG"));
  expect(screen.queryByRole("menu", { name: "天台 操作" })).toBeNull();

  await user.click(roofTrigger);
  await user.click(screen.getByRole("menuitem", { name: "打开场景" }));
  expect(screen.getByLabelText("场景名称")).toHaveValue("天台");

  await user.click(roofTrigger);
  await user.click(screen.getByRole("menuitem", { name: "重命名" }));
  const rename = screen.getByLabelText("重命名场景");
  await user.clear(rename);
  await user.type(rename, "  新天台  {Enter}");
  await waitFor(
    () => {
      const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
      expect(
        saved?.scenes?.find((scene) => scene.id === "scene-roof")?.name,
      ).toBe("新天台");
    },
    { timeout: 2000 },
  );

  await user.click(screen.getByRole("button", { name: "更多操作 新天台" }));
  await user.click(screen.getByRole("menuitem", { name: "重命名" }));
  await user.clear(screen.getByLabelText("重命名场景"));
  await user.keyboard("{Escape}");
  expect(screen.queryByLabelText("重命名场景")).toBeNull();
  expect(
    screen.getByRole("button", { name: "更多操作 新天台" }),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "更多操作 新天台" }));
  await user.click(screen.getByRole("menuitem", { name: "重命名" }));
  await user.clear(screen.getByLabelText("重命名场景"));
  await user.click(screen.getByLabelText("搜索场景和 CG"));
  expect(screen.getByRole("status")).toHaveTextContent("名称不能为空");

  await user.click(screen.getByRole("button", { name: "更多操作 新天台" }));
  await user.click(screen.getByRole("menuitem", { name: "移动到 郊区" }));
  await waitFor(
    () => {
      const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
      expect(
        saved?.scenes?.find((scene) => scene.id === "scene-roof")?.groupId,
      ).toBe("group-suburb");
    },
    { timeout: 2000 },
  );

  await user.click(screen.getByRole("button", { name: "更多操作 大厅" }));
  expect(screen.getByRole("menuitem", { name: "删除场景" })).toBeDisabled();
  await user.click(screen.getByRole("menuitem", { name: "复制场景" }));
  await waitFor(
    () => {
      const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
      const source = saved?.scenes?.find((scene) => scene.id === "scene-hall");
      const copy = saved?.scenes?.find((scene) => scene.name === "大厅 副本");
      expect(copy?.id).not.toBe(source?.id);
      expect(copy?.layers?.[0]?.id).not.toBe(source?.layers?.[0]?.id);
    },
    { timeout: 2000 },
  );
  expect(screen.getByLabelText("场景名称")).toHaveValue("大厅 副本");

  await user.click(screen.getByRole("button", { name: "更多操作 雨夜 CG" }));
  const cgMenu = screen.getByRole("menu", { name: "雨夜 CG 操作" });
  expect(
    within(cgMenu).queryByRole("menuitem", { name: "移出分组" }),
  ).not.toBeInTheDocument();
  expect(
    within(cgMenu).getByRole("menuitem", { name: "删除 CG" }),
  ).toBeDisabled();
  await user.click(within(cgMenu).getByRole("menuitem", { name: "复制 CG" }));
  await waitFor(
    () => {
      const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
      const source = saved?.cgs?.find((cg) => cg.id === "cg-rain");
      const copy = saved?.cgs?.find((cg) => cg.name === "雨夜 CG 副本");
      expect(copy?.id).not.toBe(source?.id);
      expect(copy?.variants?.[0]?.id).not.toBe(source?.variants?.[0]?.id);
      expect(copy?.defaultVariantId).toBe(copy?.variants?.[0]?.id);
    },
    { timeout: 2000 },
  );

  await user.click(
    screen.getByRole("button", { name: "更多操作 雨夜 CG 副本" }),
  );
  await user.click(screen.getByRole("menuitem", { name: "删除 CG" }));
  await waitFor(
    () =>
      expect(
        vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1].cgs,
      ).toHaveLength(1),
    { timeout: 2000 },
  );
  expect(screen.getByLabelText("CG 名称")).toHaveValue("雨夜 CG");
  expect(screen.queryByText("复制当前项")).not.toBeInTheDocument();
});

test("uploads video from the asset overview and inserts a selectable Video Block", async () => {
  const user = userEvent.setup();
  vi.mocked(uploadGalgameProjectAsset).mockResolvedValueOnce({
    id: "file-video",
    display_name: "opening.webm",
    media_kind: "video",
    mime_type: "video/webm",
    byte_size: 512,
    revision: 0,
    created_at: "2026-08-09T08:00:00Z",
    updated_at: "2026-08-09T08:00:00Z",
  });
  const { container } = renderEditor();
  await screen.findByText("纵向切片");
  await user.click(screen.getByRole("button", { name: "资产" }));
  await user.click(screen.getByRole("button", { name: "视频素材" }));
  await user.click(screen.getByRole("button", { name: "上传视频" }));
  const input = container.querySelector<HTMLInputElement>(
    'input[accept*="video/webm"]',
  )!;
  await user.upload(
    input,
    new File(["video"], "opening.webm", { type: "video/webm" }),
  );
  await waitFor(() => {
    const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
    expect(saved?.assets?.[0]).toMatchObject({
      type: "video",
      role: "video",
      fileId: "file-video",
    });
  });

  await user.click(screen.getByRole("button", { name: "剧本" }));
  await user.click(screen.getByRole("button", { name: "在这里插入 Block" }));
  await user.click(screen.getByRole("button", { name: "视频" }));
  await waitFor(() => {
    const block = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
      .chapters?.[0].fragments?.[0].blocks?.[0];
    expect(block).toMatchObject({
      type: "video",
      assetId: expect.any(String),
      waitForCompletion: true,
    });
  });
  expect(screen.getByLabelText("视频素材")).toHaveTextContent("opening");
});

test("blocks deletion of characters and scenes that are still referenced", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      characters: [{ id: "character-one", name: "调查员", description: "" }],
      scenes: [{ id: "scene-one", name: "研究所", description: "" }],
      chapters: [
        {
          ...story.document.chapters[0],
          fragments: [
            {
              id: "main",
              title: "main",
              blocks: [
                { id: "scene-block", type: "scene", sceneId: "scene-one" },
                {
                  id: "dialogue-block",
                  type: "dialogue",
                  characterId: "character-one",
                  text: "别删掉我。",
                },
              ],
            },
          ],
        },
      ],
    },
  });
  renderEditor();
  await screen.findByText("纵向切片");

  await openAssetSection(user, "角色");
  expect(screen.getByRole("button", { name: "删除角色" })).toBeDisabled();
  expect(screen.getByText("角色仍被对白引用，无法删除。")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /资源引用 1/ }));
  await user.click(
    screen.getByRole("button", {
      name: /第一章 · main · Block 2/,
    }),
  );
  expect(screen.getByLabelText("对白正文")).toHaveValue("别删掉我。");

  await openAssetSection(user, "场景");
  expect(screen.getByRole("button", { name: "删除场景" })).toBeDisabled();
  expect(
    screen.getByText("场景仍被 Scene Block 引用，无法删除。"),
  ).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: /第一章 · main · Block 1/ }),
  );
  expect(screen.getByLabelText("切换场景")).toHaveTextContent("研究所");
  expect(putGalgameStoryDocument).not.toHaveBeenCalled();
});

test("edits independent two-dimensional character position presets", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      settings: {
        canvas: { width: 1920, height: 1080 },
        characterStage: {
          anchor: "center",
          defaultPositionId: "position-center",
          defaultHeightPercent: 100,
          positionPresets: [
            {
              id: "position-left",
              name: "左",
              x: 10,
              y: 50,
              builtinKey: "left",
            },
            {
              id: "position-center-left",
              name: "中左",
              x: 30,
              y: 50,
              builtinKey: "centerLeft",
            },
            {
              id: "position-center",
              name: "中",
              x: 50,
              y: 50,
              builtinKey: "center",
            },
            {
              id: "position-center-right",
              name: "中右",
              x: 60,
              y: 50,
              builtinKey: "centerRight",
            },
            {
              id: "position-right",
              name: "右",
              x: 90,
              y: 50,
              builtinKey: "right",
            },
          ],
        },
      },
      characters: [
        {
          id: "character-one",
          name: "调查员",
          description: "",
          expressions: [],
          defaultExpressionId: null,
        },
      ],
    },
  });
  const { container } = renderEditor();
  await screen.findByText("纵向切片");
  await openAssetSection(user, "角色");

  expect(screen.getByText("1 项")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "位置与锚点" }));
  const stage = screen.getByRole("application", {
    name: "角色位置与锚点可视化编辑器",
  });
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 100,
    top: 100,
    right: 500,
    bottom: 300,
    left: 100,
    width: 400,
    height: 200,
    toJSON: () => ({}),
  });
  fireEvent.pointerDown(stage, {
    button: 0,
    buttons: 1,
    clientX: 260,
    clientY: 180,
    pointerId: 7,
    pointerType: "mouse",
  });
  fireEvent.pointerMove(stage, {
    buttons: 0,
    clientX: 280,
    clientY: 220,
    pointerId: 7,
    pointerType: "mouse",
  });
  fireEvent.pointerUp(stage, {
    button: 0,
    clientX: 280,
    clientY: 220,
    pointerId: 7,
    pointerType: "mouse",
  });

  await waitFor(
    () => {
      const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
      const center = saved?.settings?.characterStage?.positionPresets?.find(
        (preset) => preset.id === "position-center",
      );
      expect(center).toMatchObject({ x: 45, y: 60 });
    },
    { timeout: 2000 },
  );
  await waitFor(() => {
    const previewSprite = container.querySelector<HTMLElement>(
      ".galgame-character-preview-actor",
    );
    expect(previewSprite).toHaveStyle({ left: "45%", top: "60%" });
  });

  const center = screen.getByRole("spinbutton", { name: "中站位 X" });
  fireEvent.change(center, { target: { value: "99" } });

  await waitFor(
    () => {
      const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
      expect(
        saved?.settings?.characterStage?.positionPresets?.find(
          (preset) => preset.id === "position-center",
        )?.x,
      ).toBe(99);
    },
    { timeout: 2000 },
  );

  await user.click(screen.getByRole("button", { name: "左上" }));
  await waitFor(() => {
    const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
    expect(saved?.settings?.characterStage?.anchor).toBe("topLeft");
  });

  await user.click(screen.getByRole("button", { name: "新增" }));
  await user.type(screen.getByLabelText("新增位置预设名称"), "近景");
  await user.keyboard("{Enter}");
  const customPosition = screen.getByRole("button", { name: /近景 50，50/ });
  expect(customPosition).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "删除位置预设" })).toBeEnabled();

  await user.click(customPosition);
  await user.keyboard("{F2}");
  const presetName = screen.getByLabelText("位置预设名称");
  await user.clear(presetName);
  await user.type(presetName, "近景改名{Enter}");
  expect(
    screen.getByRole("button", { name: /近景改名 50，50/ }),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /默认位置/ }));
  await user.click(screen.getByRole("button", { name: "删除位置预设" }));
  expect(
    screen.queryByRole("button", { name: /近景改名/ }),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "默认尺寸" }));
  const height = screen.getByRole("spinbutton", {
    name: "默认画面高度",
  });
  fireEvent.change(height, { target: { value: "450" } });
  await waitFor(
    () => {
      const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
      expect(saved?.settings?.characterStage?.defaultHeightPercent).toBe(400);
    },
    { timeout: 2000 },
  );
}, 10_000);

test("shows the selected portrait's real stage footprint for each anchor", async () => {
  const user = userEvent.setup();
  const portraitStory = structuredClone(story) as GalgameStoryDocument;
  portraitStory.document.assets = [
    {
      id: "portrait-default",
      type: "image",
      role: "characterPortrait",
      fileId: "file-portrait",
      status: "ready",
    },
  ];
  portraitStory.document.characters = [
    {
      id: "character-one",
      name: "调查员",
      description: "",
      expressions: [
        {
          id: "expression-default",
          label: "默认",
          assetId: "portrait-default",
          heightPercent: 80,
        },
      ],
      defaultExpressionId: "expression-default",
    },
  ];
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce(portraitStory);
  vi.mocked(getGalgameProjectAssets).mockResolvedValue({
    items: [
      {
        id: "file-portrait",
        display_name: "portrait.png",
        media_kind: "image",
        mime_type: "image/png",
        byte_size: 1024,
        revision: 0,
        created_at: "2026-08-10T00:00:00Z",
        updated_at: "2026-08-10T00:00:00Z",
        width: 400,
        height: 800,
      } as GalgameProjectAsset,
    ],
  });

  const { container } = renderEditor();
  await screen.findByText("纵向切片");
  await openAssetSection(user, "角色");
  await user.click(screen.getByRole("button", { name: "位置与锚点" }));

  await waitFor(() => {
    const footprint = container.querySelector<HTMLElement>(
      ".galgame-character-position-footprint",
    );
    expect(footprint).toHaveClass("is-center");
    expect(footprint).toHaveStyle({ width: "22.5%", height: "80%" });
    expect(footprint).toHaveAttribute(
      "title",
      "原图 400 × 800px · 表情高度 80%",
    );
  });

  const preview = container.querySelector<HTMLElement>(
    ".galgame-character-preview-actor",
  );
  expect(preview).toHaveStyle({
    width: "22.5%",
    height: "80%",
    transform: "translate(-50%, -50%)",
  });

  await user.click(screen.getByRole("button", { name: "左上" }));
  expect(
    container.querySelector(".galgame-character-position-footprint"),
  ).toHaveClass("is-topLeft");
  expect(preview).toHaveStyle({ transform: "translate(0, 0)" });
});

test("separates character attribute templates, values, preview, and resource references", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      characterAttributeTemplates: [],
      characters: [
        {
          id: "character-one",
          name: "调查员",
          description: "",
          expressions: [],
          defaultExpressionId: null,
          attributes: {},
        },
      ],
      chapters: [
        {
          ...story.document.chapters[0],
          fragments: [
            {
              id: "main",
              title: "main",
              blocks: [
                {
                  id: "dialogue-block",
                  type: "dialogue",
                  characterId: "character-one",
                  text: "保持警惕。",
                },
                {
                  id: "show-block",
                  type: "showCharacter",
                  characterId: "character-one",
                  expressionId: null,
                },
              ],
            },
          ],
        },
      ],
    },
  });
  renderEditor();
  await screen.findByText("纵向切片");
  await openAssetSection(user, "角色");

  await user.click(screen.getByRole("button", { name: "属性模板" }));
  await user.click(screen.getByRole("button", { name: "新增属性" }));
  await waitFor(
    () => {
      const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
      expect(saved?.characterAttributeTemplates).toHaveLength(1);
      const id = saved?.characterAttributeTemplates?.[0].id;
      expect(saved?.characters?.[0].attributes?.[id!]).toBe("");
    },
    { timeout: 2000 },
  );

  await user.click(
    screen.getByRole("button", { name: /调查员 0 个表情 · 2 处引用/ }),
  );
  await user.click(screen.getByRole("button", { name: /角色属性/ }));
  expect(screen.getByRole("textbox", { name: "属性 1值" })).toBeVisible();

  await user.click(screen.getByRole("button", { name: /资源引用 2/ }));
  expect(screen.getByText("保持警惕。")).toBeVisible();
  expect(screen.getByText("角色登场 / 调整")).toBeVisible();
  expect(screen.getByRole("button", { name: "删除角色" })).toBeDisabled();
});

test("opens selected characters with a blank expression detail and compact role tabs", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      characterAttributeTemplates: [
        {
          id: "affection",
          name: "好感度",
          type: "number",
          defaultValue: 0,
          description: "当前好感度",
        },
      ],
      assets: [
        {
          id: "portrait-default",
          type: "image",
          role: "characterPortrait",
          fileId: "file-default",
          status: "ready",
        },
        {
          id: "portrait-alt",
          type: "image",
          role: "characterPortrait",
          fileId: "file-alt",
          status: "ready",
        },
      ],
      characters: [
        {
          id: "character-one",
          name: "调查员",
          description: "负责现场调查。",
          expressions: [
            {
              id: "expression-default",
              label: "平静",
              assetId: "portrait-default",
            },
            {
              id: "expression-alt",
              label: "惊讶",
              assetId: "portrait-alt",
            },
          ],
          defaultExpressionId: "expression-default",
          dialogueAvatar: { enabled: false },
          attributes: { affection: 4 },
        },
      ],
    },
  });
  const rendered = renderEditor();
  await screen.findByText("纵向切片");
  await openAssetSection(user, "角色");

  expect(screen.getByText("选择一个表情查看详情")).toBeVisible();
  expect(
    rendered.container.querySelector(
      '.galgame-character-preview-stage [data-file-id="file-default"]',
    ),
  ).toBeInTheDocument();
  expect(screen.queryByDisplayValue("平静")).not.toBeInTheDocument();

  await user.click(screen.getByRole("checkbox", { name: "对白头像" }));
  await waitFor(() => {
    const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
    expect(saved?.characters?.[0].dialogueAvatar?.enabled).toBe(true);
  });

  await user.click(screen.getByRole("button", { name: /惊讶$/ }));
  expect(screen.getByDisplayValue("惊讶")).toBeVisible();
  expect(
    rendered.container.querySelector(
      '.galgame-character-preview-stage [data-file-id="file-default"]',
    ),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /立绘皮肤/ }));
  expect(screen.getByText("让立绘在不同外观之间切换")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "添加皮肤" }));
  expect(screen.getByRole("textbox", { name: "皮肤名称" })).toHaveValue(
    "皮肤 1",
  );

  await user.click(screen.getByRole("button", { name: /显示名/ }));
  expect(screen.getByRole("button", { name: /主名称 调查员/ })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "别名" }));
  expect(screen.getByLabelText("显示名方案名称")).toHaveValue("别名 1");

  await user.click(screen.getByRole("button", { name: /角色属性/ }));
  const attributeInput = screen.getByRole("spinbutton", {
    name: "好感度值",
  });
  expect(attributeInput).toHaveValue(4);
  await user.click(
    within(attributeInput.closest("div")!).getByRole("button", {
      name: "清除",
    }),
  );
  await waitFor(() => {
    const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
    expect(saved?.characters?.[0].attributes).not.toHaveProperty("affection");
  });
  expect(attributeInput).toHaveValue(0);

  fireEvent.change(attributeInput, { target: { value: "9" } });
  await user.click(screen.getByRole("button", { name: "恢复默认" }));
  await waitFor(() => {
    const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
    expect(saved?.characters?.[0].attributes?.affection).toBe(0);
  });
});

test("can load the server snapshot after preserving a conflicted local draft", async () => {
  const user = userEvent.setup();
  const serverStory = {
    ...story,
    revision: 3,
    document: { ...story.document, synopsis: "服务器版本" },
  };
  vi.mocked(putGalgameStoryDocument).mockRejectedValueOnce(
    new ApiError(
      "冲突",
      {
        code: "revision_conflict",
        current: serverStory,
      },
      409,
    ),
  );
  renderEditor();
  await screen.findByText("纵向切片");
  await openAssetSection(user, "角色");
  await user.click(screen.getByRole("button", { name: "新建角色" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("本地草稿仍保留");
  expect(
    screen.getByRole("button", { name: "载入服务器版本" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "用本地版本覆盖" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "载入服务器版本" }));
  await user.click(screen.getByRole("button", { name: "剧本" }));
  expect(screen.getByLabelText("故事简介")).toHaveValue("服务器版本");
});

test("requires confirmation before overwriting a conflicted server story", async () => {
  const user = userEvent.setup();
  vi.mocked(putGalgameStoryDocument).mockRejectedValueOnce(
    new ApiError(
      "冲突",
      {
        code: "revision_conflict",
        current: { ...story, revision: 3 },
      },
      409,
    ),
  );
  renderEditor();
  await screen.findByText("纵向切片");
  await openAssetSection(user, "角色");
  await user.click(screen.getByRole("button", { name: "新建角色" }));
  await screen.findByText("本地草稿仍保留，请选择要使用的版本。");

  await user.click(screen.getByRole("button", { name: "用本地版本覆盖" }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent(
    "服务器上的故事内容将被替换",
  );
  await user.click(screen.getByRole("button", { name: "确认覆盖" }));
  await waitFor(() =>
    expect(putGalgameStoryDocument).toHaveBeenLastCalledWith(
      "project-1",
      expect.objectContaining({
        characters: [expect.objectContaining({ name: "新角色" })],
      }),
      3,
    ),
  );
});

test("uses Block cards by default and keeps ordinary insertion untimed", async () => {
  const user = userEvent.setup();
  renderEditor();

  expect(
    await screen.findByRole("region", { name: "Block 卡片编辑器" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "卡片" })).toHaveClass("active");
  expect(localStorage.getItem("future_props_galgame_editor_script_view")).toBe(
    "blocks",
  );
  const insertion = screen.getByRole("button", {
    name: "在这里插入 Block",
  });
  fireEvent.keyDown(insertion, { key: "Tab" });
  expect(insertion.closest("details")).toHaveAttribute("open");
  await user.click(screen.getByRole("button", { name: "旁白" }));

  expect((await screen.findAllByLabelText("旁白正文")).length).toBeGreaterThan(
    1,
  );
  await waitFor(
    () => {
      const fragment = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
        .chapters?.[0]?.fragments?.[0];
      expect(fragment?.timeline).toBeUndefined();
      expect(fragment?.blocks?.[0]).toMatchObject({
        type: "narration",
        text: "",
      });
      expect(fragment?.blocks?.[0]).not.toHaveProperty("startMs");
    },
    { timeout: 2000 },
  );

  const saveCount = vi.mocked(putGalgameStoryDocument).mock.calls.length;
  await user.click(screen.getByRole("button", { name: "演出" }));
  expect(
    await screen.findByRole("region", { name: "多轨剧情时间轴" }),
  ).toBeInTheDocument();
  expect(localStorage.getItem("future_props_galgame_editor_script_view")).toBe(
    "performance",
  );
  expect(screen.getByText(/估算时间 · 编辑后保存/)).toBeInTheDocument();
  expect(putGalgameStoryDocument).toHaveBeenCalledTimes(saveCount);
});

test("continues same-speaker dialogue with Enter and exits an empty row", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      characters: [{ id: "hero", name: "白羽", description: "" }],
      chapters: [
        {
          ...story.document.chapters[0],
          fragments: [
            {
              id: "main",
              title: "连续对白",
              blocks: [
                {
                  id: "line-one",
                  type: "dialogue",
                  characterId: "hero",
                  text: "第一句",
                  voiceVolume: 100,
                },
              ],
            },
          ],
        },
      ],
    },
  });
  const { container } = renderEditor();

  await screen.findAllByText("第一句");
  fireEvent.doubleClick(
    container.querySelector<HTMLElement>(".galgame-dialogue-content-line > b")!,
  );
  const first = await screen.findByLabelText("白羽 对白正文");
  fireEvent.keyDown(first, { key: "Enter" });
  await waitFor(() =>
    expect(screen.getAllByLabelText("白羽 对白正文")).toHaveLength(1),
  );
  const second = screen.getByLabelText("白羽 对白正文");
  expect(second).toHaveFocus();
  await user.type(second, "第二句");
  fireEvent.keyDown(second, { key: "Enter", shiftKey: true });
  expect(screen.getAllByLabelText("白羽 对白正文")).toHaveLength(1);
  fireEvent.keyDown(second, { key: "Enter" });
  const empty = await screen.findByLabelText("白羽 对白正文");
  fireEvent.keyDown(empty, { key: "Enter" });
  await waitFor(() =>
    expect(screen.queryByLabelText("白羽 对白正文")).not.toBeInTheDocument(),
  );
  expect(container.querySelectorAll(".galgame-dialogue-summary")).toHaveLength(
    1,
  );
  expect(
    container.querySelectorAll(".galgame-dialogue-group-dot"),
  ).toHaveLength(1);
  await waitFor(() =>
    expect(
      screen.getAllByRole("button", { name: "在这里插入 Block" }).at(-1),
    ).toHaveFocus(),
  );

  await waitFor(
    () => {
      const fragment = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
        .chapters?.[0]?.fragments?.[0];
      expect(fragment?.timeline).toBeUndefined();
      expect(
        fragment?.blocks?.map((block) =>
          block.type === "dialogue" ? block.text : block.type,
        ),
      ).toEqual(["第一句", "第二句"]);
    },
    { timeout: 2000 },
  );
});

test("edits common dialogue presentation fields in the inspector", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      characters: [
        {
          id: "hero",
          name: "白羽",
          description: "",
          expressions: [{ id: "smile", label: "微笑", assetId: "portrait" }],
          defaultExpressionId: null,
        },
      ],
      assets: [
        {
          id: "voice-line",
          type: "audio",
          role: "voiceLine",
          label: "第一句配音",
          fileId: "voice-file",
          status: "ready",
        },
      ],
      chapters: [
        {
          ...story.document.chapters[0],
          fragments: [
            {
              id: "main",
              title: "卡片快捷编辑",
              blocks: [
                {
                  id: "line",
                  type: "dialogue",
                  characterId: "hero",
                  text: "第一句",
                  voiceVolume: 100,
                  portrait: {
                    mode: "stage",
                    keepAfter: true,
                    transform: null,
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  });
  renderEditor();

  await screen.findByLabelText("对白正文");
  await user.click(screen.getByLabelText("对白表情"));
  await user.click(
    screen
      .getAllByRole("option", { name: "微笑" })
      .find((option) => option.tagName === "BUTTON")!,
  );
  await user.click(screen.getByLabelText("显示立绘或对白头像"));

  await waitFor(
    () => {
      const block = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
        .chapters?.[0]?.fragments?.[0]?.blocks?.[0];
      expect(block).toMatchObject({
        type: "dialogue",
        expressionId: "smile",
        portrait: { mode: "stage", visible: false, keepAfter: true },
      });
    },
    { timeout: 2000 },
  );
});

test("edits the selected Block in the inspector and starts the embedded player", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      chapters: [
        {
          ...story.document.chapters[0],
          fragments: [
            {
              id: "main",
              title: "main",
              blocks: [
                { id: "narration-one", type: "narration", text: "旧旁白" },
                {
                  id: "ending-one",
                  type: "endChapter",
                  endingId: "ending-one",
                  label: "测试结局",
                },
              ],
            },
          ],
        },
      ],
    },
  });
  localStorage.setItem(
    "future_props_galgame_editor_script_view",
    "performance",
  );
  renderEditor();

  await user.click(
    await screen.findByRole("button", { name: /旁白 00:00\.000/ }),
  );
  expect(await screen.findByLabelText("旁白正文")).toHaveValue("旧旁白");
  await user.clear(screen.getByLabelText("旁白正文"));
  await user.type(screen.getByLabelText("旁白正文"), "右侧属性已更新");
  await waitFor(
    () =>
      expect(
        vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1].chapters?.[0]
          ?.fragments?.[0]?.blocks?.[0],
      ).toEqual(
        expect.objectContaining({ type: "narration", text: "右侧属性已更新" }),
      ),
    { timeout: 2000 },
  );
  await waitFor(
    () =>
      expect(
        vi.mocked(getGalgameStoryReport).mock.calls.length,
      ).toBeGreaterThan(1),
    { timeout: 2000 },
  );

  const editTimelineAudio = EditorMockAudio.instances[0]!;
  await user.click(screen.getByRole("button", { name: "播放编辑时间轴" }));
  expect(
    screen.getByRole("button", { name: "暂停编辑时间轴" }),
  ).toBeInTheDocument();
  await user.click(screen.getAllByRole("button", { name: /^开始试玩$/ })[0]!);
  expect(screen.getByLabelText("预览模式")).toContainElement(
    screen.getByRole("button", { name: "试玩" }),
  );
  expect(screen.getByText("跟随试玩")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "播放编辑时间轴" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("波纹编辑")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("精确设置")).not.toBeInTheDocument();
  expect(editTimelineAudio.pause).toHaveBeenCalled();
  const player = screen.getByRole("region", { name: "游戏预览" });
  expect(await within(player).findByLabelText("试玩控制")).toBeInTheDocument();
  expect(within(player).getByLabelText("推进模式")).toBeInTheDocument();
  expect(
    within(player).queryByLabelText("剧情时间轴进度"),
  ).not.toBeInTheDocument();
  expect(await within(player).findByText("右侧属性已更新")).toBeInTheDocument();
});

test("opens the visual timeline and edits precise cue timing", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      assets: [
        {
          id: "timeline-bgm",
          type: "audio",
          role: "backgroundMusic",
          label: "完整广播剧",
          fileId: "file-timeline",
          status: "ready",
        },
      ],
      chapters: [
        {
          ...story.document.chapters[0],
          fragments: [
            {
              id: "main",
              title: "完整时间轴",
              timeline: { durationMs: 105_000 },
              blocks: [
                {
                  id: "timed-narration",
                  type: "narration",
                  text: "旧时间轴旁白",
                  startMs: 12_300,
                  endMs: 18_900,
                },
                {
                  id: "timeline-bgm",
                  type: "audio",
                  atMs: 0,
                  action: "play",
                  channel: "bgm",
                  assetId: "timeline-bgm",
                  volume: 100,
                  loop: false,
                  fadeMs: 0,
                },
                {
                  id: "timeline-ending",
                  type: "endChapter",
                  endingId: "timeline-ending",
                  label: "完成",
                },
              ],
            },
          ],
        },
      ],
    },
  });
  localStorage.setItem(
    "future_props_galgame_editor_script_view",
    "performance",
  );
  renderEditor();

  expect(
    await screen.findByRole("region", { name: "多轨剧情时间轴" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /旁白 00:12\.300/ }));
  expect(screen.getByLabelText("对白开始时间")).toHaveValue("00:12.300");
  expect(screen.getByLabelText("对白结束时间")).toHaveValue("00:18.900");
  expect(
    screen.getByRole("button", { name: /旁白 00:12\.300/ }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("时间轴轨道")).toHaveTextContent("BGM");
  expect(
    screen.getByRole("button", { name: /完整广播剧/ }),
  ).toBeInTheDocument();
  await user.click(screen.getByLabelText("精确设置"));
  expect(screen.queryByText("校准音轨长度")).not.toBeInTheDocument();
  expect(screen.getByLabelText("时间轴缩放")).toHaveValue("300");
  expect(
    screen.getByRole("button", { name: "在播放头添加内容" }),
  ).toHaveTextContent("00:12.300");
  const playTimeline = screen.getByRole("button", {
    name: "播放编辑时间轴",
  });
  await waitFor(() => expect(playTimeline).toBeEnabled());
  await user.click(playTimeline);
  expect(EditorMockAudio.instances[0]?.src).toMatch(/^blob:/);
  expect(EditorMockAudio.instances[0]?.play).toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "暂停编辑时间轴" }));

  const playhead = screen.getByRole("slider", { name: "时间轴播放头" });
  const timeArea = playhead.closest(".galgame-timeline-time-area");
  expect(timeArea).not.toBeNull();
  vi.spyOn(timeArea!, "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 0,
    top: 0,
    right: 1100,
    bottom: 400,
    left: 100,
    width: 1000,
    height: 400,
    toJSON: () => ({}),
  });
  fireEvent.pointerDown(playhead, { button: 0, clientX: 100, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 600, pointerId: 1 });
  fireEvent.pointerUp(window, { clientX: 600, pointerId: 1 });
  expect(playhead).toHaveAttribute("aria-valuenow", "52500");
  expect(
    screen.getByRole("button", { name: "在播放头添加内容" }),
  ).toHaveTextContent("00:52.500");

  fireEvent.keyDown(playhead, { key: "ArrowRight" });
  expect(playhead).toHaveAttribute("aria-valuenow", "52600");

  const start = screen.getByLabelText("对白开始时间");
  await user.clear(start);
  await user.type(start, "00:13.000{enter}");
  const editor = screen.getByLabelText("旁白正文");
  await user.clear(editor);
  await user.type(editor, "修改后的时间轴旁白");

  await waitFor(
    () => {
      const block = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
        .chapters?.[0]?.fragments?.[0]?.blocks?.[0];
      expect(block).toMatchObject({
        text: "修改后的时间轴旁白",
        startMs: 13_000,
        endMs: 18_900,
      });
    },
    { timeout: 2000 },
  );
});

test("projects an untimed Fragment and materializes it on the first timing edit", async () => {
  const user = userEvent.setup();
  localStorage.setItem(
    "future_props_galgame_editor_script_view",
    "performance",
  );
  renderEditor();
  await screen.findByText("纵向切片");

  expect(
    screen.getByRole("region", { name: "多轨剧情时间轴" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/估算时间 · 编辑后保存/)).toBeInTheDocument();
  expect(screen.getByLabelText("时间轴轨道")).not.toHaveTextContent("校准音轨");
  await user.click(screen.getByLabelText("精确设置"));
  expect(screen.queryByText("校准音轨长度")).not.toBeInTheDocument();
  await user.click(screen.getByLabelText("精确设置"));
  const addMenu = screen.getByRole("button", { name: "在播放头添加内容" });
  expect(addMenu).toHaveTextContent("00:00.000");
  expect(putGalgameStoryDocument).not.toHaveBeenCalled();
  await user.click(addMenu);
  await user.click(screen.getByRole("button", { name: "旁白" }));
  await waitFor(
    () => {
      const fragment = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
        .chapters?.[0]?.fragments?.[0];
      expect(fragment?.timeline?.durationMs).toBeGreaterThanOrEqual(2000);
      expect(fragment?.timeline).not.toHaveProperty("assetId");
    },
    { timeout: 2000 },
  );
});

test("keeps a timeline without BGM editable and silent", async () => {
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      chapters: [
        {
          ...story.document.chapters[0],
          fragments: [
            {
              id: "main",
              title: "无 BGM 时间轴",
              timeline: { durationMs: 5000 },
              blocks: [
                {
                  id: "line",
                  type: "narration",
                  text: "仍可编辑剧情",
                  startMs: 0,
                  endMs: 3000,
                },
              ],
            },
          ],
        },
      ],
    },
  });
  localStorage.setItem(
    "future_props_galgame_editor_script_view",
    "performance",
  );
  renderEditor();

  const trackLabels = await screen.findByLabelText("时间轴轨道");
  expect(trackLabels).toHaveTextContent("BGM");
  expect(trackLabels).not.toHaveTextContent("校准音轨");
  expect(screen.queryByText(/BGM 无法读取/)).not.toBeInTheDocument();
});

test("uses direct timeline selection and restores the current Block", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      chapters: [
        {
          ...story.document.chapters[0],
          fragments: [
            {
              id: "main",
              title: "直接时间轴",
              timeline: { durationMs: 7000 },
              blocks: [
                {
                  id: "line-a",
                  type: "narration",
                  text: "第一拍",
                  startMs: 0,
                  endMs: 2000,
                },
                {
                  id: "line-b",
                  type: "narration",
                  text: "第二拍",
                  startMs: 2500,
                  endMs: 5000,
                },
                {
                  id: "ending",
                  type: "endChapter",
                  endingId: "end",
                  label: "结束",
                },
              ],
            },
          ],
        },
      ],
    },
  });
  localStorage.setItem(
    "future_props_galgame_editor_script_view",
    "performance",
  );
  renderEditor();

  const timeline = await screen.findByRole("region", {
    name: "多轨剧情时间轴",
  });
  expect(screen.queryByText("选择时间轴内容项以编辑")).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "旁白正文" })).toHaveValue(
    "第一拍",
  );
  expect(screen.getByLabelText("时间轴轨道")).not.toHaveTextContent("剧情段");
  expect(within(timeline).queryByLabelText("剧情段选择带")).toBeNull();
  expect(
    within(timeline).queryByRole("button", { name: "选择全部剧情段" }),
  ).toBeNull();
  expect(
    screen.getByRole("separator", { name: "调整舞台与剧情时间轴高度" }),
  ).toBeInTheDocument();

  await user.click(
    within(timeline).getByRole("button", {
      name: "旁白 00:00.000 到 00:02.000",
    }),
  );
  expect(screen.getByRole("textbox", { name: "旁白正文" })).toHaveValue(
    "第一拍",
  );
  expect(screen.queryByText("选择时间轴内容项以编辑")).toBeNull();
});

test("fits a long timeline into the visible time area", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      chapters: [
        {
          ...story.document.chapters[0],
          fragments: [
            {
              id: "main",
              title: "长剧情",
              timeline: { durationMs: 1_200_000 },
              blocks: [
                {
                  id: "long-line",
                  type: "narration",
                  text: "长剧情开场",
                  startMs: 0,
                  endMs: 2_000,
                },
              ],
            },
          ],
        },
      ],
    },
  });
  localStorage.setItem(
    "future_props_galgame_editor_script_view",
    "performance",
  );
  const { container } = renderEditor();

  await screen.findByRole("region", { name: "多轨剧情时间轴" });
  const scroll = container.querySelector(".galgame-timeline-scroll");
  expect(scroll).not.toBeNull();
  Object.defineProperty(scroll, "clientWidth", {
    configurable: true,
    value: 1200,
  });

  await user.click(screen.getByRole("button", { name: "适配时间轴宽度" }));
  expect(screen.getByLabelText("时间轴缩放")).toHaveValue("51");
});

test("keeps character events on the dialogue lane until performance details open", async () => {
  const user = userEvent.setup();
  const transform = {
    x: 50,
    y: 100,
    anchor: "bottomCenter" as const,
    scale: 1,
    brightness: 1,
    opacity: 1,
    flipX: false,
    layer: 10,
  };
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      characters: [
        { id: "hero", name: "调查员", description: "" },
        { id: "partner", name: "助手", description: "" },
      ],
      chapters: [
        {
          ...story.document.chapters[0],
          fragments: [
            {
              id: "main",
              title: "角色轨道显示",
              timeline: { durationMs: 5000 },
              blocks: [
                {
                  id: "line",
                  type: "narration",
                  text: "两人同时在场",
                  startMs: 0,
                  endMs: 3000,
                },
                {
                  id: "show-hero",
                  type: "showCharacter",
                  characterId: "hero",
                  expressionId: null,
                  transform,
                  transition: { durationMs: 240, fade: true },
                  atMs: 0,
                },
                {
                  id: "show-partner",
                  type: "showCharacter",
                  characterId: "partner",
                  expressionId: null,
                  transform: { ...transform, x: 70 },
                  transition: { durationMs: 240, fade: true },
                  atMs: 1000,
                },
              ],
            },
          ],
        },
      ],
    },
  });
  localStorage.setItem(
    "future_props_galgame_editor_script_view",
    "performance",
  );
  renderEditor();

  const trackLabels = await screen.findByLabelText("时间轴轨道");
  expect(
    within(trackLabels).getByText("对白 / 角色 / 配音"),
  ).toBeInTheDocument();
  expect(within(trackLabels).queryByText("调查员")).not.toBeInTheDocument();
  expect(within(trackLabels).queryByText("助手")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "登场 · 调查员 00:00.000" }),
  ).toHaveAttribute("title", expect.stringContaining("独立演出"));
  expect(
    screen.getByRole("button", { name: "登场 · 助手 00:01.000" }),
  ).toBeInTheDocument();

  const performanceDetails = screen.getByRole("checkbox", {
    name: "演出细节",
  });
  expect(performanceDetails).not.toBeChecked();
  await user.click(performanceDetails);
  expect(within(trackLabels).getByText("调查员")).toBeInTheDocument();
  expect(within(trackLabels).getByText("助手")).toBeInTheDocument();

  await user.click(screen.getByLabelText("精确设置"));
  await user.click(screen.getByText("逐角色轨道 2/2"));
  const visibility = screen.getByLabelText("逐角色轨道显示设置");
  await user.click(
    within(visibility).getByRole("checkbox", { name: "调查员" }),
  );
  expect(within(trackLabels).queryByText("调查员")).not.toBeInTheDocument();
  expect(within(trackLabels).getByText("助手")).toBeInTheDocument();
  expect(screen.getByText("逐角色轨道 1/2")).toBeInTheDocument();

  await user.click(
    within(visibility).getByRole("button", { name: "全部隐藏" }),
  );
  expect(within(trackLabels).queryByText("助手")).not.toBeInTheDocument();
  expect(screen.getByText("逐角色轨道 0/2")).toBeInTheDocument();

  await user.click(
    within(visibility).getByRole("button", { name: "全部显示" }),
  );
  expect(within(trackLabels).getByText("调查员")).toBeInTheDocument();
  expect(within(trackLabels).getByText("助手")).toBeInTheDocument();
  await user.click(performanceDetails);
  expect(within(trackLabels).queryByText("调查员")).not.toBeInTheDocument();
  expect(within(trackLabels).queryByText("助手")).not.toBeInTheDocument();
  expect(
    JSON.parse(
      localStorage.getItem("future_props_galgame_timeline_preferences")!,
    ),
  ).toMatchObject({ characterTracksExpanded: false });
});

test("shows attached character direction on dialogue and reattaches independent events", async () => {
  const user = userEvent.setup();
  const transform = {
    x: 50,
    y: 100,
    anchor: "bottomCenter" as const,
    scale: 1,
    brightness: 1,
    opacity: 1,
    flipX: false,
    layer: 10,
  };
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      characters: [{ id: "hero", name: "调查员", description: "" }],
      chapters: [
        {
          ...story.document.chapters[0],
          fragments: [
            {
              id: "main",
              title: "角色与对白",
              timeline: { durationMs: 6000 },
              blocks: [
                {
                  id: "show-hero",
                  type: "showCharacter",
                  characterId: "hero",
                  expressionId: null,
                  transform,
                  transition: { durationMs: 240, fade: true },
                },
                {
                  id: "line-one",
                  type: "dialogue",
                  characterId: "hero",
                  text: "第一句",
                  startMs: 0,
                  endMs: 2500,
                  portrait: { mode: "stage", keepAfter: true },
                },
                {
                  id: "remove-hero",
                  type: "removeCharacter",
                  characterId: "hero",
                  all: false,
                  transition: { durationMs: 240, fade: true },
                  atMs: 2800,
                },
                {
                  id: "line-two",
                  type: "dialogue",
                  characterId: "hero",
                  text: "第二句",
                  startMs: 3000,
                  endMs: 5500,
                  portrait: { mode: "stage", keepAfter: true },
                },
              ],
            },
          ],
        },
      ],
    },
  });
  localStorage.setItem(
    "future_props_galgame_editor_script_view",
    "performance",
  );
  renderEditor();

  expect(await screen.findByTitle("登场 · 调查员")).toBeInTheDocument();
  expect(screen.getAllByTitle("待配音 · 舞台·保留")).toHaveLength(2);
  await user.click(
    screen.getByRole("button", { name: "退场 · 调查员 00:02.800" }),
  );

  const timing = await screen.findByLabelText("角色演出时间关系");
  expect(timing).toHaveTextContent("独立时间");
  await user.click(timing);
  await user.click(
    screen.getByRole("option", {
      name: "跟随对白 2 · 调查员：第二句",
    }),
  );

  await waitFor(() => {
    const blocks = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
      .chapters?.[0]?.fragments?.[0]?.blocks;
    const removeIndex = blocks?.findIndex(
      (block) => block.id === "remove-hero",
    );
    expect(removeIndex).toBeGreaterThanOrEqual(0);
    expect(blocks?.[removeIndex!]).not.toHaveProperty("atMs");
    expect(blocks?.[removeIndex! + 1]?.id).toBe("line-two");
  });
});

test("shares ripple editing between the timeline and precise end time", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      characters: [
        { id: "hero", name: "调查员", description: "" },
        { id: "partner", name: "助手", description: "" },
      ],
      assets: [
        {
          id: "timeline-bgm",
          type: "audio",
          role: "backgroundMusic",
          label: "完整广播剧",
          fileId: "file-timeline",
          status: "ready",
        },
      ],
      chapters: [
        {
          ...story.document.chapters[0],
          fragments: [
            {
              id: "main",
              title: "完整时间轴",
              timeline: { durationMs: 12_000 },
              blocks: [
                {
                  id: "line-a",
                  type: "dialogue",
                  characterId: "hero",
                  text: "A 块",
                  startMs: 0,
                  endMs: 3000,
                },
                {
                  id: "line-b",
                  type: "dialogue",
                  characterId: "partner",
                  text: "B 块",
                  startMs: 3000,
                  endMs: 6000,
                },
                {
                  id: "line-c",
                  type: "narration",
                  text: "C 块",
                  startMs: 6000,
                  endMs: 9000,
                },
              ],
            },
          ],
        },
      ],
    },
  });
  localStorage.setItem(
    "future_props_galgame_editor_script_view",
    "performance",
  );
  renderEditor();

  await screen.findByRole("region", { name: "多轨剧情时间轴" });
  await user.click(screen.getByRole("button", { name: /调查员 00:00\.000/ }));
  const ripple = screen.getByRole("checkbox", { name: "波纹编辑" });
  await user.click(ripple);
  expect(ripple).toBeChecked();

  const end = screen.getByRole("textbox", { name: "对白结束时间" });
  await user.clear(end);
  await user.type(end, "00:04.000{enter}");

  await waitFor(
    () => {
      const blocks = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
        .chapters?.[0]?.fragments?.[0]?.blocks;
      expect(blocks).toMatchObject([
        { id: "line-a", startMs: 0, endMs: 4000 },
        { id: "line-b", startMs: 4000, endMs: 7000 },
        { id: "line-c", startMs: 7000, endMs: 10_000 },
      ]);
      expect(
        vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1].chapters?.[0]
          ?.fragments?.[0]?.timeline?.durationMs,
      ).toBe(13_000);
    },
    { timeout: 2000 },
  );
  const totalDuration = screen.getByRole("textbox", {
    name: "剧情时间轴总长",
  });
  expect(totalDuration).toHaveValue("00:13.000");
  await user.clear(totalDuration);
  await user.type(totalDuration, "00:08.000{enter}");
  expect(
    screen.getByText("已保留到最后一个 Block 的结束时间 00:10.000"),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(
      vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1].chapters?.[0]
        ?.fragments?.[0]?.timeline?.durationMs,
    ).toBe(10_000),
  );
  expect(
    JSON.parse(
      localStorage.getItem("future_props_galgame_timeline_preferences")!,
    ),
  ).toMatchObject({ ripple: true });
});

test("reloads a newer saved server revision on focus without losing the current location", async () => {
  const updated = {
    ...story,
    revision: 4,
    document: {
      ...story.document,
      synopsis: "服务器更新后的简介",
    },
  };
  renderEditor();
  await screen.findByText("纵向切片");
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce(updated);
  fireEvent(window, new Event("focus"));

  await waitFor(() =>
    expect(screen.getByLabelText("故事简介")).toHaveValue("服务器更新后的简介"),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "已载入服务器 revision 4",
  );
});

test("binds the first portrait as the stable default expression and auto-saves", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      characters: [
        {
          id: "character-one",
          name: "调查员",
          description: "",
          expressions: [],
          defaultExpressionId: null,
        },
      ],
    },
  });
  vi.mocked(getGalgameProjectAssets).mockResolvedValue({
    items: [
      {
        id: "file-portrait",
        display_name: "calm.png",
        media_kind: "image",
        mime_type: "image/png",
        byte_size: 128,
        revision: 0,
        created_at: "2026-08-05T08:00:00Z",
        updated_at: "2026-08-05T08:00:00Z",
      },
    ],
  });
  renderEditor();
  await screen.findByText("纵向切片");
  await openAssetSection(user, "角色");
  await user.click(screen.getByRole("button", { name: "添加表情" }));
  await user.click(
    await screen.findByRole("button", { name: /calm.png.*点击选择/ }),
  );

  await waitFor(
    () => {
      const document = vi
        .mocked(putGalgameStoryDocument)
        .mock.calls.at(-1)?.[1];
      const character = document?.characters?.[0];
      expect(character?.expressions).toHaveLength(1);
      expect(character?.defaultExpressionId).toBe(
        character?.expressions?.[0].id,
      );
      expect(document?.assets?.[0]).toMatchObject({
        fileId: "file-portrait",
        role: "characterPortrait",
        status: "ready",
      });
    },
    { timeout: 2000 },
  );
});

test("binds ordered scene layers while Scene Blocks only select scenes", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      scenes: [
        {
          id: "scene-one",
          name: "研究所",
          description: "",
          layers: [],
        },
        {
          id: "scene-two",
          name: "天台",
          description: "",
          layers: [],
        },
      ],
      chapters: [
        {
          ...story.document.chapters[0],
          fragments: [
            {
              id: "main",
              title: "main",
              blocks: [
                { id: "scene-block", type: "scene", sceneId: "scene-one" },
                {
                  id: "ending",
                  type: "endChapter",
                  endingId: "ending",
                  label: "结束",
                },
              ],
            },
          ],
        },
      ],
    },
  });
  vi.mocked(getGalgameProjectAssets).mockResolvedValue({
    items: [
      {
        id: "file-background",
        display_name: "rainy-night.png",
        media_kind: "image",
        mime_type: "image/png",
        byte_size: 256,
        revision: 0,
        created_at: "2026-08-05T08:00:00Z",
        updated_at: "2026-08-05T08:00:00Z",
      },
    ],
  });
  localStorage.setItem(
    "future_props_galgame_editor_script_view",
    "performance",
  );
  renderEditor();
  await screen.findByText("纵向切片");
  await openAssetSection(user, "场景");
  await user.click(screen.getByRole("button", { name: "素材库添加" }));
  await user.click(
    await screen.findByRole("button", {
      name: /rainy-night.png.*点击选择/,
    }),
  );

  await waitFor(
    () => {
      const savedDocument = vi
        .mocked(putGalgameStoryDocument)
        .mock.calls.at(-1)?.[1];
      const scene = savedDocument?.scenes?.[0];
      expect(scene?.layers?.[0]).toMatchObject({
        name: "rainy-night",
        distance: 1,
        offsetX: 0,
        offsetY: 0,
      });
      expect(savedDocument?.assets?.[0]).toMatchObject({
        fileId: "file-background",
        role: "sceneLayer",
        status: "ready",
      });
    },
    { timeout: 2000 },
  );

  vi.mocked(putGalgameStoryDocument).mockClear();
  await user.click(screen.getByRole("button", { name: "放大舞台" }));
  expect(screen.getByText("110%")).toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 750));
  expect(putGalgameStoryDocument).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("图层 rainy-night 距离数值"), {
    target: { value: "3.5" },
  });
  await waitFor(
    () => {
      const savedLayer = vi
        .mocked(putGalgameStoryDocument)
        .mock.calls.at(-1)?.[1].scenes?.[0]?.layers?.[0];
      expect(savedLayer?.distance).toBe(3.5);
    },
    { timeout: 2000 },
  );

  await user.click(screen.getByRole("button", { name: "剧本" }));
  await user.click(screen.getByRole("button", { name: "剧本" }));
  await user.click(
    await screen.findByRole("button", { name: /研究所 00:00\./ }),
  );
  await user.click(screen.getByLabelText("切换场景"));
  await user.click(screen.getByRole("option", { name: "天台" }));
  await waitFor(
    () => {
      const switchedBlock = vi
        .mocked(putGalgameStoryDocument)
        .mock.calls.at(-1)?.[1].chapters?.[0]?.fragments?.[0]?.blocks?.[0];
      expect(switchedBlock).toMatchObject({
        type: "scene",
        sceneId: "scene-two",
      });
    },
    { timeout: 2000 },
  );
});

test("manages CG variants and authors explicit show and hide blocks", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameProjectAssets).mockResolvedValue({
    items: [
      {
        id: "file-cg",
        display_name: "rain-confession.png",
        media_kind: "image",
        mime_type: "image/png",
        byte_size: 512,
        revision: 0,
        created_at: "2026-08-05T08:00:00Z",
        updated_at: "2026-08-05T08:00:00Z",
      },
    ],
  });
  localStorage.setItem(
    "future_props_galgame_editor_script_view",
    "performance",
  );
  renderEditor();
  await screen.findByText("纵向切片");
  await openAssetSection(user, "场景");
  await user.click(screen.getByRole("button", { name: "剧情 CG" }));
  await user.click(screen.getByRole("button", { name: "新建 CG" }));
  await user.click(screen.getByRole("button", { name: "添加差分" }));
  await user.click(
    await screen.findByRole("button", {
      name: /rain-confession.png.*点击选择/,
    }),
  );

  let cgId = "";
  let variantId = "";
  await waitFor(
    () => {
      const savedDocument = vi
        .mocked(putGalgameStoryDocument)
        .mock.calls.at(-1)?.[1];
      const cg = savedDocument?.cgs?.[0];
      cgId = cg?.id ?? "";
      variantId = cg?.variants?.[0]?.id ?? "";
      expect(cg?.defaultVariantId).toBe(variantId);
      expect(savedDocument?.assets?.[0]).toMatchObject({
        fileId: "file-cg",
        role: "storyCg",
        status: "ready",
      });
    },
    { timeout: 2000 },
  );

  await user.click(screen.getByRole("button", { name: "剧本" }));
  await user.click(screen.getByRole("button", { name: "在播放头添加内容" }));
  await user.click(screen.getByRole("button", { name: "显示 CG" }));
  await user.click(screen.getByLabelText("CG 画面适配"));
  await user.click(screen.getByRole("option", { name: "完整显示（黑边）" }));
  await user.click(screen.getByLabelText("CG 显示模式"));
  await user.click(screen.getByRole("option", { name: "叠加 CG" }));
  await user.click(screen.getByLabelText("CG 叠放位置"));
  await user.click(screen.getByRole("option", { name: "角色后方" }));
  fireEvent.change(screen.getByLabelText("CG X 位置数值"), {
    target: { value: "30" },
  });
  fireEvent.change(screen.getByLabelText("CG 画面宽度数值"), {
    target: { value: "72" },
  });
  await user.click(screen.getByRole("button", { name: "在播放头添加内容" }));
  await user.click(screen.getByRole("button", { name: "隐藏 CG" }));
  await waitFor(
    () => {
      const blocks = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
        .chapters?.[0]?.fragments?.[0]?.blocks;
      expect(blocks?.[0]).toMatchObject({
        type: "showCg",
        cgId,
        variantId: null,
        displayMode: "overlay",
        fit: "contain",
        overlay: {
          x: 30,
          width: 72,
          placement: "behindCharacters",
        },
      });
      expect(blocks?.[1]).toMatchObject({ type: "hideCg" });
    },
    { timeout: 2000 },
  );

  await openAssetSection(user, "场景");
  await user.click(screen.getByRole("button", { name: "删除差分" }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "差分仍被 1 个显示 CG Block 引用",
  );
  await user.click(
    screen.getByRole("button", { name: /第一章 · main · Block 1/ }),
  );
  expect(screen.getByLabelText("显示剧情 CG")).toHaveTextContent("新剧情 CG");
});

test("uses workshop dropdowns for dialogue properties and switches appearance", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      characters: [
        {
          id: "okabe",
          name: "冈部伦太郎",
          description: "",
          expressions: [
            { id: "neutral", label: "平静", assetId: "asset-neutral" },
          ],
          defaultExpressionId: "neutral",
        },
        {
          id: "kurisu",
          name: "牧濑红莉栖",
          description: "",
          expressions: [
            { id: "annoyed", label: "不悦", assetId: "asset-annoyed" },
            {
              id: "concerned",
              label: "担忧",
              assetId: "asset-concerned",
            },
          ],
          defaultExpressionId: "annoyed",
        },
      ],
      chapters: [
        {
          ...story.document.chapters[0],
          fragments: [
            {
              id: "main",
              title: "main",
              blocks: [
                {
                  id: "dialogue-one",
                  type: "dialogue",
                  characterId: "okabe",
                  expressionId: null,
                  text: "测试对白",
                },
              ],
            },
          ],
        },
      ],
    },
  });
  localStorage.setItem(
    "future_props_galgame_editor_script_view",
    "performance",
  );
  renderEditor();

  await user.click(
    await screen.findByRole("button", { name: /冈部伦太郎 00:00\.000/ }),
  );
  const characterSelect = await screen.findByLabelText("说话角色");
  expect(characterSelect.tagName).toBe("BUTTON");
  const simultaneousSpeakers = screen.getByRole("group", {
    name: "同时说话角色",
  });
  expect(
    within(simultaneousSpeakers).getByRole("checkbox", {
      name: /冈部伦太郎/,
    }),
  ).toBeDisabled();
  await user.click(
    within(simultaneousSpeakers).getByRole("checkbox", {
      name: "牧濑红莉栖",
    }),
  );
  await waitFor(
    () => {
      const block = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
        .chapters?.[0]?.fragments?.[0]?.blocks?.[0];
      expect(block).toMatchObject({
        type: "dialogue",
        characterId: "okabe",
        speakerIds: ["okabe", "kurisu"],
      });
    },
    { timeout: 2000 },
  );
  expect(screen.getAllByText("冈部伦太郎、牧濑红莉栖").length).toBeGreaterThan(
    0,
  );

  await user.click(characterSelect);
  await user.click(screen.getByRole("option", { name: "牧濑红莉栖" }));
  expect(characterSelect).toHaveTextContent("牧濑红莉栖");

  const expressionSelect = screen.getByLabelText("对白表情");
  await user.click(expressionSelect);
  await user.click(screen.getByRole("option", { name: "担忧" }));
  await waitFor(
    () => {
      const block = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
        .chapters?.[0]?.fragments?.[0]?.blocks?.[0];
      expect(block).toMatchObject({
        type: "dialogue",
        characterId: "kurisu",
        speakerIds: ["kurisu", "okabe"],
        expressionId: "concerned",
      });
    },
    { timeout: 2000 },
  );

  const appearance = screen.getByRole("group", { name: "外观模式" });
  await user.click(within(appearance).getByRole("button", { name: "深色" }));
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  expect(localStorage.getItem("future_props_theme")).toBe("dark");
});

test("adds background music blocks from the sound workspace with channel defaults", async () => {
  const user = userEvent.setup();
  const audioStory = structuredClone(story) as unknown as GalgameStoryDocument;
  audioStory.document.characters = [
    { id: "hero", name: "白羽", description: "" },
  ];
  audioStory.document.assets = [
    {
      id: "bgm-rain",
      type: "audio",
      role: "backgroundMusic",
      label: "雨夜咖啡馆",
      fileId: "file-bgm",
      status: "ready",
    },
  ];
  audioStory.document.chapters![0].fragments![0].blocks = [
    {
      id: "dialogue-one",
      type: "dialogue",
      characterId: "hero",
      text: "你终于来了。",
      voiceVolume: 100,
    },
  ];
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce(audioStory);
  localStorage.setItem(
    "future_props_galgame_editor_script_view",
    "performance",
  );
  const rendered = renderEditor();
  await screen.findByText("纵向切片");

  const workspace = screen.getByRole("navigation", { name: "创作工作区" });
  await openAssetSection(user, "BGM");
  expect(screen.getByText("通常循环播放")).toBeInTheDocument();
  expect(screen.getAllByText("雨夜咖啡馆").length).toBeGreaterThan(0);

  await user.click(within(workspace).getByRole("button", { name: "剧本" }));
  const add = rendered.container.querySelector<HTMLElement>(
    ".galgame-playhead-add-menu",
  )!;
  await user.click(
    within(add).getByRole("button", { name: "在播放头添加内容" }),
  );
  await user.click(screen.getByRole("button", { name: "背景音乐" }));

  await waitFor(
    () => {
      const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
      const block = saved?.chapters?.[0].fragments?.[0].blocks?.find(
        (candidate) => candidate.type === "audio",
      );
      expect(block).toMatchObject({
        type: "audio",
        action: "play",
        channel: "bgm",
        assetId: "bgm-rain",
        volume: 70,
        loop: true,
        fadeMs: 1000,
      });
    },
    { timeout: 2000 },
  );
});

test("uses aligned table workspaces for BGM, sound effects, and voice", async () => {
  const user = userEvent.setup();
  const audioStory = structuredClone(story) as unknown as GalgameStoryDocument;
  audioStory.document.characters = [
    { id: "hero", name: "白羽", description: "" },
  ];
  audioStory.document.assets = [
    {
      id: "bgm-rain",
      type: "audio",
      role: "backgroundMusic",
      label: "雨夜咖啡馆",
      fileId: "file-bgm",
      status: "ready",
    },
    {
      id: "sfx-door",
      type: "audio",
      role: "soundEffect",
      label: "开门",
      fileId: "file-sfx",
      status: "ready",
    },
    {
      id: "ambient-train",
      type: "audio",
      role: "ambientSound",
      label: "远处列车",
      fileId: "file-ambient",
      status: "ready",
    },
    {
      id: "voice-hero",
      type: "audio",
      role: "voiceLine",
      label: "白羽对白",
      fileId: "file-voice-hero",
      status: "ready",
    },
    {
      id: "voice-unknown",
      type: "audio",
      role: "voiceLine",
      label: "未匹配对白",
      fileId: "file-voice-unknown",
      status: "ready",
    },
  ];
  audioStory.document.chapters![0].fragments![0].blocks = [
    {
      id: "dialogue-one",
      type: "dialogue",
      characterId: "hero",
      text: "你终于来了。",
      voiceAssetId: "voice-hero",
      voiceVolume: 100,
    },
  ];
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce(audioStory);
  vi.mocked(getGalgameProjectAssets).mockResolvedValue({
    items: [
      {
        id: "file-bgm",
        display_name: "rainy-cafe.mp3",
        media_kind: "audio",
        mime_type: "audio/mpeg",
        byte_size: 2 * 1024 * 1024,
        durationMs: 96_000,
        revision: 0,
        created_at: "2026-08-05T08:00:00Z",
        updated_at: "2026-08-05T08:00:00Z",
      },
      {
        id: "file-sfx",
        display_name: "door.wav",
        media_kind: "audio",
        mime_type: "audio/wav",
        byte_size: 72 * 1024,
        durationMs: 1_000,
        revision: 0,
        created_at: "2026-08-05T08:00:00Z",
        updated_at: "2026-08-05T08:00:00Z",
      },
      {
        id: "file-ambient",
        display_name: "train.mp3",
        media_kind: "audio",
        mime_type: "audio/mpeg",
        byte_size: 630 * 1024,
        durationMs: 16_000,
        revision: 0,
        created_at: "2026-08-05T08:00:00Z",
        updated_at: "2026-08-05T08:00:00Z",
      },
      {
        id: "file-voice-hero",
        display_name: "001.wav",
        media_kind: "audio",
        mime_type: "audio/wav",
        byte_size: 480 * 1024,
        durationMs: 3_000,
        transcript: "你终于来了。",
        transcriptStatus: "ready",
        transcriptRevision: 1,
        revision: 0,
        created_at: "2026-08-05T08:00:00Z",
        updated_at: "2026-08-05T08:00:00Z",
      },
      {
        id: "file-voice-unknown",
        display_name: "002.wav",
        media_kind: "audio",
        mime_type: "audio/wav",
        byte_size: 490 * 1024,
        durationMs: 4_000,
        transcript: "这是谁的声音？",
        transcriptStatus: "ready",
        transcriptRevision: 1,
        revision: 0,
        created_at: "2026-08-05T08:00:00Z",
        updated_at: "2026-08-05T08:00:00Z",
      },
    ],
  });
  renderEditor();
  await screen.findByText("纵向切片");

  await openAssetSection(user, "BGM");
  const bgmWorkspace = document.querySelector(".galgame-sound-workspace");
  expect(bgmWorkspace).toHaveClass("is-bgm");
  expect(within(bgmWorkspace as HTMLElement).getAllByText("BGM")).toHaveLength(
    1,
  );
  expect(await screen.findByText("rainy-cafe.mp3")).toBeInTheDocument();
  expect(screen.getByText("1:36")).toBeInTheDocument();
  expect(screen.getByText("2.0 MB")).toBeInTheDocument();
  expect(screen.getByText("未选择BGM")).toBeInTheDocument();

  await openAssetSection(user, "音效");
  expect(document.querySelector(".galgame-sound-workspace")).toHaveClass(
    "is-sfx",
  );
  expect(
    within(
      document.querySelector(".galgame-sound-workspace") as HTMLElement,
    ).getAllByText("音效"),
  ).toHaveLength(1);
  expect(await screen.findByText("door.wav")).toBeInTheDocument();
  expect(screen.getByText("train.mp3")).toBeInTheDocument();
  expect(screen.queryByText("rainy-cafe.mp3")).not.toBeInTheDocument();

  await openAssetSection(user, "语音");
  expect(document.querySelector(".galgame-sound-workspace")).toHaveClass(
    "is-voice",
  );
  expect(
    within(
      document.querySelector(".galgame-sound-workspace") as HTMLElement,
    ).getAllByText("语音"),
  ).toHaveLength(1);
  const speakers = screen.getByRole("complementary", {
    name: "语音角色筛选",
  });
  expect(await screen.findByText("001.wav")).toBeInTheDocument();
  expect(screen.getByText("你终于来了。")).toBeInTheDocument();
  await user.click(within(speakers).getByRole("button", { name: /未知/ }));
  expect(screen.getByText("002.wav")).toBeInTheDocument();
  expect(screen.queryByText("001.wav")).not.toBeInTheDocument();
});

test("moves voice profiles out of characters and marks edited dialogue as stale", async () => {
  const user = userEvent.setup();
  const audioStory = structuredClone(story) as unknown as GalgameStoryDocument;
  audioStory.document.characters = [
    {
      id: "hero",
      name: "白羽",
      description: "",
      voiceProfile: {
        name: "冷静低声线",
        language: "zh-CN",
        description: "克制、轻声",
        sampleAssetId: "voice-sample",
      },
    },
  ];
  audioStory.document.assets = [
    {
      id: "voice-sample",
      type: "audio",
      role: "voiceSample",
      label: "白羽声线样本",
      fileId: "file-sample",
      status: "ready",
    },
    {
      id: "voice-line",
      type: "audio",
      role: "voiceLine",
      label: "你终于来了",
      fileId: "file-line",
      status: "ready",
    },
  ];
  audioStory.document.chapters![0].fragments![0].blocks = [
    {
      id: "dialogue-one",
      type: "dialogue",
      characterId: "hero",
      text: "你终于来了。",
      voiceAssetId: "voice-line",
      voiceVolume: 90,
    },
  ];
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce(audioStory);
  localStorage.setItem(
    "future_props_galgame_editor_script_view",
    "performance",
  );
  renderEditor();
  await screen.findByText("纵向切片");

  const workspace = screen.getByRole("navigation", { name: "创作工作区" });
  await openAssetSection(user, "角色");
  expect(
    screen.queryByRole("button", { name: "声线资料" }),
  ).not.toBeInTheDocument();

  await user.click(within(workspace).getByRole("button", { name: "剧本" }));
  await user.click(
    await screen.findByRole("button", { name: /白羽 00:00\.000/ }),
  );
  const text = screen.getByLabelText("对白正文");
  await user.clear(text);
  await user.type(text, "雨比预报中更早。 ");
  expect(screen.getByText(/配音可能已过期/)).toBeInTheDocument();
  expect(screen.getByText("你终于来了")).toBeInTheDocument();
});

test("adds and edits multi-character stage blocks with live edit preview", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      characters: [
        { id: "hero", name: "调查员", description: "" },
        { id: "partner", name: "助手", description: "" },
      ],
    },
  });
  localStorage.setItem(
    "future_props_galgame_editor_script_view",
    "performance",
  );
  const { container } = renderEditor();
  await screen.findByText("纵向切片");

  expect(screen.getByRole("button", { name: "编辑" })).toHaveClass("active");
  await user.click(screen.getByRole("button", { name: "在播放头添加内容" }));
  await user.click(screen.getByRole("button", { name: /角色登场 \/ 调整/ }));
  expect(screen.getByLabelText("登场或调整角色")).toHaveTextContent("调查员");
  const presets = screen.getByLabelText("角色站位预设");
  await user.click(within(presets).getByRole("button", { name: "左" }));
  fireEvent.change(screen.getByLabelText("角色亮度"), {
    target: { value: "1.4" },
  });

  await waitFor(
    () => {
      const block = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
        .chapters?.[0]?.fragments?.[0]?.blocks?.[0];
      expect(block).toMatchObject({
        type: "showCharacter",
        characterId: "hero",
        transform: { x: 25, y: 100, brightness: 1.4 },
      });
    },
    { timeout: 2000 },
  );
  expect(container.querySelector('[data-character-id="hero"]')).toHaveStyle({
    left: "25%",
  });
  const xPosition = screen.getByLabelText("角色X 位置数值");
  const yPosition = screen.getByLabelText("角色Y 位置数值");
  expect(xPosition).toHaveAttribute("min", "-1000");
  expect(xPosition).toHaveAttribute("max", "1000");
  expect(yPosition).toHaveAttribute("min", "-1000");
  expect(yPosition).toHaveAttribute("max", "1000");
  fireEvent.change(xPosition, { target: { value: "-40" } });
  fireEvent.change(yPosition, { target: { value: "150" } });
  await waitFor(() => {
    const block = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
      .chapters?.[0]?.fragments?.[0]?.blocks?.[0];
    expect(block).toMatchObject({
      type: "showCharacter",
      transform: { x: -40, y: 150 },
    });
  });
  fireEvent.keyDown(screen.getByLabelText("调整角色 调查员"), {
    key: "ArrowRight",
    shiftKey: true,
  });
  await waitFor(
    () => {
      const block = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
        .chapters?.[0]?.fragments?.[0]?.blocks?.[0];
      expect(block).toMatchObject({
        type: "showCharacter",
        transform: { x: -35 },
      });
    },
    { timeout: 2000 },
  );

  await user.click(screen.getByRole("button", { name: "在播放头添加内容" }));
  await user.click(screen.getByRole("button", { name: "对白" }));
  await waitFor(
    () => {
      const blocks = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
        .chapters?.[0]?.fragments?.[0]?.blocks;
      expect(blocks?.[1]).toMatchObject({
        type: "dialogue",
        portrait: { mode: "stage", keepAfter: true },
      });
    },
    { timeout: 2000 },
  );

  await user.click(screen.getByRole("button", { name: "在播放头添加内容" }));
  await user.click(screen.getByRole("button", { name: "全部退场" }));
  await waitFor(
    () => {
      const blocks = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
        .chapters?.[0]?.fragments?.[0]?.blocks;
      expect(blocks?.[2]).toMatchObject({
        type: "removeCharacter",
        all: true,
        characterId: null,
      });
    },
    { timeout: 2000 },
  );
}, 10_000);
