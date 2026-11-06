import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeTree } from "@features/thought-workshop/KnowledgeTree";
import { THOUGHT_WORKSHOP_MODULE } from "@features/thought-workshop/module";
import type { Directory } from "@features/thought-workshop/knowledgeApi";
import { ProjectLibraryCard } from "@shared/ui/project-library/ProjectLibraryCard";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
const time = "2026-09-08T00:00:00Z";
const doc = (
  id: string,
  title: string,
  parent_id: string | null,
  position: number,
) => ({
  id,
  title,
  knowledge_base_id: "kb",
  parent_id,
  position,
  is_home: false,
  tags: [],
  pinned: false,
  favorite: false,
  deleted_at: null,
  revision: 0,
  created_at: time,
  updated_at: time,
  excerpt: "",
});
const directory: Directory = {
  knowledge_base: {
    id: "kb",
    title: "知识库",
    description: "",
    revision: 2,
    home_note_id: "home",
    deleted_at: null,
    created_at: time,
    updated_at: time,
    document_count: 0,
    cover_asset_id: null,
  },
  documents: [doc("a", "一级", null, 0), doc("b", "二级", "a", 0)],
};
describe("knowledge projects", () => {
  it("keeps project and document route identities separate and legacy URLs isolated", () => {
    expect(THOUGHT_WORKSHOP_MODULE.supportsProjects).toBe(true);
    expect(
      THOUGHT_WORKSHOP_MODULE.matchPath(
        "/apps/thought-workshop/knowledge-bases/kb/documents/n",
      ),
    ).toEqual({
      page: "thought-workshop-editor",
      projectId: "kb",
      documentId: "n",
    });
    expect(
      THOUGHT_WORKSHOP_MODULE.matchPath("/apps/thought-workshop/notes/old"),
    ).toEqual({ page: "thought-workshop-legacy", documentId: "old" });
    expect(
      THOUGHT_WORKSHOP_MODULE.pathFor("thought-workshop-editor", "kb", "n"),
    ).toBe("/apps/thought-workshop/knowledge-bases/kb/documents/n");
  });
  it("exposes nested documents and keyboard move actions", () => {
    const action = vi.fn();
    const open = vi.fn();
    render(
      <KnowledgeTree
        directory={directory}
        open={open}
        action={action}
        move={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "二级" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "折叠子文档" }));
    expect(
      screen.queryByRole("button", { name: "二级" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "一级" }));
    expect(open).toHaveBeenCalledWith("a");
    fireEvent.click(screen.getByRole("button", { name: "一级操作" }));
    const menu = screen.getByRole("menu", { name: "一级操作" });
    expect(menu).toBeVisible();
    fireEvent.keyDown(menu, { key: "End" });
    expect(screen.getByRole("menuitem", { name: "删除" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "一级操作" })).toBeNull();
    expect(screen.getByRole("button", { name: "一级操作" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "一级操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "移动到…" }));
    expect(action).toHaveBeenCalledWith("move", directory.documents[0]);
  });
  it("renders optional project cover and document counts without creation status", () => {
    render(
      <ProjectLibraryCard
        project={directory.knowledge_base}
        cover="canvas"
        coverTitle="知识库"
        coverDescription=""
        coverContent={<span>封面</span>}
        metadata={<span>0 篇文档</span>}
        description="介绍"
        onOpen={vi.fn()}
      >
        <button>进入</button>
      </ProjectLibraryCard>,
    );
    expect(screen.getByText("封面")).toBeVisible();
    expect(screen.getByText("0 篇文档")).toBeVisible();
    expect(screen.queryByText(/创建于/)).not.toBeInTheDocument();
  });
  it("closes the document menu before its enclosing navigation drawer", () => {
    const close = vi.fn();
    function Drawer({ active }: { active: boolean }) {
      const root = useDrawerFocus<HTMLDivElement>(close, active, false);
      return (
        <div ref={root}>
          <KnowledgeTree
            directory={directory}
            open={vi.fn()}
            action={vi.fn()}
            move={vi.fn()}
          />
        </div>
      );
    }
    const { rerender } = render(<Drawer active={false} />);
    const trigger = screen.getByRole("button", { name: "一级操作" });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "一级操作" });
    rerender(<Drawer active />);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "一级操作" })).toBeNull();
    expect(close).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
  });
});
