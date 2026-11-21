import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { ProjectBoard } from "@features/visual-workshop/board/ProjectBoard";
import type { BoardController } from "@features/visual-workshop/board/boardTypes";
import type { VisualCanvasNode } from "@features/visual-workshop/api";
import { cardsKey, type Card } from "@features/visual-workshop/creative/api";

vi.mock("@features/visual-workshop/api", async () => ({
  ...(await vi.importActual<typeof import("@features/visual-workshop/api")>(
    "@features/visual-workshop/api",
  )),
  getGenerationTasks: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getGenerationBatches: vi.fn().mockResolvedValue({ items: [], total: 0 }),
}));
vi.mock("@features/visual-workshop/board/OutputHistory", () => ({
  OutputHistory: () => null,
}));
vi.mock("@features/visual-workshop/board/TextWorkbench", () => ({
  TextWorkbench: () => null,
}));

function renderBoard() {
  const upload = vi.fn();
  const patchNode = vi.fn();
  const removeNode = vi.fn();
  const createNode = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const cards: Card[] = [
    { id: "hero", title: "小夏", kind: "character" },
    { id: "room", title: "卧室", kind: "scene" },
    { id: "outside", title: "其他项目角色", kind: "character" },
  ].map((card) => ({
    ...card,
    revision: 0,
    facts: "",
    design: "",
    proposed_design: "",
    archived: false,
  })) as Card[];
  client.setQueryData(cardsKey, cards);
  function Harness() {
    const [selectedId, setSelectedId] = useState("first");
    const [nodes, setNodes] = useState<VisualCanvasNode[]>([
      {
        id: "first",
        kind: "text",
        title: "当前节点",
        text: "",
        position: { x: 0, y: 0 },
      },
      {
        id: "second",
        kind: "text",
        title: "另一节点",
        text: "",
        position: { x: 500, y: 0 },
      },
    ]);
    const controller = {
      projectId: "project",
      projectQuery: { data: { title: "节点管理" } },
      canvasQuery: {
        data: { categories: [{ id: "cat", name: "镜头", groups: ["主角"] }] },
      },
      client,
      projectCardIds: ["hero", "hero", "room"],
      createNode,
      canvasReady: true,
      saveState: "saved",
      nodes,
      readCanvas: () => ({ nodes, edges: [], projectCardIds: [] }),
      edges: [],
      selectedId,
      setSelectedId,
      setSelectedNodeIds: vi.fn(),
      upload: { isPending: false, mutate: upload },
      uploadPosition: { current: undefined },
      patchNode: (
        id: string,
        patch: Partial<
          Pick<
            VisualCanvasNode,
            "title" | "category_id" | "group" | "tags" | "approved"
          >
        >,
        immediate?: boolean,
      ) => {
        patchNode(id, patch, immediate);
        setNodes((current) =>
          current.map((node) =>
            node.id === id ? { ...node, ...patch } : node,
          ),
        );
      },
      removeNode: (id: string) => {
        removeNode(id);
        setNodes((current) => current.filter((node) => node.id !== id));
      },
    } as unknown as BoardController;
    return (
      <ProjectBoard
        controller={controller}
        onCanvas={vi.fn()}
        previews={{}}
        onPreview={vi.fn()}
      />
    );
  }
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  const sidebar = screen.getByRole("complementary", { name: "项目素材" });
  fireEvent.mouseDown(within(sidebar).getByRole("tab", { name: "文件" }), {
    button: 0,
  });
  return { sidebar, patchNode, removeNode, upload, createNode, client };
}

test("material views replace the content, count only project cards and keep searches per view", async () => {
  const user = userEvent.setup();
  const { sidebar } = renderBoard();
  const tabs = within(sidebar).getByRole("tablist", { name: "素材分类" });
  expect(within(tabs).getByRole("tab", { name: "文件" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(within(tabs).getByRole("tab", { name: "人设" })).toHaveTextContent(
    "1",
  );
  expect(within(tabs).getByRole("tab", { name: "场景" })).toHaveTextContent(
    "1",
  );
  expect(within(tabs).getByRole("tab", { name: "道具" })).toHaveTextContent(
    "0",
  );
  expect(
    within(sidebar).queryByText("暂无道具，点击 + 添加"),
  ).not.toBeInTheDocument();
  await user.type(
    within(sidebar).getByRole("textbox", { name: "搜索文件" }),
    "当前",
  );
  expect(
    within(sidebar).queryByRole("button", { name: "管理节点 另一节点" }),
  ).not.toBeInTheDocument();
  expect(within(tabs).getByRole("tab", { name: "文件" })).toHaveTextContent(
    "2",
  );
  await user.click(within(tabs).getByRole("tab", { name: "人设" }));
  expect(
    within(sidebar).getByRole("button", { name: "查看设定卡 小夏" }),
  ).toBeVisible();
  expect(
    within(sidebar).queryByRole("button", { name: "查看设定卡 卧室" }),
  ).not.toBeInTheDocument();
  expect(
    within(sidebar).queryByRole("button", { name: "上传素材" }),
  ).not.toBeInTheDocument();
  await user.type(
    within(sidebar).getByRole("textbox", { name: "搜索人设" }),
    "雨衣",
  );
  expect(within(sidebar).getByText("没有匹配的设定卡")).toBeVisible();
  await user.click(within(tabs).getByRole("tab", { name: "道具" }));
  expect(within(sidebar).getByText("暂无道具，点击 + 添加")).toBeVisible();
  await user.click(within(sidebar).getByRole("button", { name: "添加道具卡" }));
  expect(screen.getByRole("menuitem", { name: "新建道具卡" })).toBeEnabled();
  await user.keyboard("{Escape}");
  await user.click(within(tabs).getByRole("tab", { name: "文件" }));
  expect(
    within(sidebar).getByRole("textbox", { name: "搜索文件" }),
  ).toHaveValue("当前");
  await user.click(within(tabs).getByRole("tab", { name: "人设" }));
  expect(
    within(sidebar).getByRole("textbox", { name: "搜索人设" }),
  ).toHaveValue("雨衣");
  expect(within(sidebar).getAllByRole("tabpanel")).toHaveLength(1);
});

test("vertical material tabs support arrow keys and the create menu creates the selected type", async () => {
  const user = userEvent.setup();
  const { sidebar, createNode } = renderBoard();
  act(() => within(sidebar).getByRole("tab", { name: "文件" }).focus());
  await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
  expect(within(sidebar).getByRole("tab", { name: "人设" })).toHaveFocus();
  expect(within(sidebar).getByRole("tab", { name: "人设" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await user.keyboard("{Home}{Enter}");
  await user.click(
    within(sidebar).getByRole("button", { name: "选择新建节点类型" }),
  );
  await user.click(screen.getByRole("menuitem", { name: "新建视频" }));
  expect(createNode).toHaveBeenCalledExactlyOnceWith("video");
  await user.click(within(sidebar).getByRole("button", { name: /^新建$/ }));
  expect(createNode).toHaveBeenLastCalledWith("video");
});

test("upload allows an explicit destination and clears the group when the category changes", async () => {
  const user = userEvent.setup();
  const { upload } = renderBoard();
  const trigger = screen.getByRole("button", { name: "上传素材" });
  trigger.focus();
  await user.keyboard("{Enter}");
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("combobox", { name: "上传分类" })).toHaveTextContent(
    "未分类",
  );
  expect(screen.getByRole("combobox", { name: "上传分组" })).toBeDisabled();
  await user.click(screen.getByRole("combobox", { name: "上传分类" }));
  await user.click(screen.getByRole("option", { name: "镜头" }));
  await user.click(screen.getByRole("combobox", { name: "上传分组" }));
  await user.click(screen.getByRole("option", { name: "主角" }));
  await user.click(screen.getByRole("combobox", { name: "上传分类" }));
  await user.click(screen.getByRole("option", { name: "未分类" }));
  expect(screen.getByRole("combobox", { name: "上传分组" })).toHaveTextContent(
    "未分组",
  );
  expect(upload).not.toHaveBeenCalled();
  const file = new File(["png"], "image.png", { type: "image/png" });
  await user.upload(screen.getByLabelText("上传项目素材文件"), file);
  expect(upload).toHaveBeenCalledWith({
    files: [file],
    destination: { category_id: null, group: null },
  });
  await user.click(trigger);
  expect(
    screen.queryByRole("combobox", { name: "上传分类" }),
  ).not.toBeInTheDocument();
});

test("each row has a visible management button; keyboard renaming targets the unselected node", async () => {
  const user = userEvent.setup();
  const { sidebar, patchNode } = renderBoard();
  const trigger = within(sidebar).getByRole("button", {
    name: "管理节点 另一节点",
  });
  expect(trigger).toBeVisible();
  expect(trigger).not.toHaveTextContent("管理");
  trigger.focus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "下载" })).toBeDisabled();
  expect(screen.getByRole("menuitem", { name: "标记通过" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
  await user.click(trigger);
  await user.click(screen.getByRole("menuitem", { name: "重命名" }));
  const dialog = screen.getByRole("dialog", { name: "重命名节点" });
  const name = within(dialog).getByRole("textbox", { name: "节点名称" });
  expect(name).toHaveValue("另一节点");
  await user.clear(name);
  await user.type(name, "  新名称  ");
  await user.click(within(dialog).getByRole("button", { name: "确认" }));
  expect(patchNode).toHaveBeenCalledWith("second", { title: "新名称" }, true);
  expect(screen.getByRole("textbox", { name: "节点名称" })).toHaveValue(
    "当前节点",
  );
  expect(
    within(sidebar).getByRole("button", { name: "管理节点 新名称" }),
  ).toHaveFocus();
});

test("node management removes classification controls while retaining file actions", async () => {
  const user = userEvent.setup();
  const { sidebar } = renderBoard();
  await user.click(
    within(sidebar).getByRole("button", { name: "管理节点 另一节点" }),
  );
  expect(
    screen.queryByRole("menuitem", { name: "分类与标签" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "重命名" })).toBeEnabled();
});

test("deletion names the target, cancellation keeps it, confirmation removes only that node", async () => {
  const user = userEvent.setup();
  const { sidebar, removeNode } = renderBoard();
  const openDelete = async () => {
    await user.click(
      within(sidebar).getByRole("button", { name: "管理节点 另一节点" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "删除节点" }));
    return screen.getByRole("alertdialog", { name: "删除节点" });
  };
  const dialog = await openDelete();
  expect(dialog).toHaveTextContent("确认删除「另一节点」");
  expect(dialog).toHaveTextContent("原文件仍会保留");
  expect(removeNode).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(removeNode).not.toHaveBeenCalled();
  const reopened = await openDelete();
  await user.click(within(reopened).getByRole("button", { name: "删除节点" }));
  expect(removeNode).toHaveBeenCalledExactlyOnceWith("second");
  expect(
    within(sidebar).queryByRole("button", { name: "管理节点 另一节点" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "节点名称" })).toHaveValue(
    "当前节点",
  );
});

test("approval toggles from the node heading and row menu without changing selection", async () => {
  const user = userEvent.setup();
  const { sidebar, patchNode } = renderBoard();
  const trigger = screen.getByRole("switch", { name: "节点通过：当前节点" });
  expect(
    screen.queryByRole("region", { name: "节点分类与标签" }),
  ).not.toBeInTheDocument();
  trigger.focus();
  await user.keyboard("{Enter}");
  expect(patchNode).toHaveBeenLastCalledWith("first", { approved: true }, true);
  expect(
    screen.getByRole("switch", { name: "节点通过：当前节点" }),
  ).toHaveAttribute("aria-checked", "true");
  expect(within(sidebar).getByLabelText("当前节点已通过")).toBeVisible();
  await user.click(screen.getByRole("switch", { name: "节点通过：当前节点" }));
  expect(patchNode).toHaveBeenLastCalledWith(
    "first",
    { approved: false },
    true,
  );
  expect(
    within(sidebar).queryByLabelText("当前节点已通过"),
  ).not.toBeInTheDocument();
  await user.click(
    within(sidebar).getByRole("button", { name: "管理节点 另一节点" }),
  );
  await user.click(screen.getByRole("menuitem", { name: "标记通过" }));
  expect(patchNode).toHaveBeenLastCalledWith(
    "second",
    { approved: true },
    true,
  );
  expect(screen.getByRole("textbox", { name: "节点名称" })).toHaveValue(
    "当前节点",
  );
  expect(within(sidebar).getByLabelText("另一节点已通过")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "状态分组" }));
  expect(
    screen.getByRole("switch", { name: "节点通过：另一节点" }),
  ).toHaveAttribute("aria-checked", "true");
});

test("creation buttons occupy the project header without a visible category label", () => {
  renderBoard();
  const tools = screen.getByRole("tablist", { name: "项目工作区" });
  expect(screen.getByRole("banner")).toContainElement(tools);
  expect(
    screen.getByRole("navigation", { name: "看板内容" }),
  ).not.toContainElement(tools);
  expect(
    screen.queryByText("创作功能", { exact: true }),
  ).not.toBeInTheDocument();
});
