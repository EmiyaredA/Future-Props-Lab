import { publicImageSources } from "@shared/lib/imageSources";
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
import { fetchApiDownload } from "@platform/api/client";
import {
  getGalgameStoryDocument,
  getGalgameStoryReport,
  getGalgameAssetOverview,
  getGalgamePackageManifest,
  getGalgameProjectAssets,
  getGalgameWorkshopProject,
  matchGalgameVoiceDialogue,
  patchGalgameWorkshopProject,
  putGalgameStoryDocument,
  scanGalgameAssetMetadata,
  uploadGalgameProjectAsset,
} from "@features/galgame-workshop/api";

vi.mock("@platform/api/client", async () => {
  const actual = await vi.importActual<typeof import("@platform/api/client")>(
    "@platform/api/client",
  );
  return {
    ...actual,
    fetchApiBlob: vi.fn().mockResolvedValue(new Blob(["audio"])),
    fetchApiDownload: vi.fn(),
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
  is_official: false,
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
  vi.mocked(fetchApiDownload).mockResolvedValue({
    blob: new Blob(["image"], { type: "image/png" }),
    filename: "preview.png",
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
  await user.click(await screen.findByText("经典渐隐", {}, { timeout: 5000 }));
  await waitFor(() =>
    expect(
      vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1].presentation
        ?.dialogueBox,
    ).toMatchObject({
      preset: "classicGradient",
      layout: { mode: "bottomOverlay", heightPercent: 30 },
      background: { mode: "verticalGradient", topRule: "double" },
      body: { fontSizePx: 30, align: "left" },
      speakerName: {
        placement: "bottomCenter",
        fontSizePx: 22,
        decoration: "sideLines",
      },
      advanceIndicator: {
        position: "bottomLeft",
        style: "compact",
        showInExport: true,
      },
    }),
  );
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
    { timeout: 5000 },
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
    { timeout: 5000 },
  );

  fireEvent.change(screen.getByLabelText("对话框底板整体透明度"), {
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
  ).toHaveAttribute(
    "src",
    publicImageSources("/brand/galgame-workshop-mark-cutout.png").src,
  );
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

test("renames character, scene, and CG titles in place", async () => {
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
      scenes: [
        {
          id: "scene-one",
          name: "夜间研究所",
          description: "",
          groupId: null,
          layers: [],
        },
      ],
      cgs: [
        {
          id: "cg-one",
          name: "雨夜告白",
          description: "",
          variants: [],
          defaultVariantId: null,
        },
      ],
    },
  });
  renderEditor();
  await screen.findByText("纵向切片");

  await openAssetSection(user, "角色");
  await user.dblClick(
    screen.getByRole("button", { name: "双击编辑角色名称：调查员" }),
  );
  const characterName = screen.getByRole("textbox", {
    name: "编辑角色名称",
  });
  await user.clear(characterName);
  await user.type(characterName, "现场负责人{Enter}");
  expect(
    screen.getByRole("button", { name: "双击编辑角色名称：现场负责人" }),
  ).toBeVisible();

  await openAssetSection(user, "场景");
  await user.dblClick(
    screen.getByRole("button", { name: "双击编辑场景名称：夜间研究所" }),
  );
  const sceneName = screen.getByRole("textbox", { name: "编辑场景名称" });
  await user.clear(sceneName);
  await user.type(sceneName, "废弃研究所{Enter}");
  expect(
    screen.getByRole("button", { name: "双击编辑场景名称：废弃研究所" }),
  ).toBeVisible();

  await user.click(screen.getByRole("button", { name: "雨夜告白 0 个差分" }));
  await user.dblClick(
    screen.getByRole("button", { name: "双击编辑CG 名称：雨夜告白" }),
  );
  const cgName = screen.getByRole("textbox", { name: "编辑CG 名称" });
  await user.clear(cgName);
  await user.type(cgName, "天台重逢{Enter}");

  await waitFor(
    () => {
      const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
      expect(saved?.characters?.[0].name).toBe("现场负责人");
      expect(saved?.scenes?.[0].name).toBe("废弃研究所");
      expect(saved?.cgs?.[0].name).toBe("天台重逢");
    },
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
    name: "夜间研究所 0 层",
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
  await user.click(screen.getByRole("button", { name: "雨夜告白 0 个差分" }));
  expect(screen.getByLabelText("CG 名称")).toHaveValue("雨夜告白");
  expect(screen.queryByRole("button", { name: "图层定位" })).toBeNull();

  await user.clear(screen.getByLabelText("搜索场景和 CG"));
  await user.click(screen.getByRole("button", { name: "夜间研究所 0 层" }));
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
  expect(roofMenu.parentElement).toHaveClass("galgame-editor-page");
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
}, 15_000);

test("downloads the active scene layer and CG variant from item menus", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      assets: [
        {
          id: "asset-room",
          type: "image",
          role: "sceneLayer",
          fileId: "file-room",
          status: "ready",
        },
        {
          id: "asset-window",
          type: "image",
          role: "sceneLayer",
          fileId: "file-window",
          status: "ready",
        },
        {
          id: "asset-cg-default",
          type: "image",
          role: "storyCg",
          fileId: "file-cg-default",
          status: "ready",
        },
        {
          id: "asset-cg-smile",
          type: "image",
          role: "storyCg",
          fileId: "file-cg-smile",
          status: "ready",
        },
      ],
      scenes: [
        {
          id: "scene-room",
          name: "实验室",
          description: "",
          layers: [
            {
              id: "layer-room",
              name: "房间",
              assetId: "asset-room",
              distance: 1,
              offsetX: 0,
              offsetY: 0,
            },
            {
              id: "layer-window",
              name: "窗光",
              assetId: "asset-window",
              distance: 0.8,
              offsetX: 0,
              offsetY: 0,
            },
          ],
        },
        {
          id: "scene-empty",
          name: "空场景",
          description: "",
          layers: [],
        },
      ],
      cgs: [
        {
          id: "cg-multi",
          name: "多差分 CG",
          description: "",
          variants: [
            {
              id: "variant-default",
              label: "默认",
              assetId: "asset-cg-default",
            },
            {
              id: "variant-smile",
              label: "微笑",
              assetId: "asset-cg-smile",
            },
          ],
          defaultVariantId: "variant-default",
        },
      ],
    },
  });
  const downloadedNames: string[] = [];
  const anchorClick = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      downloadedNames.push(this.download);
    });
  renderEditor();
  await screen.findByText("纵向切片");
  await openAssetSection(user, "场景");

  await user.click(screen.getByDisplayValue("窗光").closest("article")!);
  await user.click(screen.getByRole("button", { name: "更多操作 实验室" }));
  let finishFirstDownload!: (download: {
    blob: Blob;
    filename: string | null;
  }) => void;
  vi.mocked(fetchApiDownload).mockReturnValueOnce(
    new Promise((resolve) => {
      finishFirstDownload = resolve;
    }),
  );
  const firstDownload = screen.getByRole("menuitem", { name: "下载图片" });
  await user.click(firstDownload);
  expect(firstDownload).toBeDisabled();
  await user.click(firstDownload);
  expect(fetchApiDownload).toHaveBeenCalledTimes(1);
  finishFirstDownload({
    blob: new Blob(["window"], { type: "image/png" }),
    filename: "窗光.png",
  });
  await waitFor(() =>
    expect(fetchApiDownload).toHaveBeenLastCalledWith(
      "/v1/files/file-window/download",
      expect.objectContaining({ onProgress: expect.any(Function) }),
    ),
  );
  expect(anchorClick).toHaveBeenCalledTimes(1);
  expect(downloadedNames).toEqual(["窗光.png"]);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:editor-audio");

  await user.click(screen.getByRole("button", { name: "更多操作 多差分 CG" }));
  await user.click(screen.getByRole("menuitem", { name: "下载图片" }));
  await waitFor(() =>
    expect(fetchApiDownload).toHaveBeenLastCalledWith(
      "/v1/files/file-cg-default/download",
      expect.objectContaining({ onProgress: expect.any(Function) }),
    ),
  );

  await user.click(screen.getByRole("button", { name: /多差分 CG 2 个差分/ }));
  await user.click(screen.getByDisplayValue("微笑").closest("article")!);
  await user.click(screen.getByRole("button", { name: "更多操作 多差分 CG" }));
  await user.click(screen.getByRole("menuitem", { name: "下载图片" }));
  await waitFor(() =>
    expect(fetchApiDownload).toHaveBeenLastCalledWith(
      "/v1/files/file-cg-smile/download",
      expect.objectContaining({ onProgress: expect.any(Function) }),
    ),
  );

  await user.click(screen.getByRole("button", { name: "更多操作 空场景" }));
  expect(screen.getByRole("menuitem", { name: "下载图片" })).toBeDisabled();

  await user.keyboard("{Escape}");
  vi.mocked(fetchApiDownload).mockRejectedValueOnce(new Error("下载网络失败"));
  await user.click(screen.getByRole("button", { name: "更多操作 多差分 CG" }));
  await user.click(screen.getByRole("menuitem", { name: "下载图片" }));
  expect(await screen.findByRole("status")).toHaveTextContent("下载网络失败");
  anchorClick.mockRestore();
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
  await user.click(await screen.findByRole("button", { name: "视频素材" }));
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
  await user.click(screen.getByRole("button", { name: "添加第一个 Block" }));
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
