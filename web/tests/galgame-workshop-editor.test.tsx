import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
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
  matchGalgameVoiceDialogue,
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
    matchGalgameVoiceDialogue: vi.fn(),
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
  StoryAssetImage: ({
    fileId,
    fallback,
  }: {
    fileId?: string;
    fallback?: ReactNode;
  }) => <span data-file-id={fileId ?? ""}>{fileId ? "图片" : fallback}</span>,
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
  localStorage.removeItem("future_props_galgame_editor_script_layout_v3");
  localStorage.removeItem("future_props_galgame_editor_script_layout_v4");
  localStorage.removeItem("future_props_galgame_editor_script_view");
  localStorage.removeItem(
    "future_props_galgame_character_stage_scope:project-1",
  );
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
  vi.mocked(matchGalgameVoiceDialogue).mockResolvedValue({
    storyRevision: 1,
    matches: [],
    unmatchedAssetIds: [],
  });
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
}, 10_000);

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
  expect(
    within(importDialog).getByText(/图片、音频、视频、字体或文档/),
  ).toBeInTheDocument();
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
}, 15_000);

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
  expect(await screen.findByLabelText("选择提示")).toHaveValue("选择调查方向");

  await user.click(within(workspace).getByRole("button", { name: "叙事地图" }));
  expect(await screen.findByText("由 Story 文档实时派生")).toBeInTheDocument();
  expect(screen.getByDisplayValue("信任度")).toBeInTheDocument();

  await user.click(within(workspace).getByRole("button", { name: "个性化" }));
  expect(await screen.findByText("实时游戏预览")).toBeInTheDocument();
  const typingSpeed = screen.getByRole("spinbutton", {
    name: "全局打字速度（字/秒）",
  });
  expect(typingSpeed).toHaveValue(40);
  await user.click(
    screen.getByRole("button", { name: "增加全局打字速度（字/秒）" }),
  );
  expect(typingSpeed).toHaveValue(45);

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
  ).toBe(39);
  expect(
    JSON.parse(
      localStorage.getItem("future_props_galgame_editor_script_layout_v4")!,
    ),
  ).toMatchObject({ version: 4, centerRatio: 39 });

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
      localStorage.getItem("future_props_galgame_editor_script_layout_v4")!,
    ),
  ).toMatchObject({ version: 4, previewSplitRatio: 50.25 });

  fireEvent.doubleClick(divider);
  expect(grid.style.getPropertyValue("--galgame-stage-split")).toBe("60%");
});
