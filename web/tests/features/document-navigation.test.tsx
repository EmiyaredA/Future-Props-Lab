import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { render, screen, fireEvent } from "@testing-library/react";
import { editorExtensions } from "@features/thought-workshop/editorExtensions";
import { runInsertCommand } from "@features/thought-workshop/blockCommands";
import {
  emptyCard,
  homeTemplate,
} from "@features/thought-workshop/document-layout/model";
import {
  navigationHtml,
  navigationMarkdown,
} from "@features/thought-workshop/document-layout/navigationExport";
import { KnowledgeTree } from "@features/thought-workshop/KnowledgeTree";
import { sanitizeThoughtPastedHTML } from "@features/thought-workshop/clipboard";
import {
  markdownWarnings,
  toMarkdown,
} from "@features/thought-workshop/markdown";

afterEach(() => vi.restoreAllMocks());
const callbacks = { image: vi.fn(), attachment: vi.fn(), math: vi.fn() };
describe("shared document navigation", () => {
  it("inserts the editable homepage template and round-trips navigation blocks through HTML", () => {
    const editor = new Editor({
      extensions: editorExtensions(),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    runInsertCommand(editor, "homeTemplate", callbacks, 0);
    expect(
      editor.getJSON().content?.some((node) => node.type === "cardGrid"),
    ).toBe(true);
    const html = editor.getHTML();
    const pasted = new Editor({
      extensions: editorExtensions(),
      content: sanitizeThoughtPastedHTML(html, "workspace"),
    });
    expect(
      pasted.getJSON().content?.filter((node) => node.type === "documentCard"),
    ).toHaveLength(1);
    expect(
      pasted.getJSON().content?.find((node) => node.type === "documentCard")
        ?.attrs?.eyebrow,
    ).toBe("从这里开始");
    expect(markdownWarnings(homeTemplate()).join(" ")).toContain("卡片排版");
    pasted.destroy();
    editor.destroy();
  });
  it("filters revoked cards and resolves directory entries using the supplied access adapter for exports", async () => {
    const document = {
      type: "doc",
      content: [
        {
          ...emptyCard(),
          attrs: {
            ...emptyCard().attrs,
            noteId: "visible",
            style: "featured",
            eyebrow: "从这里开始",
          },
        },
        {
          type: "cardGrid",
          content: [
            {
              ...emptyCard(),
              attrs: { ...emptyCard().attrs, noteId: "visible" },
            },
            {
              ...emptyCard(),
              attrs: { ...emptyCard().attrs, noteId: "hidden" },
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "documentReference",
              attrs: {
                kind: "note",
                noteId: "hidden",
                label: "私人标题缓存",
                customLabel: "私人标签",
              },
            },
          ],
        },
        {
          type: "documentDirectory",
          attrs: { parentId: null, style: "cards" },
        },
      ],
    };
    const directory = vi.fn().mockResolvedValue([
      {
        id: "visible",
        title: "最新标题",
        excerpt: "可见简介",
        parent_id: null,
        position: 0,
        is_home: false,
        knowledge_base_id: "source",
      },
    ]);
    const resolveReferences = vi.fn().mockResolvedValue([
      {
        id: "visible",
        available: true,
        title: "最新标题",
        excerpt: "可见简介",
        knowledge_base_id: "source",
        revision: 3,
      },
      { id: "hidden", available: false },
    ]);
    const access = {
      directory,
      resolveReferences,
      referenceHref: (id: string) => `/community/${id}`,
    };
    const editor = new Editor({
      extensions: editorExtensions(),
      content: document,
    });
    const parsed = new DOMParser().parseFromString(
      editor.getHTML(),
      "text/html",
    );
    await navigationHtml(parsed, document, "source", access);
    expect(parsed.body.textContent).toContain("最新标题");
    expect(parsed.body.textContent).toContain("文档不可访问");
    expect(parsed.body.innerHTML).not.toContain("hidden");
    expect(parsed.body.textContent).not.toContain("私人");
    expect(parsed.querySelector(".document-card-cta")?.textContent).toBe(
      "开始阅读 →",
    );
    expect(parsed.querySelector(".document-card-summary")?.textContent).toBe(
      "可见简介",
    );
    expect(
      parsed.querySelectorAll('a[href="/community/visible"]'),
    ).toHaveLength(3);
    const markdown = toMarkdown(
      await navigationMarkdown(document, "source", access),
      {},
    );
    expect(markdown).toContain("最新标题");
    expect(markdown).not.toContain("hidden");
    expect(markdown).not.toContain("私人");
    expect(directory).toHaveBeenCalledWith("source");
    editor.destroy();
  });
  it("shares the parent-child tree while hiding all mutation controls in reading mode", () => {
    const open = vi.fn();
    render(
      <KnowledgeTree
        directory={{
          documents: [
            { id: "parent", title: "父文档", parent_id: null, position: 0 },
            { id: "child", title: "子文档", parent_id: "parent", position: 0 },
          ],
        }}
        open={open}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "折叠子文档" }));
    expect(screen.queryByRole("button", { name: "子文档" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "展开子文档" }));
    fireEvent.click(screen.getByRole("button", { name: "子文档" }));
    expect(open).toHaveBeenCalledWith("child");
    expect(screen.queryByRole("button", { name: "父文档操作" })).toBeNull();
  });
});
