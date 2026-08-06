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
  getGalgameStoryDocument,
  getGalgameStoryReport,
  getGalgameProjectAssets,
  getGalgameWorkshopProject,
  putGalgameStoryDocument,
  uploadGalgameProjectAsset,
  type GalgameStoryDocument,
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
  src = "";
  currentTime = 0;
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
}

vi.mock("@features/galgame-workshop/api", async () => {
  const actual = await vi.importActual<
    typeof import("@features/galgame-workshop/api")
  >("@features/galgame-workshop/api");
  return {
    ...actual,
    getGalgameStoryDocument: vi.fn(),
    getGalgameStoryReport: vi.fn(),
    getGalgameProjectAssets: vi.fn(),
    getGalgameWorkshopProject: vi.fn(),
    putGalgameStoryDocument: vi.fn(),
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
  vi.stubGlobal("Audio", EditorMockAudio);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:editor-audio"),
    revokeObjectURL: vi.fn(),
  });
  localStorage.removeItem("future_props_theme");
  localStorage.removeItem("future_props_galgame_editor_sidebar_widths");
  Object.defineProperty(window, "PointerEvent", {
    configurable: true,
    writable: true,
    value: MouseEvent,
  });
  document.documentElement.dataset.theme = "light";
  vi.mocked(getGalgameWorkshopProject).mockResolvedValue(project);
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
    expect(grid.style.getPropertyValue("--galgame-fragment-width")).toBe(
      "300px",
    ),
  );

  const previewDivider = screen.getByRole("separator", {
    name: "调整预览检查栏宽度",
  });
  fireEvent.keyDown(previewDivider, { key: "ArrowLeft" });
  expect(grid.style.getPropertyValue("--galgame-preview-width")).toBe("340px");
  expect(
    JSON.parse(
      localStorage.getItem("future_props_galgame_editor_sidebar_widths")!,
    ),
  ).toEqual({
    left: 300,
    right: 340,
  });

  fireEvent.doubleClick(storyDivider);
  expect(grid.style.getPropertyValue("--galgame-fragment-width")).toBe("210px");
});

test("uploads dialogue and custom Gal component images with auto-save", async () => {
  const user = userEvent.setup();
  const { container } = renderEditor();
  expect(await screen.findByText("纵向切片")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "样式" }));

  const uploadInput = container.querySelector<HTMLInputElement>(
    '.galgame-dialogue-style-inspector input[type="file"]',
  )!;
  await user.click(screen.getByRole("button", { name: "上传底图" }));
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
  await user.click(screen.getByRole("button", { name: "角色" }));
  await user.click(screen.getByRole("button", { name: "新建角色" }));
  await waitFor(() => expect(putGalgameStoryDocument).toHaveBeenCalled(), {
    timeout: 2000,
  });
  expect(
    vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1].characters,
  ).toHaveLength(1);

  await user.click(
    within(screen.getByRole("navigation", { name: "创作工作区" })).getByRole(
      "button",
      { name: "场景" },
    ),
  );
  await user.click(screen.getByRole("button", { name: "新建场景" }));
  await waitFor(
    () =>
      expect(
        vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1].scenes,
      ).toHaveLength(1),
    { timeout: 2000 },
  );
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

  await user.click(screen.getByRole("button", { name: "角色" }));
  expect(screen.getByRole("button", { name: "删除角色" })).toBeDisabled();
  expect(screen.getByText("角色仍被对白引用，无法删除。")).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", {
      name: /第一章 · main · Block 2/,
    }),
  );
  expect(screen.getByLabelText("对白正文")).toHaveValue("别删掉我。");

  await user.click(
    within(screen.getByRole("navigation", { name: "创作工作区" })).getByRole(
      "button",
      { name: "场景" },
    ),
  );
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
  await user.click(screen.getByRole("button", { name: "角色" }));
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
  await user.click(screen.getByRole("button", { name: "角色" }));
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
  renderEditor();

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

  await user.click(screen.getAllByRole("button", { name: /^开始试玩$/ })[0]!);
  expect(
    await within(screen.getByRole("region", { name: "游戏预览" })).findByText(
      "右侧属性已更新",
    ),
  ).toBeInTheDocument();
});

test("opens the visual timeline and edits precise cue timing", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      assets: [
        {
          id: "timeline-audio",
          type: "audio",
          role: "timelineTrack",
          label: "完整剧情时间轴",
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
              timeline: { assetId: "timeline-audio", durationMs: 105_000 },
              blocks: [
                {
                  id: "timed-narration",
                  type: "narration",
                  text: "旧时间轴旁白",
                  startMs: 12_300,
                  endMs: 18_900,
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
  renderEditor();

  expect(await screen.findByText(/剧情时间轴 1:45\.0/)).toBeInTheDocument();
  expect(screen.getByLabelText("对白开始时间")).toHaveValue("00:12.300");
  expect(screen.getByLabelText("对白结束时间")).toHaveValue("00:18.900");
  await user.click(screen.getByRole("button", { name: "时间轴" }));
  expect(
    screen.getByRole("region", { name: "可编辑剧情时间轴" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /旁白 00:12\.300/ }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("时间轴缩放")).toHaveValue("300");

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
  vi.mocked(getGalgameProjectAssets).mockResolvedValueOnce({
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
  await user.click(screen.getByRole("button", { name: "角色" }));
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

test("binds a default scene background and lets Scene Blocks choose its state", async () => {
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
          backgrounds: [],
          defaultBackgroundId: null,
        },
        {
          id: "scene-two",
          name: "天台",
          description: "",
          backgrounds: [],
          defaultBackgroundId: null,
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
  vi.mocked(getGalgameProjectAssets).mockResolvedValueOnce({
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
  renderEditor();
  await screen.findByText("纵向切片");
  await user.click(
    within(screen.getByRole("navigation", { name: "创作工作区" })).getByRole(
      "button",
      { name: "场景" },
    ),
  );
  await user.click(screen.getByRole("button", { name: "添加状态" }));
  await user.click(
    await screen.findByRole("button", {
      name: /rainy-night.png.*点击选择/,
    }),
  );

  let backgroundId = "";
  await waitFor(
    () => {
      const savedDocument = vi
        .mocked(putGalgameStoryDocument)
        .mock.calls.at(-1)?.[1];
      const scene = savedDocument?.scenes?.[0];
      backgroundId = scene?.backgrounds?.[0]?.id ?? "";
      expect(scene?.defaultBackgroundId).toBe(backgroundId);
      expect(savedDocument?.assets?.[0]).toMatchObject({
        fileId: "file-background",
        role: "sceneBackground",
        status: "ready",
      });
    },
    { timeout: 2000 },
  );

  await user.click(screen.getByRole("button", { name: "剧本" }));
  await user.click(screen.getByLabelText("背景状态"));
  await user.click(screen.getByRole("option", { name: "rainy-night" }));
  await waitFor(
    () => {
      const block = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
        .chapters?.[0]?.fragments?.[0]?.blocks?.[0];
      expect(block).toMatchObject({ type: "scene", backgroundId });
    },
    { timeout: 2000 },
  );
  await user.click(
    within(screen.getByRole("navigation", { name: "创作工作区" })).getByRole(
      "button",
      { name: "场景" },
    ),
  );
  await user.click(
    screen.getByRole("button", { name: /研究所.*1 次场景切换/ }),
  );
  await user.click(screen.getByRole("button", { name: "删除背景" }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "背景仍被 1 个场景 Block 显式引用",
  );

  await user.click(screen.getByRole("button", { name: "剧本" }));
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
        backgroundId: null,
      });
    },
    { timeout: 2000 },
  );
  await user.click(screen.getByLabelText("切换场景"));
  await user.click(screen.getByRole("option", { name: "研究所" }));
  await waitFor(
    () => {
      const block = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
        .chapters?.[0]?.fragments?.[0]?.blocks?.[0];
      expect(block).toMatchObject({
        type: "scene",
        sceneId: "scene-one",
        backgroundId: null,
      });
    },
    { timeout: 2000 },
  );
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
  renderEditor();

  const characterSelect = await screen.findByLabelText("说话角色");
  expect(characterSelect.tagName).toBe("BUTTON");
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
  const rendered = renderEditor();
  await screen.findByText("纵向切片");

  const workspace = screen.getByRole("navigation", { name: "创作工作区" });
  await user.click(within(workspace).getByRole("button", { name: "声音" }));
  expect(screen.getByText("声音资源")).toBeInTheDocument();
  expect(screen.getAllByText("雨夜咖啡馆").length).toBeGreaterThan(0);

  await user.click(within(workspace).getByRole("button", { name: "剧本" }));
  const add =
    rendered.container.querySelector<HTMLElement>(".galgame-block-add")!;
  await user.click(within(add).getByRole("button", { name: "背景音乐" }));

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

test("shows character voice profiles and marks edited bound dialogue as stale", async () => {
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
  renderEditor();
  await screen.findByText("纵向切片");

  const workspace = screen.getByRole("navigation", { name: "创作工作区" });
  await user.click(within(workspace).getByRole("button", { name: "角色" }));
  await user.click(screen.getByRole("button", { name: "声线资料" }));
  expect(screen.getByDisplayValue("冷静低声线")).toBeInTheDocument();
  expect(screen.getByText("白羽声线样本")).toBeInTheDocument();

  await user.click(within(workspace).getByRole("button", { name: "剧本" }));
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
  const { container } = renderEditor();
  await screen.findByText("纵向切片");

  expect(screen.getByRole("button", { name: "编辑" })).toHaveClass("active");
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
        transform: { x: 30 },
      });
    },
    { timeout: 2000 },
  );

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
});
