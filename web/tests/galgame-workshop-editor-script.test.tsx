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

  expect(await screen.findByText("对白 · 白羽")).toBeInTheDocument();
  expect(screen.getByText("（未选择语音）")).toBeInTheDocument();
  expect(screen.getByLabelText("对白正文")).not.toBeVisible();
  await user.click(screen.getByText("高级设置", { selector: "summary" }));
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

test("auto-matches voice only for the selected dialogue", async () => {
  const user = userEvent.setup();
  const dialogueDocument = {
    ...story.document,
    characters: [{ id: "hero", name: "白羽", description: "" }],
    chapters: [
      {
        ...story.document.chapters[0],
        fragments: [
          {
            id: "main",
            title: "对白检查器",
            blocks: [
              {
                id: "line",
                type: "dialogue" as const,
                characterId: "hero",
                text: "第一句",
                voiceVolume: 100,
              },
              {
                id: "other-line",
                type: "dialogue" as const,
                characterId: "hero",
                text: "第二句",
                voiceVolume: 100,
              },
            ],
          },
        ],
      },
    ],
  };
  vi.mocked(getGalgameStoryDocument)
    .mockResolvedValueOnce({ ...story, document: dialogueDocument })
    .mockResolvedValueOnce({
      ...story,
      revision: 2,
      document: {
        ...dialogueDocument,
        assets: [
          {
            id: "matched-voice",
            type: "audio",
            role: "voiceLine",
            label: "自动匹配语音",
            fileId: "voice-file",
            status: "ready",
          },
        ],
        chapters: [
          {
            ...dialogueDocument.chapters[0],
            fragments: [
              {
                ...dialogueDocument.chapters[0].fragments[0],
                blocks: [
                  {
                    ...dialogueDocument.chapters[0].fragments[0].blocks[0],
                    voiceAssetId: "matched-voice",
                  },
                  dialogueDocument.chapters[0].fragments[0].blocks[1],
                ],
              },
            ],
          },
        ],
      },
    });
  vi.mocked(matchGalgameVoiceDialogue).mockResolvedValueOnce({
    storyRevision: 2,
    matches: [{ assetId: "voice-file", blockId: "line", similarity: 1 }],
    unmatchedAssetIds: [],
  });

  renderEditor();
  expect(await screen.findByText("对白 · 白羽")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "自动匹配" }));

  await waitFor(() =>
    expect(matchGalgameVoiceDialogue).toHaveBeenCalledWith(
      "project-1",
      1,
      undefined,
      ["line"],
    ),
  );
  expect(await screen.findByText("自动匹配语音")).toBeInTheDocument();
  expect(screen.getByText("已为当前对白自动匹配语音。")).toBeInTheDocument();
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

test("uses the character initial when a dialogue avatar has no portrait", async () => {
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      characters: [
        {
          id: "character-one",
          name: "冈部伦太郎",
          description: "",
          expressions: [],
          defaultExpressionId: null,
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
                  id: "dialogue",
                  type: "dialogue",
                  characterId: "character-one",
                  text: "闭嘴，助手！",
                },
              ],
            },
          ],
        },
      ],
    },
  });

  const { container } = renderEditor();
  await screen.findAllByText("闭嘴，助手！");

  const avatar = container.querySelector(".galgame-dialogue-avatar");
  expect(avatar).toHaveTextContent("冈");
  expect(avatar?.querySelector("b")).toBeInTheDocument();
});

test("applies a changed character default expression to old default-pinned dialogue", async () => {
  const user = userEvent.setup();
  vi.mocked(getGalgameStoryDocument).mockResolvedValueOnce({
    ...story,
    document: {
      ...story.document,
      assets: [
        {
          id: "portrait-calm",
          type: "image",
          role: "characterPortrait",
          fileId: "file-calm",
          status: "ready",
        },
        {
          id: "portrait-smile",
          type: "image",
          role: "characterPortrait",
          fileId: "file-smile",
          status: "ready",
        },
      ],
      characters: [
        {
          id: "character-one",
          name: "调查员",
          description: "",
          expressions: [
            { id: "calm", label: "平静", assetId: "portrait-calm" },
            { id: "smile", label: "微笑", assetId: "portrait-smile" },
          ],
          defaultExpressionId: "calm",
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
                  id: "dialogue",
                  type: "dialogue",
                  characterId: "character-one",
                  expressionId: "calm",
                  text: "默认表情测试",
                },
              ],
            },
          ],
        },
      ],
    },
  });

  const { container } = renderEditor();
  await screen.findByText("纵向切片");
  await openAssetSection(user, "角色");
  await user.click(screen.getByRole("button", { name: /微笑$/ }));
  await user.click(screen.getByRole("button", { name: "设为默认" }));

  await waitFor(() => {
    const saved = vi.mocked(putGalgameStoryDocument).mock.calls.at(-1)?.[1];
    expect(saved?.characters?.[0].defaultExpressionId).toBe("smile");
    expect(saved?.chapters?.[0].fragments?.[0].blocks?.[0]).toMatchObject({
      expressionId: null,
    });
  });

  const workspace = screen.getByRole("navigation", { name: "创作工作区" });
  await user.click(within(workspace).getByRole("button", { name: "剧本" }));
  expect(
    container.querySelector(
      '.galgame-dialogue-card [data-file-id="file-smile"]',
    ),
  ).toBeInTheDocument();
});
