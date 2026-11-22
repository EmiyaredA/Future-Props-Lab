import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import StoryboardWorkspace from "@features/visual-workshop/storyboard/StoryboardWorkspace";
import {
  emptyShot,
  importShots,
  reorderShots,
} from "@features/visual-workshop/storyboard/shotPlans";
import {
  getStoryboard,
  saveStoryboard,
  type Storyboard,
} from "@features/visual-workshop/storyboard/api";
import { cardsKey, scriptKey } from "@features/visual-workshop/creative/api";
import { ProjectCreativeTools } from "@features/visual-workshop/ProjectCreativeTools";
import type { VisualCanvasNode } from "@features/visual-workshop/api";
import { fetchApiBlob } from "@platform/api/client";
import { listPrevis } from "@features/visual-workshop/previs/api";

vi.mock("@features/visual-workshop/previs/api", () => ({
  listPrevis: vi.fn(),
}));

vi.mock("@platform/api/client", async (original) => ({
  ...(await original<typeof import("@platform/api/client")>()),
  fetchApiBlob: vi.fn(),
}));

vi.mock("@features/visual-workshop/storyboard/api", () => ({
  getStoryboard: vi.fn(),
  saveStoryboard: vi.fn(),
}));
vi.mock("@features/visual-workshop/board/OutputPreview", () => ({
  OutputPreview: () => <span>预览</span>,
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listPrevis).mockResolvedValue([]);
  vi.mocked(getStoryboard).mockResolvedValue({ revision: 0, shots: [] });
  vi.mocked(saveStoryboard).mockImplementation(async (_, value) => ({
    ...value,
    revision: value.revision + 1,
  }));
});
function setup(
  document: Storyboard = { revision: 0, shots: [] },
  readOnly = false,
  nodes: VisualCanvasNode[] = [],
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(cardsKey, []);
  client.setQueryData(scriptKey("project"), { revision: 0, episodes: [] });
  vi.mocked(getStoryboard).mockResolvedValue(document);
  const locate = vi.fn();
  const leave = vi.fn();
  const create = vi.fn().mockResolvedValue("new-video");
  const beforeSave = vi.fn().mockResolvedValue(1);
  render(
    <QueryClientProvider client={client}>
      <StoryboardWorkspace
        project="project"
        nodes={nodes}
        projectCardIds={[]}
        onScript={vi.fn()}
        onLocateNode={locate}
        onCreateNode={create}
        beforeSave={beforeSave}
        readOnly={readOnly}
        renderHeader={(_, navigate) => (
          <button onClick={() => navigate(leave)}>返回看板</button>
        )}
      />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), client, locate, leave, create, beforeSave };
}

test("save-and-leave retains the draft on failure and retries with the original revision", async () => {
  const { user, leave, beforeSave } = setup();
  await user.click(await screen.findByRole("button", { name: "新建分镜" }));
  await user.clear(screen.getByLabelText("镜头标题"));
  await user.type(screen.getByLabelText("镜头标题"), "雨夜推门");
  vi.mocked(saveStoryboard).mockRejectedValueOnce(
    new Error("版本冲突，请重新读取"),
  );
  await user.click(screen.getByRole("button", { name: "返回看板" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("版本冲突");
  expect(screen.getByLabelText("镜头标题")).toHaveValue("雨夜推门");
  expect(leave).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "返回看板" }));
  await waitFor(() => expect(leave).toHaveBeenCalledOnce());
  expect(beforeSave).toHaveBeenCalledTimes(2);
  expect(vi.mocked(saveStoryboard).mock.calls[1][1]).toMatchObject({
    revision: 0,
    shots: [{ title: "雨夜推门" }],
  });
});

test("new shots start with a video node and remain an unsaved storyboard draft", async () => {
  const { user, create } = setup();
  await user.click(await screen.findByRole("button", { name: "新建分镜" }));
  await waitFor(() =>
    expect(create).toHaveBeenCalledExactlyOnceWith(
      "video",
      "第1镜",
      expect.objectContaining({ duration: 5, mode: "text" }),
    ),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "保存分镜" })).toBeEnabled(),
  );
  expect(saveStoryboard).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "保存分镜" }));
  await waitFor(() => expect(saveStoryboard).toHaveBeenCalled());
  expect(
    vi.mocked(saveStoryboard).mock.calls[0][1].shots[0].video_node_id,
  ).toBe("new-video");
});

test("creating a production node saves its link before navigation and keeps the link if save fails", async () => {
  const shot = { ...emptyShot("推门"), description: "人物推门", duration: 45 };
  const { user, create, locate } = setup({ revision: 2, shots: [shot] });
  await screen.findByLabelText("镜头标题");
  vi.mocked(saveStoryboard).mockRejectedValueOnce(new Error("网络暂时不可用"));
  await user.click(screen.getByRole("button", { name: "开始制作镜头视频" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("网络暂时不可用");
  expect(create).toHaveBeenCalledExactlyOnceWith(
    "video",
    "推门",
    expect.objectContaining({ prompt: "人物推门", duration: 5, mode: "text" }),
  );
  expect(locate).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "保存分镜" }));
  await waitFor(() => expect(saveStoryboard).toHaveBeenCalledTimes(2));
  expect(
    vi.mocked(saveStoryboard).mock.calls[1][1].shots[0].video_node_id,
  ).toBe("new-video");
  expect(create).toHaveBeenCalledOnce();
});

test("delete only removes the shot after confirmation and readonly mode has no write controls", async () => {
  const { user } = setup({
    revision: 1,
    shots: [emptyShot("第一镜"), emptyShot("第二镜")],
  });
  await user.click(await screen.findByRole("button", { name: "删除分镜" }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent(
    "关联节点、文件和输出版本会保留",
  );
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "取消",
    }),
  );
  expect(screen.getByLabelText("镜头标题")).toHaveValue("第一镜");
  await user.click(screen.getByRole("button", { name: "下移分镜" }));
  await user.click(screen.getByRole("button", { name: "保存分镜" }));
  await waitFor(() => expect(saveStoryboard).toHaveBeenCalled());
  expect(
    vi.mocked(saveStoryboard).mock.calls[0][1].shots.map((shot) => shot.title),
  ).toEqual(["第二镜", "第一镜"]);
});

test("readonly plans can be viewed without creating or saving nodes", async () => {
  setup({ revision: 1, shots: [emptyShot()] }, true);
  await screen.findByLabelText("镜头标题");
  expect(screen.getByLabelText("镜头标题")).toBeDisabled();
  for (const label of [
    "新建分镜",
    "保存分镜",
    "开始制作镜头视频",
    "关联已有视频",
    "删除分镜",
  ])
    expect(
      screen.queryByRole("button", { name: label }),
    ).not.toBeInTheDocument();
});

test("batch import accepts only videos and skips repeated sources while reordering retains links", () => {
  const nodes: VisualCanvasNode[] = [
    { id: "frame", kind: "image", title: "画面", position: { x: 0, y: 0 } },
    { id: "clip", kind: "video", title: "视频", position: { x: 0, y: 0 } },
    { id: "frame2", kind: "image", title: "画面2", position: { x: 0, y: 0 } },
    {
      id: "text",
      kind: "text",
      text: "",
      title: "说明",
      position: { x: 0, y: 0 },
    },
  ];
  const shots = importShots([], [...nodes, nodes[0]]);
  expect(shots.map((shot) => shot.origin_node_id)).toEqual(["clip"]);
  expect(importShots(shots, nodes)).toEqual(shots);
  const second = { ...emptyShot("第二镜"), video_node_id: "clip2" };
  expect(
    reorderShots([...shots, second], shots[0].id, second.id)[0].video_node_id,
  ).toBe("clip2");
  expect(
    importShots([{ ...shots[0], origin_node_id: null }], nodes),
  ).toHaveLength(1);
});

test("storyboard edits videos when a shot also has a reference image and preserves the image on save", async () => {
  const shot = {
    ...emptyShot("第一镜"),
    image_node_id: "frame",
    video_node_id: "clip",
  };
  const nodes: VisualCanvasNode[] = [
    { id: "frame", kind: "image", title: "分镜画面", position: { x: 0, y: 0 } },
    { id: "clip", kind: "video", title: "历史视频", position: { x: 0, y: 0 } },
  ];
  const { user, locate } = setup({ revision: 1, shots: [shot] }, false, nodes);
  await screen.findByLabelText("镜头标题");
  expect(
    screen.queryByRole("group", { name: "制作类型" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "定位制作节点" }));
  await waitFor(() => expect(locate).toHaveBeenCalledWith("clip"));
  await user.type(screen.getByLabelText("镜头标题"), "修改");
  await user.click(screen.getByRole("button", { name: "保存分镜" }));
  await waitFor(() => expect(saveStoryboard).toHaveBeenCalled());
  expect(vi.mocked(saveStoryboard).mock.calls[0][1].shots[0]).toMatchObject({
    image_node_id: "frame",
    video_node_id: "clip",
    title: "第一镜修改",
  });
});

test("image-only shots offer video creation and only videos in the node picker", async () => {
  const nodes: VisualCanvasNode[] = [
    {
      id: "frame",
      kind: "image",
      title: "可用分镜图",
      asset_id: "reference-image",
      position: { x: 0, y: 0 },
    },
    { id: "clip", kind: "video", title: "历史视频", position: { x: 0, y: 0 } },
  ];
  const { user, create } = setup(
    {
      revision: 1,
      shots: [{ ...emptyShot("旧镜头"), image_node_id: "frame" }],
    },
    false,
    nodes,
  );
  await screen.findByLabelText("镜头标题");
  const editor = screen.getByRole("region", { name: "分镜制作" });
  expect(within(editor).getByLabelText("镜头标题")).toHaveValue("旧镜头");
  const start = screen.getByRole("region", { name: "制作镜头视频" });
  expect(
    within(start).getByRole("button", { name: "开始制作镜头视频" }),
  ).toBeVisible();
  expect(
    screen.getAllByRole("button", { name: "开始制作镜头视频" }),
  ).toHaveLength(1);
  expect(within(start).queryByLabelText("镜头标题")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "定位制作节点" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "关联已有视频" }));
  const picker = screen.getByRole("dialog");
  expect(within(picker).getByText("历史视频")).toBeVisible();
  expect(within(picker).queryByText("可用分镜图")).not.toBeInTheDocument();
  await user.click(within(picker).getByRole("button", { name: "取消" }));
  await user.click(screen.getByRole("button", { name: "开始制作镜头视频" }));
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(
      "video",
      "旧镜头",
      expect.objectContaining({
        mode: "reference",
        reference_asset_ids: ["reference-image"],
      }),
    ),
  );
  await waitFor(() => expect(saveStoryboard).toHaveBeenCalled());
  expect(vi.mocked(saveStoryboard).mock.calls[0][1].shots[0]).toMatchObject({
    video_node_id: "new-video",
    image_node_id: "frame",
  });
});

test.each(["import", "link"] as const)(
  "%s video picker requests covers for actual outputs, including disabled entries, but not drafts",
  async (mode) => {
    vi.mocked(fetchApiBlob).mockResolvedValue(
      new Blob(["cover"], { type: "image/webp" }),
    );
    const createURL = vi.fn(() => "blob:cover");
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = createURL;
        static revokeObjectURL = vi.fn();
      },
    );
    vi.stubGlobal("IntersectionObserver", undefined);
    try {
      const nodes: VisualCanvasNode[] = [
        {
          id: "clip",
          kind: "video",
          title: "有输出的视频",
          asset_id: "video-cover",
          position: { x: 0, y: 0 },
        },
        {
          id: "draft",
          kind: "video",
          title: "无输出草稿",
          position: { x: 0, y: 0 },
        },
      ];
      const shot = {
        ...emptyShot("旧镜头"),
        ...(mode === "import" ? { video_node_id: "clip" } : {}),
      };
      const { user } = setup({ revision: 1, shots: [shot] }, false, nodes);
      await user.click(
        await screen.findByRole("button", {
          name: mode === "import" ? "纳入已有视频" : "关联已有视频",
        }),
      );
      const dialog = screen.getByRole("dialog");
      const output = within(dialog).getByRole("button", {
        name: "有输出的视频 video",
      });
      expect(output).toHaveProperty("disabled", mode === "import");
      await waitFor(() =>
        expect(output.querySelector("img")).toHaveAttribute(
          "src",
          "blob:cover",
        ),
      );
      expect(fetchApiBlob).toHaveBeenCalledExactlyOnceWith(
        "/v1/files/video-cover/thumbnail?size=128&preview_retry=0",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(
        within(dialog)
          .getByRole("button", { name: "无输出草稿 video" })
          .querySelector("img"),
      ).toBeNull();
      expect(dialog.querySelector("video")).toBeNull();
      expect(saveStoryboard).not.toHaveBeenCalled();
    } finally {
      cleanup();
      vi.unstubAllGlobals();
    }
  },
);

test("creation tools remain a separate group from project views", async () => {
  const callbacks = [vi.fn(), vi.fn(), vi.fn()];
  render(
    <ProjectCreativeTools
      onScript={callbacks[0]}
      onWorkbench={callbacks[1]}
      onPrevis={callbacks[2]}
    />,
  );
  const group = screen.getByRole("tablist", { name: "项目工作区" });
  expect(
    within(group)
      .getAllByRole("tab")
      .map((button) => button.textContent),
  ).toEqual(["工作台", "剧本", "白模预演"]);
  await userEvent.click(within(group).getByRole("tab", { name: "剧本" }));
  expect(callbacks[0]).toHaveBeenCalledOnce();
  expect(callbacks[1]).not.toHaveBeenCalled();
});

test("minimal shot properties retain legacy data and source links when the description changes", async () => {
  const shot = {
    ...emptyShot("第一镜"),
    description: "原始描述",
    card_ids: ["legacy-character", "legacy-scene"],
    shot_size: "近景",
    camera_motion: "缓慢推进",
    dialogue: "原对白",
    sound: "原声音",
    duration: 9.25,
    previs: {
      scene_id: "stage",
      stage_revision: 2,
      camera_id: "camera",
      overrides: { cameras: [] },
    },
  };
  const { user } = setup({ revision: 5, shots: [shot] });
  const description = await screen.findByLabelText("分镜描述");
  expect(screen.queryByText("关联设定")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "关联人设／场景／道具" }),
  ).not.toBeInTheDocument();
  for (const name of ["景别", "运镜", "对白", "声音", "规划时长（秒）"])
    expect(screen.queryByLabelText(name)).not.toBeInTheDocument();
  await user.clear(description);
  await user.type(description, "只改分镜描述");
  await user.click(screen.getByRole("button", { name: "保存分镜" }));
  await waitFor(() => expect(saveStoryboard).toHaveBeenCalledOnce());
  expect(vi.mocked(saveStoryboard).mock.calls[0][1]).toEqual({
    revision: 5,
    shots: [{ ...shot, description: "只改分镜描述" }],
  });
});

test("previs associations show only exported outputs from the linked stage revision and can be changed without clearing other shot fields", async () => {
  vi.mocked(listPrevis).mockResolvedValue([
    {
      id: "stage",
      title: "天台",
      revision: 2,
      updated_at: "2026-11-21T00:00:00Z",
    },
    {
      id: "other",
      title: "街道",
      revision: 3,
      updated_at: "2026-11-21T00:00:00Z",
    },
  ]);
  const shot = {
    ...emptyShot("第一镜"),
    description: "保留描述",
    previs: {
      scene_id: "stage",
      stage_revision: 2,
      camera_id: "camera",
      overrides: { cameras: [] },
    },
  };
  const nodes: VisualCanvasNode[] = [
    {
      id: "frame",
      kind: "image",
      title: "关键帧",
      asset_id: "frame-file",
      tags: ["白模预演", "stage@2"],
      position: { x: 0, y: 0 },
    },
    {
      id: "clip",
      kind: "video",
      title: "预演片段",
      asset_id: "clip-file",
      tags: ["白模预演", "stage@2"],
      position: { x: 0, y: 0 },
    },
    {
      id: "new-frame",
      kind: "image",
      title: "其他版本",
      asset_id: "new-file",
      tags: ["白模预演", "stage@3"],
      position: { x: 0, y: 0 },
    },
    {
      id: "other-frame",
      kind: "image",
      title: "其他场景",
      asset_id: "other-file",
      tags: ["白模预演", "other@2"],
      position: { x: 0, y: 0 },
    },
  ];
  const { user, locate } = setup({ revision: 4, shots: [shot] }, false, nodes);
  const section = await screen.findByRole("region", { name: "白模预演输出" });
  await waitFor(() => expect(section).toHaveTextContent("天台 · v2"));
  expect(
    within(section).getAllByRole("button", { name: /查看预演输出/ }),
  ).toHaveLength(2);
  await user.click(
    within(section).getByRole("button", { name: "查看预演输出 关键帧" }),
  );
  expect(locate).toHaveBeenCalledWith("frame");
  await user.click(within(section).getByRole("button", { name: "更换关联" }));
  await user.click(
    within(section).getByRole("combobox", { name: "关联白模场景" }),
  );
  await user.click(screen.getByRole("option", { name: "街道" }));
  await user.click(screen.getByRole("button", { name: "保存分镜" }));
  await waitFor(() => expect(saveStoryboard).toHaveBeenCalledOnce());
  expect(vi.mocked(saveStoryboard).mock.calls[0][1].shots[0]).toMatchObject({
    description: "保留描述",
    previs: {
      scene_id: "other",
      stage_revision: 3,
      camera_id: null,
      overrides: {},
    },
  });
});

test("readonly shot associations and description remain available without write controls", async () => {
  setup(
    {
      revision: 1,
      shots: [
        { ...emptyShot(), previs: { scene_id: "stage", stage_revision: 1 } },
      ],
    },
    true,
  );
  expect(await screen.findByLabelText("分镜描述")).toBeDisabled();
  const section = screen.getByRole("region", { name: "白模预演输出" });
  expect(
    within(section).queryByRole("button", { name: /更换关联|关联白模预演/ }),
  ).toBeNull();
  expect(saveStoryboard).not.toHaveBeenCalled();
});
