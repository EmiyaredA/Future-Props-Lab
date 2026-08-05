import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { GalgameWorkshopEditorPage } from "@features/galgame-workshop/editor";
import {
  getGalgameStoryDocument,
  getGalgameStoryReport,
  getGalgameProjectAssets,
  getGalgameWorkshopProject,
  putGalgameStoryDocument,
} from "@features/galgame-workshop/api";
import { ApiError } from "@platform/api/client";

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
  };
});

vi.mock("@features/galgame-workshop/editor/StoryAssetImage", () => ({
  StoryAssetImage: ({ fileId }: { fileId?: string }) => (
    <span data-file-id={fileId ?? ""}>图片</span>
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
  vi.mocked(putGalgameStoryDocument).mockImplementation(
    async (_projectId, document, expectedRevision) => ({
      project_id: "project-1",
      document,
      revision: expectedRevision + 1,
      updated_at: "2026-08-05T09:00:00Z",
    }),
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
  expect(screen.getByLabelText("切换场景")).toHaveValue("scene-one");
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

  await user.click(screen.getAllByRole("button", { name: /^开始试玩$/ })[0]!);
  expect(
    await within(screen.getByRole("region", { name: "游戏预览" })).findByText(
      "右侧属性已更新",
    ),
  ).toBeInTheDocument();
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
  await user.selectOptions(screen.getByLabelText("背景状态"), backgroundId);
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
  await user.selectOptions(screen.getByLabelText("切换场景"), "scene-two");
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
  await user.selectOptions(screen.getByLabelText("切换场景"), "scene-one");
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
