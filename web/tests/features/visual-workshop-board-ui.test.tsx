import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { BoardMenu } from "@features/visual-workshop/board/BoardMenu";
import { MaterialTree } from "@features/visual-workshop/board/MaterialTree";
import { NodeMetadata } from "@features/visual-workshop/board/NodeMetadata";
import { InputReferences } from "@features/visual-workshop/board/InputReferences";
import type { BoardController } from "@features/visual-workshop/board/boardTypes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getNodeOutput } from "@features/visual-workshop/api";

vi.mock("@features/visual-workshop/api", async () => {
  const actual = await vi.importActual<
    typeof import("@features/visual-workshop/api")
  >("@features/visual-workshop/api");
  return { ...actual, getNodeOutput: vi.fn() };
});

function renderInputs() {
  const replaceEdges = vi.fn();
  const controller = {
    projectId: "project",
    nodes: [
      { id: "target", kind: "video", title: "视频", position: { x: 0, y: 0 } },
      {
        id: "source",
        kind: "text",
        title: "角色说明",
        text: "角色",
        position: { x: 0, y: 0 },
        final_output_id: "output",
        final_version: 1,
      },
    ],
    edges: [
      { id: "input", source_node_id: "source", target_node_id: "target" },
    ],
    replaceEdges,
  } as unknown as BoardController;
  vi.mocked(getNodeOutput)
    .mockClear()
    .mockResolvedValue({
      id: "output",
      text: "角色",
      version: 1,
    } as Awaited<ReturnType<typeof getNodeOutput>>);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <InputReferences controller={controller} nodeId="target" />
    </QueryClientProvider>,
  );
  return replaceEdges;
}

test("input references start collapsed, expand from the keyboard and never save display changes", async () => {
  const user = userEvent.setup();
  const replaceEdges = renderInputs();
  const toggle = screen.getByRole("button", { name: "输入素材 1" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("角色说明")).not.toBeInTheDocument();
  expect(getNodeOutput).not.toHaveBeenCalled();
  toggle.focus();
  await user.keyboard("{Enter}");
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(await screen.findByText("角色说明")).toBeVisible();
  expect(getNodeOutput).toHaveBeenCalledWith("project", "source", "output");
  await user.keyboard(" ");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("角色说明")).not.toBeInTheDocument();
  expect(replaceEdges).not.toHaveBeenCalled();
});

test("adding a reference opens the collapsed section and keeps the count visible", async () => {
  const user = userEvent.setup();
  const replaceEdges = renderInputs();
  await user.click(screen.getByRole("button", { name: "引用任务输出" }));
  const toggle = screen.getByRole("button", { name: "输入素材 1" });
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("combobox", { name: "选择上游任务" })).toBeVisible();
  await user.click(toggle);
  expect(
    screen.queryByRole("combobox", { name: "选择上游任务" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "引用任务输出" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(replaceEdges).not.toHaveBeenCalled();
});

test("management menu opens from keyboard, moves focus and restores trigger on Escape", async () => {
  const user = userEvent.setup();
  const action = vi.fn();
  render(
    <BoardMenu
      label="管理分类"
      items={[
        { label: "新建分组", onSelect: action },
        { label: "编辑分类", onSelect: action },
      ]}
    />,
  );
  const trigger = screen.getByRole("button", { name: "管理分类" });
  trigger.focus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "新建分组" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "编辑分类" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await user.click(trigger);
  await user.click(screen.getByRole("menuitem", { name: "新建分组" }));
  expect(action).toHaveBeenCalledOnce();
  expect(trigger).toHaveFocus();
});

test("empty categories start collapsed and ungrouped nodes avoid redundant tree nesting", () => {
  render(
    <MaterialTree
      categories={[
        { id: "character", name: "人设", groups: [] },
        { id: "scene", name: "场景", groups: [] },
      ]}
      nodes={[
        {
          id: "text",
          kind: "text",
          title: "人物说明",
          text: "角色",
          category_id: "character",
          position: { x: 0, y: 0 },
        },
      ]}
      onAction={vi.fn()}
      onSelect={vi.fn()}
      selectedId="text"
    />,
  );
  expect(screen.getByText("人设").closest("details")).toHaveAttribute("open");
  expect(screen.getByText("场景").closest("details")).not.toHaveAttribute(
    "open",
  );
  expect(screen.queryByText("未分组")).not.toBeInTheDocument();
  expect(screen.queryByText("暂无素材")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /人物说明/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("classification details remain editable behind a compact summary", async () => {
  const user = userEvent.setup();
  render(
    <NodeMetadata
      node={{
        id: "text",
        kind: "text",
        title: "人物说明",
        text: "",
        category_id: "character",
        group: "主角",
        tags: ["日常"],
        position: { x: 0, y: 0 },
      }}
      categories={[{ id: "character", name: "人设", groups: ["主角"] }]}
      onPatch={vi.fn()}
    />,
  );
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "整理" }));
  const metadata = screen.getByRole("region", { name: "节点分类与标签" });
  expect(
    within(metadata).getByRole("combobox", { name: "节点主分类" }),
  ).toBeVisible();
  expect(within(metadata).getByLabelText("附加标签")).toHaveValue("日常");
  expect(within(metadata).getByText("节点编号 text")).toBeVisible();
});
