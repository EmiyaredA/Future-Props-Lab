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
  expect(await screen.findByText("快速预演")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /退出预演/ })).toBeInTheDocument();
  expect(screen.queryByLabelText("预览模式")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "播放编辑时间轴" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("波纹编辑")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("精确设置")).not.toBeInTheDocument();
  expect(editTimelineAudio.pause).toHaveBeenCalled();
  const player = screen.getByRole("region", { name: "游戏预览" });
  expect(within(player).queryByLabelText("试玩控制")).not.toBeInTheDocument();
  expect(screen.getByText(/步骤 1 \/ 2/)).toBeInTheDocument();
  expect(await screen.findAllByText("右侧属性已更新")).not.toHaveLength(0);
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
