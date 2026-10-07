import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { BoardMenu } from "@features/visual-workshop/board/BoardMenu";
import { MaterialTree } from "@features/visual-workshop/board/MaterialTree";
import { NodeMetadata } from "@features/visual-workshop/board/NodeMetadata";

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
