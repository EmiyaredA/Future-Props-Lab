import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountAccessProvider } from "@platform/auth/AccountAccess";
import { NoteEditorPane } from "@features/thought-workshop/NoteEditorPane";
import { canvasTemplate } from "@features/thought-workshop/diagrams/templates";
import * as api from "@features/thought-workshop/api";
import * as storage from "@features/thought-workshop/drafts/storage";
import * as readingApi from "@features/thought-workshop/knowledge-tools/api";
import * as diagramApi from "@features/thought-workshop/diagram";

vi.mock("@features/thought-workshop/drafts/storage", async (original) => ({
  ...(await original<
    typeof import("@features/thought-workshop/drafts/storage")
  >()),
  listLocalDrafts: vi.fn().mockResolvedValue([]),
  putLocalDraft: vi.fn().mockResolvedValue(undefined),
  removeLocalDraft: vi.fn().mockResolvedValue(undefined),
  draftTabId: () => "current-tab",
}));
vi.mock("@features/thought-workshop/knowledge-tools/api", async (original) => ({
  ...(await original<
    typeof import("@features/thought-workshop/knowledge-tools/api")
  >()),
  getReading: vi.fn().mockResolvedValue(null),
  recordReading: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@features/thought-workshop/diagram", () => ({
  renderDiagram: vi
    .fn()
    .mockResolvedValue(
      '<svg xmlns="http://www.w3.org/2000/svg"><text>预览</text></svg>',
    ),
}));
const note: api.Note = {
  id: "note-with-figures",
  title: "服务器图文",
  document: {
    type: "doc",
    content: [
      { type: "mermaid", attrs: { source: "flowchart LR\nA-->B" } },
      { type: "canvas", attrs: { scene: canvasTemplate(1) } },
      { type: "paragraph", content: [{ type: "text", text: "服务器内容" }] },
    ],
  },
  schema_version: 3,
  tags: [],
  favorite: false,
  pinned: false,
  revision: 2,
  knowledge_base_id: "kb",
  parent_id: null,
  position: 0,
  is_home: false,
  deleted_at: null,
  excerpt: "",
  created_at: "2026-10-03T00:00:00Z",
  updated_at: "2026-10-03T00:00:00Z",
};
function Harness() {
  const [current, setCurrent] = useState(note);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <AccountAccessProvider
        userId="user-a"
        permissions={["content.read", "content.write"]}
      >
        <NoteEditorPane
          key={current.id}
          note={current}
          onSaved={setCurrent}
          onOpen={() => {}}
          registerNavigationGuard={() => {}}
        />
      </AccountAccessProvider>
    </QueryClientProvider>
  );
}
function mountedEditor() {
  return screen.getByRole("textbox", {
    name: "笔记正文",
  }) as HTMLElement & { editor: Editor };
}
async function expectCompleteEditor() {
  await screen.findByRole("button", { name: "编辑图表" });
  await screen.findByRole("button", { name: "编辑画板" });
  const element = mountedEditor();
  expect(element.editor.isEditable).toBe(true);
  const extensions = element.editor.extensionManager.extensions.map(
    (extension) => extension.name,
  );
  expect(extensions).toContain("thoughtSlashCommand");
  expect(extensions).toContain("nodeRange");
  return element;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(diagramApi.renderDiagram).mockResolvedValue(
    '<svg xmlns="http://www.w3.org/2000/svg"><text>预览</text></svg>',
  );
  vi.mocked(readingApi.getReading).mockResolvedValue(null);
  vi.mocked(readingApi.recordReading).mockImplementation(
    async (resource_id, title, position) => ({
      resource_id,
      title,
      position,
      visited_at: "2026-11-01T00:00:00Z",
    }),
  );
  vi.mocked(storage.listLocalDrafts).mockResolvedValue([]);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(api, "saveNote").mockImplementation(async (_id, body, revision) => ({
    ...note,
    ...body,
    revision: revision + 1,
  }));
});
afterEach(() => {
  // Reading-position cleanup needs the Promise-returning API mocks while unmounting.
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("note editor initial local recovery boundary", () => {
  it("waits for slow local inspection before mounting editing extensions and keeps that editor through saves", async () => {
    let finish!: (rows: storage.LocalDraft[]) => void;
    vi.mocked(storage.listLocalDrafts).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<Harness />);
    expect(await screen.findByText("正在检查本机草稿…")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "笔记正文" })).toBeNull();
    await act(async () => finish([]));
    const element = await expectCompleteEditor();
    const instance = element.editor;
    fireEvent.click(screen.getByRole("button", { name: "编辑图表" }));
    fireEvent.change(screen.getByLabelText("Mermaid 源码"), {
      target: { value: "flowchart LR\nA[已修改]-->B" },
    });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(api.saveNote).toHaveBeenCalledOnce());
    expect(mountedEditor()).toBe(element);
    expect(mountedEditor().editor).toBe(instance);
    expect(instance.isDestroyed).toBe(false);
    expect(screen.getByLabelText("Mermaid 源码")).toHaveValue(
      "flowchart LR\nA[已修改]-->B",
    );
    expect(storage.listLocalDrafts).toHaveBeenCalledOnce();
  });

  it.each(["丢弃草稿", "恢复草稿"])(
    "does not mount a read-only editor while a recovery decision is pending: %s",
    async (action) => {
      const row: storage.LocalDraft = {
        userId: "user-a",
        accountId: "workspace-a",
        key: "previous-tab",
        noteId: note.id,
        tabId: "previous-tab",
        revision: note.revision,
        updatedAt: 1234,
        body: { ...api.noteInput(note), title: "本机草稿" },
      };
      vi.mocked(storage.listLocalDrafts).mockResolvedValue([row]);
      render(<Harness />);
      expect(
        await screen.findByText("请选择本机草稿的恢复方式…"),
      ).toBeVisible();
      expect(screen.queryByRole("textbox", { name: "笔记正文" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "查看服务端" }));
      expect(screen.getByRole("heading", { name: note.title })).toBeVisible();
      expect(api.saveNote).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: action }));
      await expectCompleteEditor();
      expect(screen.getByRole("textbox", { name: "笔记标题" })).toHaveValue(
        action === "恢复草稿" ? "本机草稿" : note.title,
      );
      expect(storage.removeLocalDraft).toHaveBeenCalledWith(
        row.key,
        row.updatedAt,
      );
    },
  );
});
