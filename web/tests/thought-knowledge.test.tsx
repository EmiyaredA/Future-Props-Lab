import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeTree } from "@features/thought-workshop/KnowledgeTree";
import { THOUGHT_WORKSHOP_MODULE } from "@features/thought-workshop/module";
import type { Directory } from "@features/thought-workshop/knowledgeApi";
import { ProjectLibraryCard } from "@shared/ui/project-library/ProjectLibraryCard";
const time = "2026-09-08T00:00:00Z";
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
  },
  folders: [
    {
      id: "a",
      knowledge_base_id: "kb",
      parent_id: null,
      title: "一级",
      position: 0,
      created_at: time,
      updated_at: time,
    },
    {
      id: "b",
      knowledge_base_id: "kb",
      parent_id: "a",
      title: "二级",
      position: 0,
      created_at: time,
      updated_at: time,
    },
  ],
  documents: [],
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
  it("exposes nested folders and keyboard move actions", () => {
    const action = vi.fn();
    render(
      <KnowledgeTree
        directory={directory}
        open={vi.fn()}
        action={action}
        move={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "二级" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "一级" }));
    expect(
      screen.queryByRole("button", { name: "二级" }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "一级操作" }), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("option", { name: "移动到…" }));
    expect(action).toHaveBeenCalledWith("move", {
      kind: "folder",
      value: directory.folders[0],
    });
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
    expect(screen.queryByText("已完成")).not.toBeInTheDocument();
  });
});
