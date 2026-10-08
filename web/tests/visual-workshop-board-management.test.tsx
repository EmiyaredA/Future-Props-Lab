import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { ProjectBoard } from "@features/visual-workshop/board/ProjectBoard";
import type { BoardController } from "@features/visual-workshop/board/boardTypes";
import type { VisualCanvasNode } from "@features/visual-workshop/api";

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
  const patchNode = vi.fn();
  const removeNode = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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
        data: { categories: [{ id: "cat", name: "人设", groups: [] }] },
      },
      client,
      canvasReady: true,
      saveState: "saved",
      nodes,
      edges: [],
      selectedId,
      setSelectedId,
      setSelectedNodeIds: vi.fn(),
      upload: { isPending: false },
      uploadPosition: { current: undefined },
      patchNode: (
        id: string,
        patch: Partial<
          Pick<VisualCanvasNode, "title" | "category_id" | "group" | "tags">
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
  return { sidebar, patchNode, removeNode };
}

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
  expect(screen.getByRole("menuitem", { name: "重命名" })).toHaveFocus();
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

test("organizing a row selects it and opens classification; changes use the same node ID", async () => {
  const user = userEvent.setup();
  const { sidebar, patchNode } = renderBoard();
  await user.click(
    within(sidebar).getByRole("button", { name: "管理节点 另一节点" }),
  );
  await user.click(screen.getByRole("menuitem", { name: "分类与标签" }));
  expect(screen.getByRole("textbox", { name: "节点名称" })).toHaveValue(
    "另一节点",
  );
  await user.click(screen.getByRole("combobox", { name: "节点主分类" }));
  await user.click(screen.getByRole("option", { name: "人设" }));
  expect(patchNode).toHaveBeenCalledWith(
    "second",
    { category_id: "cat", group: null },
    true,
  );
  expect(screen.getByLabelText("附加标签")).toBeVisible();
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
