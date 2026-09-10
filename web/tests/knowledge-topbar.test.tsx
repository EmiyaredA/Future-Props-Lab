import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeTopbar } from "@features/thought-workshop/KnowledgeTopbar";
import type { NoteEditorChrome } from "@features/thought-workshop/noteEditorChrome";

const chrome: NoteEditorChrome = {
  state: "saved",
  savedAt: "2026-09-10T13:06:00Z",
  save: vi.fn(),
  openHistory: vi.fn(),
  exportNote: vi.fn(),
  assistant: false,
  setAssistant: vi.fn(),
  canSave: true,
  canOpenHistory: true,
};

const actions = {
  onOpenKnowledge: vi.fn(),
  onOpenProject: vi.fn(),
  onOpenDirectory: vi.fn(),
  onImport: vi.fn(),
  onCreateDocument: vi.fn(),
  onBackup: vi.fn(),
  onCreateKnowledge: vi.fn(),
  onProjectAction: vi.fn(),
};

function renderTopbar(onNoteAction = vi.fn()) {
  render(
    <KnowledgeTopbar
      noteMode
      busy={false}
      projectTitle="Agent Harness"
      currentLabel="Harness：把模型能力组织成可靠的系统"
      noteChrome={chrome}
      projectOptions={[]}
      onNoteAction={onNoteAction}
      {...actions}
    />,
  );
  return onNoteAction;
}

describe("思绪工坊文档顶部栏", () => {
  it("uses a compact icon trigger and exposes only real actions", async () => {
    const user = userEvent.setup();
    const onNoteAction = renderTopbar();
    const trigger = screen.getByRole("button", { name: "笔记更多操作" });
    expect(screen.queryByText("更多", { exact: true })).not.toBeInTheDocument();
    await user.click(trigger);
    const menu = screen.getByRole("menu", { name: "笔记更多操作" });
    expect(menu).toBeVisible();
    expect(
      screen.queryByRole("menuitem", { name: /^更多$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual([
      "保存",
      "历史记录",
      "导入",
      "导出 HTML 离线阅读",
      "导出 Markdown",
      "重命名",
      "修改简介",
    ]);
    await user.click(screen.getByRole("menuitem", { name: "保存" }));
    expect(onNoteAction).toHaveBeenCalledExactlyOnceWith("save");
    expect(menu).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("supports menu keyboard navigation and returns focus on Escape", async () => {
    const user = userEvent.setup();
    renderTopbar();
    const trigger = screen.getByRole("button", { name: "笔记更多操作" });
    trigger.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "保存" })).toHaveFocus(),
    );
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "历史记录" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "修改简介" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: "保存" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(
      screen.queryByRole("menu", { name: "笔记更多操作" }),
    ).not.toBeInTheDocument();
  });
});
