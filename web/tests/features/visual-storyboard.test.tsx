import { render, screen, waitFor, within } from "@testing-library/react";
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

vi.mock("@features/visual-workshop/storyboard/api", () => ({
  getStoryboard: vi.fn(),
  saveStoryboard: vi.fn(),
}));
vi.mock("@features/visual-workshop/board/OutputPreview", () => ({
  OutputPreview: () => <span>预览</span>,
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getStoryboard).mockResolvedValue({ revision: 0, shots: [] });
  vi.mocked(saveStoryboard).mockImplementation(async (_, value) => ({
    ...value,
    revision: value.revision + 1,
  }));
});
function setup(
  document: Storyboard = { revision: 0, shots: [] },
  readOnly = false,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(cardsKey, []);
  client.setQueryData(scriptKey("project"), { revision: 0, episodes: [] });
  vi.mocked(getStoryboard).mockResolvedValue(document);
  const locate = vi.fn();
  const leave = vi.fn();
  const create = vi.fn().mockResolvedValue("new-image");
  const beforeSave = vi.fn().mockResolvedValue(1);
  render(
    <QueryClientProvider client={client}>
      <StoryboardWorkspace
        project="project"
        nodes={[]}
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

test("creating a production node saves its link before navigation and keeps the link if save fails", async () => {
  const shot = { ...emptyShot("推门"), description: "人物推门", duration: 45 };
  const { user, create, locate } = setup({ revision: 2, shots: [shot] });
  await screen.findByLabelText("镜头标题");
  vi.mocked(saveStoryboard).mockRejectedValueOnce(new Error("网络暂时不可用"));
  await user.click(screen.getAllByRole("button", { name: "创建制作节点" })[0]);
  expect(await screen.findByRole("alert")).toHaveTextContent("网络暂时不可用");
  expect(create).toHaveBeenCalledExactlyOnceWith(
    "image",
    "推门",
    expect.objectContaining({ prompt: "人物推门", image_count: 1 }),
  );
  expect(locate).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "保存分镜" }));
  await waitFor(() => expect(saveStoryboard).toHaveBeenCalledTimes(2));
  expect(
    vi.mocked(saveStoryboard).mock.calls[1][1].shots[0].image_node_id,
  ).toBe("new-image");
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
  for (const label of ["新建分镜", "保存分镜", "创建制作节点", "删除分镜"])
    expect(
      screen.queryByRole("button", { name: label }),
    ).not.toBeInTheDocument();
});

test("batch import skips non-media and repeated sources while reordering retains links", () => {
  const nodes: VisualCanvasNode[] = [
    { id: "frame", kind: "image", title: "画面", position: { x: 0, y: 0 } },
    { id: "clip", kind: "video", title: "视频", position: { x: 0, y: 0 } },
    {
      id: "text",
      kind: "text",
      text: "",
      title: "说明",
      position: { x: 0, y: 0 },
    },
  ];
  const shots = importShots([], [...nodes, nodes[0]]);
  expect(shots.map((shot) => shot.origin_node_id)).toEqual(["frame", "clip"]);
  expect(importShots(shots, nodes)).toEqual(shots);
  expect(reorderShots(shots, shots[0].id, shots[1].id)[0].video_node_id).toBe(
    "clip",
  );
});

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
