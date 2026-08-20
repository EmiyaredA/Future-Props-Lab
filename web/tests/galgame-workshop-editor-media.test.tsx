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

function createDragDataTransfer() {
  const values = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "none",
    files: [],
    items: [],
    types: [],
    clearData: (format?: string) => {
      if (format) values.delete(format);
      else values.clear();
    },
    getData: (format: string) => values.get(format) ?? "",
    setData: (format: string, value: string) => values.set(format, value),
    setDragImage: vi.fn(),
  } as unknown as DataTransfer;
}

function fireVerticalDragEvent(
  element: Element,
  type: "dragover" | "drop",
  dataTransfer: DataTransfer,
  clientY: number,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientY: { value: clientY },
    dataTransfer: { value: dataTransfer },
  });
  fireEvent(element, event);
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

test("reorders character and expression cards by dragging above or below a target", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      characters: [
        {
          id: "character-a",
          name: "角色甲",
          description: "",
          expressions: [
            { id: "calm", label: "平静", assetId: "portrait-calm" },
            { id: "smile", label: "微笑", assetId: "portrait-smile" },
            { id: "surprised", label: "惊讶", assetId: "portrait-surprised" },
          ],
          defaultExpressionId: "calm",
        },
        {
          id: "character-b",
          name: "角色乙",
          description: "",
          expressions: [],
          defaultExpressionId: null,
        },
        {
          id: "character-c",
          name: "角色丙",
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

  const characterList = container.querySelector<HTMLElement>(
    ".galgame-character-list",
  )!;
  const characterA = within(characterList).getByRole("button", {
    name: /角色甲/,
  });
  const characterDrag = createDragDataTransfer();
  fireEvent.dragStart(characterA, { dataTransfer: characterDrag });
  const characterCDropTarget = within(characterList).getByRole("button", {
    name: /角色丙/,
  });
  vi.spyOn(characterCDropTarget, "getBoundingClientRect").mockReturnValue({
    top: -100,
    bottom: 0,
    height: 100,
  } as DOMRect);
  fireVerticalDragEvent(characterCDropTarget, "dragover", characterDrag, 90);
  expect(characterCDropTarget).toHaveClass("is-drop-after");
  fireVerticalDragEvent(characterCDropTarget, "drop", characterDrag, 90);
  expect(
    within(characterList)
      .getAllByRole("button")
      .map((item) => item.textContent?.match(/角色[甲乙丙]/)?.[0]),
  ).toEqual(["角色乙", "角色丙", "角色甲"]);

  const characterUpDrag = createDragDataTransfer();
  fireEvent.dragStart(
    within(characterList).getByRole("button", { name: /角色丙/ }),
    { dataTransfer: characterUpDrag },
  );
  const characterBDropTarget = within(characterList).getByRole("button", {
    name: /角色乙/,
  });
  vi.spyOn(characterBDropTarget, "getBoundingClientRect").mockReturnValue({
    top: 0,
    bottom: 100,
    height: 100,
  } as DOMRect);
  fireVerticalDragEvent(characterBDropTarget, "dragover", characterUpDrag, 10);
  expect(characterBDropTarget).toHaveClass("is-drop-before");
  fireVerticalDragEvent(characterBDropTarget, "drop", characterUpDrag, 10);

  const expressionGrid = container.querySelector<HTMLElement>(
    ".galgame-expression-grid",
  )!;
  const calm = within(expressionGrid).getByRole("button", { name: /平静/ });
  const expressionDrag = createDragDataTransfer();
  fireEvent.dragStart(calm, { dataTransfer: expressionDrag });
  const surprisedDropTarget = within(expressionGrid).getByRole("button", {
    name: /惊讶/,
  });
  vi.spyOn(surprisedDropTarget, "getBoundingClientRect").mockReturnValue({
    top: -100,
    bottom: 0,
    height: 100,
  } as DOMRect);
  fireVerticalDragEvent(surprisedDropTarget, "dragover", expressionDrag, 90);
  expect(surprisedDropTarget).toHaveClass("is-drop-after");
  fireVerticalDragEvent(surprisedDropTarget, "drop", expressionDrag, 90);

  await waitFor(
    () => {
      const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
      expect(saved?.characters?.map((character) => character.id)).toEqual([
        "character-c",
        "character-b",
        "character-a",
      ]);
      expect(
        saved?.characters
          ?.find((character) => character.id === "character-a")
          ?.expressions?.map((expression) => expression.id),
      ).toEqual(["smile", "surprised", "calm"]);
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
}, 15_000);

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
  await user.click(await screen.findByLabelText("CG 画面适配"));
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
}, 10_000);

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
  await user.click(screen.getByText("高级设置", { selector: "summary" }));
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

test("uses the aligned sound inspector controls for audio blocks", async () => {
  const user = userEvent.setup();
  const audioStory = structuredClone(story) as unknown as GalgameStoryDocument;
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
  ];
  audioStory.document.chapters![0].fragments![0].blocks = [
    {
      id: "bgm-one",
      type: "audio",
      action: "play",
      channel: "bgm",
      assetId: "bgm-rain",
      volume: 70,
      loop: true,
      fadeMs: 1000,
    },
  ];
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce(audioStory);
  localStorage.setItem("future_props_galgame_editor_script_view", "blocks");
  const rendered = renderEditor();
  await screen.findAllByText("雨夜咖啡馆");

  await user.click(
    rendered.container.querySelector<HTMLButtonElement>(
      '[data-block-id="bgm-one"] .galgame-block-select',
    )!,
  );

  const actionTabs = await screen.findByRole("group", { name: "声音动作" });
  expect(
    within(actionTabs).getByRole("button", { name: "播放 / 切换" }),
  ).toHaveAttribute("aria-pressed", "true");
  const typeTabs = await screen.findByRole("group", { name: "声音类型" });
  expect(
    within(typeTabs).getByRole("button", { name: "背景音乐 BGM" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("声音素材")).toHaveTextContent("雨夜咖啡馆");
  expect(screen.getByLabelText("音轨 ID")).toHaveValue("bgm");
  expect(screen.getByLabelText("播放音量")).toHaveValue(70);
  expect(screen.getByRole("checkbox", { name: "循环播放" })).toBeChecked();
  expect(screen.getByLabelText("淡入时间")).toHaveValue(1000);

  await user.click(within(typeTabs).getByRole("button", { name: "音效 SE" }));
  expect(screen.getByLabelText("声音素材")).toHaveTextContent("开门");
  expect(screen.getByLabelText("音轨 ID")).toHaveValue("sfx");
  expect(screen.getByLabelText("播放音量")).toHaveValue(100);
  expect(screen.getByRole("checkbox", { name: "循环播放" })).not.toBeChecked();
  expect(screen.getByLabelText("淡入时间")).toHaveValue(0);

  await waitFor(
    () => {
      const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
      expect(saved?.chapters?.[0].fragments?.[0].blocks?.[0]).toMatchObject({
        type: "audio",
        channel: "sfx",
        assetId: "sfx-door",
        volume: 100,
        loop: false,
        fadeMs: 0,
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
  await user.click(screen.getByText("高级设置", { selector: "summary" }));
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
  expect(await screen.findByLabelText("登场或调整角色")).toHaveTextContent(
    "调查员",
  );
  await user.click(screen.getByLabelText("角色位置预设"));
  await user.click(screen.getByRole("option", { name: "左" }));
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
        distance: "medium",
        positionId: "position-left",
        transform: { brightness: 1.4 },
      });
    },
    { timeout: 2000 },
  );
  expect(container.querySelector('[data-character-id="hero"]')).toHaveStyle({
    left: "25%",
  });
  expect(screen.queryByLabelText("角色X 位置数值")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("角色Y 位置数值")).not.toBeInTheDocument();
  expect(
    screen.getByText(/坐标、锚点和基准尺寸遵循角色资产/),
  ).toBeInTheDocument();
  const previewActor = container.querySelector('[data-character-id="hero"]');
  expect(previewActor).not.toHaveClass("is-editable");
  expect(previewActor).not.toHaveAttribute("tabindex");
  expect(previewActor).not.toHaveAttribute("aria-label", "调整角色 调查员");

  await user.click(screen.getByRole("button", { name: "在播放头添加内容" }));
  await user.click(screen.getByRole("button", { name: "对白" }));
  await waitFor(
    () => {
      const blocks = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
        .chapters?.[0]?.fragments?.[0]?.blocks;
      expect(blocks?.[1]).toMatchObject({
        type: "dialogue",
        portrait: {
          mode: "stage",
          distance: "medium",
          positionId: "position-left",
          keepAfter: true,
        },
      });
    },
    { timeout: 2000 },
  );
  await user.click(screen.getByRole("button", { name: "卡片" }));
  await user.click(
    await screen.findByRole("button", { name: "人物呈现：中 · 左" }),
  );
  const presentation = screen.getByRole("dialog", { name: "人物呈现" });
  expect(presentation.parentElement).toBe(document.body);
  expect(
    within(presentation).getByRole("button", { name: "极左" }),
  ).toBeInTheDocument();
  expect(
    within(presentation).getByRole("button", { name: "极右" }),
  ).toBeInTheDocument();
  await user.click(within(presentation).getByRole("button", { name: "近" }));
  await user.click(within(presentation).getByRole("button", { name: "极左" }));
  await waitFor(() => {
    const dialogue = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1]
      .chapters?.[0]?.fragments?.[0]?.blocks?.[1];
    expect(dialogue).toMatchObject({
      type: "dialogue",
      portrait: {
        mode: "stage",
        distance: "near",
        positionId: "position-outer-left",
        transform: null,
      },
    });
  });

  await user.click(screen.getByRole("button", { name: "演出" }));
  await user.click(
    await screen.findByRole("button", { name: "在播放头添加内容" }),
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
}, 10_000);
