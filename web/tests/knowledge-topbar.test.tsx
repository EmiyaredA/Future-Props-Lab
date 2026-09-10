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
  onOpenProject: vi.fn(),
  onOpenDocument: vi.fn(),
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
      documents={[]}
      noteChrome={chrome}
      onNoteAction={onNoteAction}
      {...actions}
    />,
  );
  return onNoteAction;
}

function renderProjectTopbar(busy = false) {
  const onImport = vi.fn();
  const onProjectAction = vi.fn();
  render(
    <KnowledgeTopbar
      noteMode={false}
      busy={busy}
      projectTitle="Agent Harness"
      currentLabel="文档回收站"
      documents={[]}
      noteChrome={null}
      onNoteAction={vi.fn()}
      {...actions}
      onImport={onImport}
      onProjectAction={onProjectAction}
    />,
  );
  return { onImport, onProjectAction };
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

describe("思绪工坊知识库顶部栏", () => {
  it("folds project actions into the compact menu", async () => {
    const user = userEvent.setup();
    const { onImport, onProjectAction } = renderProjectTopbar();
    const trigger = screen.getByRole("button", { name: "知识库更多操作" });
    expect(screen.queryByText("更多", { exact: true })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^导入$/ }),
    ).not.toBeInTheDocument();

    await user.click(trigger);
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual([
      "导入",
      "导出知识库",
      "重命名",
      "修改简介",
      "更换封面",
      "恢复默认封面",
      "移入回收站",
    ]);
    expect(screen.getAllByRole("separator")).toHaveLength(2);
    expect(screen.getByRole("menuitem", { name: "移入回收站" })).toHaveClass(
      "is-danger",
    );

    await user.click(document.body);
    expect(
      screen.queryByRole("menu", { name: "知识库更多操作" }),
    ).not.toBeInTheDocument();
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "导入" }));
    expect(onImport).toHaveBeenCalledOnce();
    expect(onProjectAction).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "导出知识库" }));
    expect(onProjectAction).toHaveBeenCalledExactlyOnceWith("export");
  });

  it("keeps import disabled while another operation is running", async () => {
    const user = userEvent.setup();
    renderProjectTopbar(true);
    await user.click(screen.getByRole("button", { name: "知识库更多操作" }));
    expect(screen.getByRole("menuitem", { name: "导入" })).toBeDisabled();
  });
});
