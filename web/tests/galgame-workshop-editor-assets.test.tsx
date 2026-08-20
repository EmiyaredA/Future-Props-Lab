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
  await user.click(screen.getByRole("button", { name: /资源引用 1/ }));
  expect(screen.getByRole("button", { name: "删除角色" })).toBeDisabled();
  expect(screen.getByText("角色仍被对白引用，无法删除。")).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", {
      name: /第一章 · main · Block 2/,
    }),
  );
  await user.click(screen.getByText("高级设置", { selector: "summary" }));
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
  await user.click(screen.getByRole("button", { name: "位置与尺寸" }));
  const stage = screen.getByRole("application", {
    name: "位置与尺寸舞台预览",
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
      ".galgame-stage-preview-actor",
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

  await user.click(screen.getByRole("button", { name: "左上角" }));
  await waitFor(() => {
    const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
    expect(saved?.settings?.characterStage?.anchor).toBe("topLeft");
  });

  await user.click(screen.getByRole("button", { name: "新增位置" }));
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

  await user.click(screen.getByRole("button", { name: /^设为默认位置$/ }));
  await user.click(screen.getByRole("button", { name: "删除位置预设" }));
  expect(
    screen.queryByRole("button", { name: /近景改名/ }),
  ).not.toBeInTheDocument();

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

test("opens stage settings for the currently selected character", async () => {
  const user = userEvent.setup();
  const scopedStory = structuredClone(story) as GalgameStoryDocument;
  scopedStory.document.characters = [
    {
      id: "character-one",
      name: "角色甲",
      description: "",
      expressions: [],
      defaultExpressionId: null,
    },
    {
      id: "character-two",
      name: "角色乙",
      description: "",
      expressions: [],
      defaultExpressionId: null,
    },
  ];
  localStorage.setItem(
    "future_props_galgame_character_stage_scope:project-1",
    "character-one",
  );
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce(scopedStory);

  renderEditor();
  await screen.findByText("纵向切片");
  await openAssetSection(user, "角色");
  await user.click(
    screen.getByRole("button", { name: /角色乙 0 个表情 · 0 处引用/ }),
  );
  await user.click(screen.getByRole("button", { name: "位置与尺寸" }));

  expect(screen.getByRole("button", { name: /角色乙 跟随全局/ })).toBeVisible();
  expect(
    localStorage.getItem(
      "future_props_galgame_character_stage_scope:project-1",
    ),
  ).toBe("character-two");
});

test("creates and removes an independent character stage scheme", async () => {
  const user = userEvent.setup();
  const scopedStory = structuredClone(story) as GalgameStoryDocument;
  scopedStory.document.characters = [
    {
      id: "character-one",
      name: "调查员",
      description: "",
      expressions: [],
      defaultExpressionId: null,
    },
  ];
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce(scopedStory);

  renderEditor();
  await screen.findByText("纵向切片");
  await openAssetSection(user, "角色");
  await user.click(screen.getByRole("button", { name: "位置与尺寸" }));
  await user.click(screen.getByRole("button", { name: /全局 固定/ }));
  await user.click(screen.getByRole("option", { name: /调查员 跟随全局/ }));
  expect(screen.getByText("当前角色正在跟随全局方案。")).toBeVisible();

  await user.click(screen.getAllByRole("button", { name: /创建独立方案/ })[0]);
  await waitFor(() => {
    const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
    expect(
      saved?.settings?.characterStageOverrides?.["character-one"],
    ).toMatchObject({
      anchor: "center",
      defaultHeightPercent: 100,
      defaultPositionId: "position-center",
    });
  });

  const assetNavigation = screen.getByText("资产中心").closest("aside")!;
  await user.click(
    within(assetNavigation).getByRole("button", { name: "场景" }),
  );
  await user.click(
    within(assetNavigation).getByRole("button", { name: "角色" }),
  );
  await user.click(screen.getByRole("button", { name: "位置与尺寸" }));
  expect(screen.getByRole("button", { name: /调查员 独立/ })).toBeVisible();

  fireEvent.change(screen.getByLabelText("默认画面高度"), {
    target: { value: "135" },
  });
  await waitFor(() => {
    const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
    expect(
      saved?.settings?.characterStageOverrides?.["character-one"]
        ?.defaultHeightPercent,
    ).toBe(135);
    expect(saved?.settings?.characterStage?.defaultHeightPercent).toBe(100);
  });

  await user.click(screen.getByRole("button", { name: "删除角色独立方案" }));
  await user.click(screen.getByRole("button", { name: /^删除独立方案$/ }));
  await waitFor(() => {
    const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
    expect(
      saved?.settings?.characterStageOverrides?.["character-one"],
    ).toBeUndefined();
  });
});

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
  await user.click(screen.getByRole("button", { name: "位置与尺寸" }));

  await waitFor(() => {
    const footprint = container.querySelector<HTMLElement>(
      ".galgame-stage-preview-actor",
    );
    expect(footprint).toHaveClass("is-center");
    expect(footprint).toHaveStyle({ width: "28.125%", height: "100%" });
    expect(footprint).toHaveAttribute(
      "title",
      "原图 400 × 800px · 方案基准 100%",
    );
  });

  const preview = container.querySelector<HTMLElement>(
    ".galgame-stage-preview-actor",
  );
  expect(preview).toHaveStyle({
    width: "28.125%",
    height: "100%",
    transform: "translate(-50%, -50%) scaleX(1)",
  });

  await user.click(screen.getByRole("button", { name: "左上角" }));
  expect(container.querySelector(".galgame-stage-preview-actor")).toHaveClass(
    "is-topLeft",
  );
  expect(preview).toHaveStyle({ transform: "translate(0, 0) scaleX(1)" });
}, 15_000);

test("applies expression thumbnail crops to character and expression cards", async () => {
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
          thumbnailCrop: { x: 42, y: 18, scale: 2.7 },
        },
      ],
      defaultExpressionId: "expression-default",
    },
  ];
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce(portraitStory);

  const { container } = renderEditor();
  await screen.findByText("纵向切片");
  await openAssetSection(user, "角色");

  const avatar = container.querySelector<HTMLElement>(
    ".galgame-character-avatar",
  );
  const expressionThumbnail = container.querySelector<HTMLElement>(
    ".galgame-expression-grid > button > span",
  );
  for (const thumbnail of [avatar, expressionThumbnail]) {
    expect(thumbnail?.style.getPropertyValue("--thumbnail-x")).toBe("42%");
    expect(thumbnail?.style.getPropertyValue("--thumbnail-y")).toBe("18%");
    expect(thumbnail?.style.getPropertyValue("--thumbnail-scale")).toBe("2.7");
  }
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
  vi.mocked(getGalgameProjectAssets).mockResolvedValue({
    items: [
      {
        id: "file-default",
        display_name: "default.png",
        media_kind: "image",
        mime_type: "image/png",
        byte_size: 1024,
        revision: 0,
        created_at: "2026-08-19T00:00:00Z",
        updated_at: "2026-08-19T00:00:00Z",
        width: 800,
        height: 1200,
      } as GalgameProjectAsset,
    ],
  });
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
  const defaultPreviewPortrait = rendered.container.querySelector<HTMLElement>(
    '.galgame-character-preview-stage [data-file-id="file-default"]',
  );
  expect(defaultPreviewPortrait).toBeInTheDocument();
  expect(screen.queryByDisplayValue("平静")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /惊讶$/ }));
  expect(screen.queryByDisplayValue("惊讶")).not.toBeVisible();
  expect(screen.getByText("对白头像已关闭")).toBeVisible();
  await user.click(screen.getByRole("checkbox", { name: "对白头像" }));
  await waitFor(() => {
    const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
    expect(saved?.characters?.[0].dialogueAvatar?.enabled).toBe(true);
  });
  expect(
    rendered.container.querySelector(
      '.galgame-character-preview-stage [data-file-id="file-default"]',
    ),
  ).toBeInTheDocument();

  const expressionSettings = rendered.container.querySelector<HTMLElement>(
    ".galgame-expression-form",
  );
  if (!expressionSettings) throw new Error("missing expression settings");
  for (const heading of [
    "舞台显示",
    "立绘尺寸",
    "对白头像",
    "高级设置",
    "资源操作",
  ])
    expect(within(expressionSettings).getByText(heading)).toBeVisible();
  expect(within(expressionSettings).queryByText("基本信息")).not.toBeVisible();
  expect(
    within(expressionSettings).getByLabelText("对白头像来源"),
  ).toBeVisible();
  expect(
    within(expressionSettings).getByRole("button", { name: "替换图片" }),
  ).toBeVisible();
  expect(
    within(expressionSettings).getByRole("button", { name: "静态图片" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    within(expressionSettings).getByRole("button", { name: "Spine" }),
  ).toBeDisabled();
  expect(
    within(expressionSettings).getByRole("button", { name: "Live2D" }),
  ).toBeDisabled();

  await user.click(
    within(expressionSettings).getByRole("button", { name: "序列帧" }),
  );
  await waitFor(() => {
    const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
    expect(saved?.characters?.[0].expressions?.[1]).toMatchObject({
      renderMode: "frameSequence",
      sequence: {
        playbackMode: "timed",
        fps: 2,
        loop: true,
        frames: [{ assetId: "portrait-alt" }],
      },
    });
  });
  const fpsSlider = within(expressionSettings).getByRole("slider", {
    name: "播放帧率滑杆",
  });
  expect(fpsSlider).toHaveValue("2");
  expect(fpsSlider.parentElement).toHaveClass("galgame-expression-fps-slider");
  expect(fpsSlider.parentElement).toHaveStyle({
    "--sequence-ratio": `${1 / 59}`,
  });
  expect(
    within(expressionSettings).getByRole("region", {
      name: "序列帧预览",
    }),
  ).toBeVisible();
  const sequenceStageActor = rendered.container.querySelector<HTMLElement>(
    ".galgame-expression-stage-actor",
  );
  expect(sequenceStageActor).toHaveAttribute("data-position", "50,50");
  expect(sequenceStageActor).toHaveAttribute("data-size", "100");
  expect(sequenceStageActor).toHaveStyle({
    width: "37.5%",
    height: "100%",
    transform: "translate(-50%, -50%)",
  });
  expect(
    rendered.container.querySelector(".galgame-character-workspace"),
  ).toHaveClass("is-expression-detail");
  expect(screen.getByRole("button", { name: "资源引用" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  fireEvent.change(
    within(expressionSettings).getByRole("slider", {
      name: "播放帧率滑杆",
    }),
    { target: { value: "13" } },
  );
  await user.click(
    within(expressionSettings).getByRole("checkbox", { name: "循环播放" }),
  );
  await user.click(
    within(expressionSettings).getByRole("combobox", {
      name: "从已有表情添加帧",
    }),
  );
  await user.click(screen.getByRole("option", { name: "平静" }));
  await waitFor(() => {
    const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
    expect(saved?.characters?.[0].expressions?.[1].sequence).toMatchObject({
      playbackMode: "timed",
      fps: 13,
      loop: false,
      frames: [{ assetId: "portrait-alt" }, { assetId: "portrait-default" }],
    });
  });
  await user.click(
    within(expressionSettings).getByRole("button", { name: "语音口型" }),
  );
  expect(
    screen.getByText("语音口型需要依次准备闭口、半口和张口三帧。"),
  ).toBeVisible();
  await user.click(
    within(expressionSettings).getByRole("combobox", {
      name: "从已有表情添加帧",
    }),
  );
  await user.click(screen.getByRole("option", { name: "平静" }));
  await user.click(
    within(expressionSettings).getByRole("button", { name: "语音口型" }),
  );
  await waitFor(() => {
    const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
    expect(saved?.characters?.[0].expressions?.[1].sequence).toMatchObject({
      playbackMode: "lipSync",
      fps: 13,
      frames: [
        { assetId: "portrait-alt" },
        { assetId: "portrait-default" },
        { assetId: "portrait-default" },
      ],
    });
  });
  expect(
    within(expressionSettings).queryByRole("checkbox", { name: "循环播放" }),
  ).not.toBeInTheDocument();
  expect(within(expressionSettings).getByText("语音驱动")).toBeVisible();
  expect(
    within(expressionSettings).getByRole("combobox", {
      name: "从已有表情添加帧",
    }),
  ).toBeDisabled();
  await user.click(
    within(expressionSettings).getByRole("button", { name: "静态图片" }),
  );
  const modeDialog = screen.getByRole("alertdialog", {
    name: "切换为静态图片？",
  });
  await user.click(
    within(modeDialog).getByRole("button", { name: "保留首帧并切换" }),
  );
  await waitFor(() => {
    const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
    expect(saved?.characters?.[0].expressions?.[1].renderMode).toBe(
      "staticImage",
    );
    expect(saved?.characters?.[0].expressions?.[1].sequence).toBeUndefined();
  });

  await user.click(
    within(expressionSettings).getByRole("checkbox", { name: "左右翻转" }),
  );
  await waitFor(() => {
    const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
    expect(saved?.characters?.[0].expressions?.[1].flipX).toBe(true);
  });
  expect(
    rendered.container.querySelector(".galgame-portrait-stage-composite"),
  ).toHaveStyle({ transform: "scaleX(-1)" });
  expect(
    rendered.container.querySelector(
      ".galgame-expression-grid > button.active > span",
    ),
  ).not.toHaveStyle({ transform: "scaleX(-1)" });

  await user.click(
    within(expressionSettings).getByRole("button", { name: "自定义" }),
  );
  const customHeight = within(expressionSettings).getByRole("spinbutton", {
    name: "自定义画面高度",
  });
  fireEvent.change(customHeight, { target: { value: "175" } });
  await waitFor(() => {
    const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
    expect(saved?.characters?.[0].expressions?.[1].heightPercent).toBe(175);
  });
  await user.click(within(expressionSettings).getByText("高级设置"));
  expect(within(expressionSettings).getByText("基本信息")).toBeVisible();
  expect(within(expressionSettings).getByDisplayValue("惊讶")).toBeVisible();
  expect(
    within(expressionSettings).getByRole("spinbutton", {
      name: "缩略图裁剪 X",
    }),
  ).toBeVisible();

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
}, 20_000);

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
  const emptyState = screen
    .getByText("这个 Fragment 还没有 Block")
    .closest<HTMLElement>(".galgame-empty-blocks")!;
  emptyState.focus();
  fireEvent.keyDown(emptyState, { key: "Tab" });
  expect(
    screen.getByRole("dialog", { name: "插入 Block" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "旁白" }));

  expect((await screen.findAllByLabelText("旁白正文")).length).toBeGreaterThan(
    0,
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

test("opens one Block command palette from the selected card and inserts before it", async () => {
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
                { id: "first", type: "narration", text: "第一段" },
                { id: "second", type: "narration", text: "第二段" },
              ],
            },
          ],
        },
      ],
    },
  });
  const { container } = renderEditor();
  expect((await screen.findAllByText("第一段")).length).toBeGreaterThan(0);

  expect(
    screen.queryByRole("button", { name: "在这里插入 Block" }),
  ).not.toBeInTheDocument();
  const firstCard = container.querySelector<HTMLElement>(
    '[data-block-id="first"]',
  )!;
  await user.click(firstCard);
  expect(firstCard).toHaveClass("selected");
  fireEvent.keyDown(firstCard, { key: "Tab", shiftKey: true });
  expect(
    screen.queryByRole("dialog", { name: "插入 Block" }),
  ).not.toBeInTheDocument();

  fireEvent.keyDown(firstCard, { key: "Tab" });
  const palette = screen.getByRole("dialog", { name: "插入 Block" });
  expect(palette).toBeInTheDocument();
  const search = screen.getByLabelText("搜索可插入 Block");
  await waitFor(() => expect(search).toHaveFocus());
  fireEvent.keyDown(search, { key: "ArrowDown" });
  expect(
    within(palette).getByRole("button", { name: "本句后隐藏对话框" }),
  ).toHaveFocus();
  await user.click(
    within(palette).getByRole("button", { name: "在右侧属性中编辑" }),
  );
  expect(
    screen.queryByRole("dialog", { name: "插入 Block" }),
  ).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText("旁白正文")).toHaveFocus());

  firstCard.focus();
  fireEvent.keyDown(firstCard, { key: "Tab" });
  const reopenedPalette = screen.getByRole("dialog", { name: "插入 Block" });
  const reopenedSearch =
    within(reopenedPalette).getByLabelText("搜索可插入 Block");
  await waitFor(() => expect(reopenedSearch).toHaveFocus());
  await user.type(reopenedSearch, "注释");
  expect(screen.getByRole("button", { name: "注释" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "旁白" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "注释" }));

  await waitFor(() => {
    const blocks = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
      .chapters?.[0].fragments?.[0].blocks;
    expect(blocks?.map((block) => block.type)).toEqual([
      "comment",
      "narration",
      "narration",
    ]);
  });

  await user.click(firstCard);
  expect(firstCard).toHaveClass("selected");
  fireEvent.keyDown(firstCard, { key: "Tab" });
  fireEvent.keyDown(window, { key: "Escape" });
  expect(
    screen.queryByRole("dialog", { name: "插入 Block" }),
  ).not.toBeInTheDocument();
  await waitFor(() => expect(firstCard).toHaveFocus());

  fireEvent.keyDown(firstCard, { key: "Tab" });
  const backdrop = document.querySelector<HTMLElement>(
    ".galgame-block-command-backdrop",
  )!;
  fireEvent.pointerDown(backdrop);
  expect(
    screen.queryByRole("dialog", { name: "插入 Block" }),
  ).not.toBeInTheDocument();

  await user.dblClick(firstCard);
  const textEditor = within(firstCard).getByLabelText("旁白正文");
  fireEvent.keyDown(textEditor, { key: "Tab" });
  expect(
    screen.queryByRole("dialog", { name: "插入 Block" }),
  ).not.toBeInTheDocument();
});

test("edits dedicated curtain and wait cards from cards, inspector, and Tab context", async () => {
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
                {
                  id: "curtain-one",
                  type: "curtain" as const,
                  mode: "fullscreen" as const,
                  action: "show" as const,
                  color: "#000000",
                  opacity: 1,
                  durationMs: 400,
                  waitForCompletion: false,
                },
                {
                  id: "wait-one",
                  type: "wait" as const,
                  mode: "duration" as const,
                  durationMs: 1000,
                },
              ],
            },
          ],
        },
      ],
    },
  });
  const { container } = renderEditor();
  await screen.findByText("渐入幕布");

  const curtainCard = container.querySelector<HTMLElement>(
    '[data-block-id="curtain-one"]',
  )!;
  expect(within(curtainCard).getByText("全屏")).toBeInTheDocument();
  await user.click(curtainCard);
  expect(screen.getByRole("group", { name: "幕布模式" })).toBeInTheDocument();
  fireEvent.keyDown(curtainCard, { key: "Tab" });
  const curtainPalette = screen.getByRole("dialog", { name: "插入 Block" });
  expect(within(curtainPalette).getByText("角色")).toBeInTheDocument();
  expect(within(curtainPalette).getByText("文本")).toBeInTheDocument();
  expect(within(curtainPalette).getByText("演出")).toBeInTheDocument();
  expect(within(curtainPalette).getByText("逻辑")).toBeInTheDocument();
  expect(
    within(curtainPalette).getByRole("button", { name: "等待" }),
  ).toBeInTheDocument();
  await user.click(
    within(curtainPalette).getByRole("button", { name: "上下黑边" }),
  );
  expect(
    screen.getByRole("dialog", { name: "插入 Block" }),
  ).toBeInTheDocument();
  await waitFor(() => {
    const blocks = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
      .chapters?.[0].fragments?.[0].blocks;
    expect(blocks?.[0]).toMatchObject({
      type: "curtain",
      mode: "letterbox",
    });
  });
  await user.click(
    within(curtainPalette).getByRole("button", {
      name: "打开（屏幕显露）",
    }),
  );
  fireEvent.keyDown(window, { key: "Escape" });

  const waitCard = container.querySelector<HTMLElement>(
    '[data-block-id="wait-one"]',
  )!;
  await user.click(within(waitCard).getByRole("button", { name: "500" }));
  await waitFor(() => {
    const blocks = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
      .chapters?.[0].fragments?.[0].blocks;
    expect(blocks?.[1]).toMatchObject({
      type: "wait",
      mode: "duration",
      durationMs: 500,
    });
  });
  waitCard.focus();
  fireEvent.keyDown(waitCard, { key: "Tab" });
  const waitPalette = screen.getByRole("dialog", { name: "插入 Block" });
  await user.click(
    within(waitPalette).getByRole("button", { name: "等待玩家继续" }),
  );
  expect(waitPalette).toBeInTheDocument();
  await waitFor(() => {
    const blocks = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
      .chapters?.[0].fragments?.[0].blocks;
    expect(blocks?.[1]).toMatchObject({
      type: "wait",
      mode: "player",
      durationMs: null,
    });
  });
});

test("migrates retired script views and keeps JSON OP as a top-level read-only view", async () => {
  localStorage.setItem("future_props_galgame_editor_script_view", "renpy");
  const user = userEvent.setup();
  renderEditor();

  expect(
    await screen.findByRole("region", { name: "Block 卡片编辑器" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "纯文本" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Ren’Py" }),
  ).not.toBeInTheDocument();
  expect(localStorage.getItem("future_props_galgame_editor_script_view")).toBe(
    "blocks",
  );

  await user.click(screen.getByRole("button", { name: "JSON" }));
  const jsonView = screen.getByRole("region", { name: "JSON OP 只读视图" });
  expect(within(jsonView).getByText("[]")).toBeInTheDocument();
  expect(localStorage.getItem("future_props_galgame_editor_script_view")).toBe(
    "json",
  );
  await user.click(screen.getByRole("button", { name: "复制 JSON" }));
  expect(await navigator.clipboard.readText()).toBe("[]");
  expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "卡片" }));
  expect(
    await screen.findByRole("region", { name: "Block 卡片编辑器" }),
  ).toBeInTheDocument();
});

test("opens the multilingual workbench without saving and persists manual translations", async () => {
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce(branchingStory);
  vi.mocked(getGalgameStoryReport).mockResolvedValueOnce(clearBranchingReport);
  const user = userEvent.setup();
  renderEditor();
  expect(await screen.findByLabelText("Fragment 名称")).toHaveValue(
    "实验室日常",
  );

  const saveCount = vi.mocked(putGalgameStoryDocument).mock.calls.length;
  await user.click(screen.getByRole("button", { name: "多语言" }));
  expect(
    await screen.findByRole("heading", { name: /译稿校对台/ }),
  ).toBeInTheDocument();
  expect(screen.getAllByText("选择调查方向").length).toBeGreaterThan(0);
  expect(screen.getByLabelText("当前目标语言")).toHaveTextContent(
    "English · en-US",
  );
  expect(putGalgameStoryDocument).toHaveBeenCalledTimes(saveCount);

  fireEvent.change(screen.getByLabelText("分支 · 选项提示译文"), {
    target: { value: "Choose a route" },
  });
  expect(screen.getByLabelText("翻译完成 20%")).toBeInTheDocument();
  await waitFor(
    () => {
      const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
      expect(saved?.localizations).toMatchObject({
        sourceLocale: "zh-CN",
        defaultLocale: "zh-CN",
        targets: [
          {
            locale: "en-US",
            entries: [
              expect.objectContaining({
                blockId: "branch-one",
                field: "prompt",
                text: "Choose a route",
              }),
            ],
          },
        ],
      });
    },
    { timeout: 2000 },
  );

  await user.click(screen.getByLabelText("游戏启动语言"));
  await user.click(screen.getByRole("option", { name: /English.*en-US/ }));
  await waitFor(
    () =>
      expect(
        vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1].localizations
          ?.defaultLocale,
      ).toBe("en-US"),
    { timeout: 2000 },
  );
  expect(localStorage.getItem("future_props_galgame_editor_script_view")).toBe(
    "localization",
  );
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
      container.querySelectorAll(".galgame-dialogue-card").item(1),
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
