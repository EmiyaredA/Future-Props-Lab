import { act, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { useState } from "react";
import { useDocumentChrome } from "@features/thought-workshop/document-layout/useDocumentChrome";
import StarterKit from "@tiptap/starter-kit";
import {
  Details,
  DetailsContent,
  DetailsSummary,
} from "@tiptap/extension-details";
import { afterEach, expect, it, vi } from "vitest";
import {
  collectOutline,
  revealOutlineTarget,
} from "@features/thought-workshop/outlineHeadings";
import { useDocumentOutline } from "@features/thought-workshop/useDocumentOutline";
import { DocumentOutline } from "@features/thought-workshop/DocumentOutline";

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((editor) => {
    editor.view.dom.parentElement?.remove();
    editor.destroy();
  });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function make(
  content = "<h1>一</h1><h3>子节</h3><h2>同级</h2><h2>同级</h2><h6>深层</h6><h1> </h1>",
) {
  const editor = new Editor({
    extensions: [
      StarterKit,
      Details.configure({ persist: true }),
      DetailsSummary,
      DetailsContent,
    ],
    content,
  });
  const host = document.createElement("div");
  host.className = "thought-rich-editor";
  host.append(editor.view.dom);
  document.body.append(host);
  editors.push(editor);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(host, "getBoundingClientRect").mockReturnValue({
    left: 200,
    top: 0,
    bottom: 1200,
    right: 1500,
    width: 1300,
    height: 1200,
  } as DOMRect);
  vi.spyOn(editor.view.dom, "getBoundingClientRect").mockReturnValue({
    left: 450,
    top: 100,
    bottom: 1200,
    width: 780,
    height: 1100,
  } as DOMRect);
  return editor;
}
it("extracts non-empty H1–H6, compresses skipped levels and keeps repeated titles distinct", () => {
  const editor = make();
  const outline = collectOutline(editor.state.doc);
  expect(
    outline.map(({ text, level, depth }) => ({ text, level, depth })),
  ).toEqual([
    { text: "一", level: 1, depth: 0 },
    { text: "子节", level: 3, depth: 1 },
    { text: "同级", level: 2, depth: 1 },
    { text: "同级", level: 2, depth: 1 },
    { text: "深层", level: 6, depth: 2 },
  ]);
  expect(new Set(outline.map((heading) => heading.position)).size).toBe(5);
});
it("preserves all six heading levels and their actual parent positions", () => {
  const editor = make(
    Array.from(
      { length: 6 },
      (_, index) => `<h${index + 1}>层级${index + 1}</h${index + 1}>`,
    ).join(""),
  );
  const headings = collectOutline(editor.state.doc);
  expect(headings.map((heading) => heading.depth)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(headings.map((heading) => heading.parent)).toEqual([
    null,
    ...headings.slice(0, -1).map((heading) => heading.position),
  ]);
});
it("updates headings after edits, undo, redo and document replacement", () => {
  const editor = make("<h1>原始标题</h1>");
  function Probe() {
    const { headings } = useDocumentOutline(editor);
    return <p>{headings.map((h) => h.text).join("|")}</p>;
  }
  render(<Probe />);
  act(() => {
    editor.commands.insertContentAt(1, "新增");
  });
  expect(
    screen.getByText("新增原始标题", { selector: "p" }),
  ).toBeInTheDocument();
  act(() => {
    editor.commands.undo();
  });
  expect(screen.getByText("原始标题", { selector: "p" })).toBeInTheDocument();
  act(() => {
    editor.commands.redo();
  });
  expect(
    screen.getByText("新增原始标题", { selector: "p" }),
  ).toBeInTheDocument();
  act(() => {
    editor.commands.setContent("<h2>另一个文档</h2>", { emitUpdate: false });
  });
  expect(screen.getByText("另一个文档", { selector: "p" })).toBeInTheDocument();
  act(() => {
    editor.commands.setContent("<p>删除标题后保留正文</p>");
  });
  expect(collectOutline(editor.state.doc)).toEqual([]);
  expect(screen.queryByText("另一个文档", { selector: "p" })).toBeNull();
});
it("waits until composition ends before changing outline labels", async () => {
  const editor = make("<h1>标题</h1>");
  function Probe() {
    const { headings } = useDocumentOutline(editor);
    return <p>{headings.map((h) => h.text).join("|")}</p>;
  }
  render(<Probe />);
  fireEvent.compositionStart(editor.view.dom);
  act(() => {
    editor.commands.insertContentAt(1, "输入中");
  });
  expect(screen.getByText("标题")).toBeInTheDocument();
  fireEvent.compositionEnd(editor.view.dom);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(screen.getByText("输入中标题", { selector: "p" })).toBeInTheDocument();
});
it("navigates by node position without changing the document or selection", async () => {
  const editor = make();
  const before = editor.getJSON();
  const selection = editor.state.selection;
  const scroll = vi.fn();
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  const target = editor.view.nodeDOM(
    collectOutline(editor.state.doc)[1].position,
  ) as HTMLElement;
  target.scrollIntoView = scroll;
  const update = vi.fn();
  editor.on("update", update);
  render(<DocumentOutline editor={editor} title="示例文档" />);
  fireEvent.click(screen.getByRole("button", { name: "子节" }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(scroll).toHaveBeenCalled();
  expect(editor.getJSON()).toEqual(before);
  expect(editor.state.selection).toEqual(selection);
  expect(update).not.toHaveBeenCalled();
});
it("temporarily reveals details and closes them without a document update", async () => {
  const editor = make();
  editor.commands.setContent({
    type: "doc",
    content: [
      {
        type: "details",
        attrs: { open: false },
        content: [
          { type: "detailsSummary", content: [{ type: "text", text: "折叠" }] },
          {
            type: "detailsContent",
            content: [
              {
                type: "heading",
                attrs: { level: 2 },
                content: [{ type: "text", text: "内部标题" }],
              },
            ],
          },
        ],
      },
    ],
  });
  const before = editor.getJSON();
  const heading = editor.view.nodeDOM(
    collectOutline(editor.state.doc)[0].position,
  ) as HTMLElement;
  const restores = new Map<HTMLElement, () => void>();
  const update = vi.fn();
  editor.on("update", update);
  revealOutlineTarget(heading, restores);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  const content = editor.view.dom.querySelector<HTMLElement>(
    '[data-type="detailsContent"]',
  )!;
  expect(content.hidden).toBe(false);
  fireEvent.click(
    editor.view.dom.querySelector('[data-type="details"] > button')!,
  );
  expect(content.hidden).toBe(true);
  expect(restores.size).toBe(0);
  expect(editor.getJSON()).toEqual(before);
  expect(update).not.toHaveBeenCalled();
});
it("keeps panel preference in its page owner and portals tools without sharing state between pages", () => {
  const editor = make();
  function Page() {
    const ui = useDocumentChrome();
    const [title, setTitle] = useState("文档一");
    return (
      <>
        <div role="banner" data-testid="toolbar" ref={ui.toolsRef} />
        <button onClick={() => setTitle("文档二")}>切换文章</button>
        <DocumentOutline
          key={title}
          editor={editor}
          title={title}
          chrome={ui.chrome}
          tools={<button>查找</button>}
        />
      </>
    );
  }
  const page = render(<Page />);
  expect(screen.getByTestId("toolbar")).toContainElement(
    screen.getByRole("button", { name: "查找" }),
  );
  expect(document.querySelector(".thought-document-tools")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "收起文档大纲" }));
  fireEvent.click(screen.getByRole("button", { name: "切换文章" }));
  expect(screen.queryByRole("navigation", { name: "文档章节" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "文档大纲" }));
  expect(screen.getByRole("navigation", { name: "文档章节" })).toBeVisible();
  page.unmount();
  render(<Page />);
  expect(screen.getByRole("navigation", { name: "文档章节" })).toBeVisible();
});
it("folds nested descendants independently and maps folded headings through edits and undo", () => {
  const editor = make("<h1>父级</h1><h3>子级</h3><h6>末级</h6><h2>同级</h2>");
  const before = editor.getJSON();
  render(<DocumentOutline editor={editor} title="层级示例" />);
  fireEvent.click(screen.getByRole("button", { name: "收起子级的子章节" }));
  expect(screen.getByRole("button", { name: "子级" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "末级" })).toBeNull();
  expect(editor.getJSON()).toEqual(before);
  act(() => {
    editor.commands.insertContentAt(0, "<p>前插内容</p>");
  });
  expect(
    screen.getByRole("button", { name: "展开子级的子章节" }),
  ).toHaveAttribute("aria-expanded", "false");
  act(() => {
    editor.commands.undo();
  });
  expect(
    screen.getByRole("button", { name: "展开子级的子章节" }),
  ).toHaveAttribute("aria-expanded", "false");
  act(() => {
    editor.commands.redo();
  });
  expect(screen.queryByRole("button", { name: "末级" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "收起父级的子章节" }));
  expect(screen.queryByRole("button", { name: "子级" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "展开父级的子章节" }));
  expect(screen.queryByRole("button", { name: "末级" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "展开子级的子章节" }));
  expect(screen.getByRole("button", { name: "末级" })).toBeVisible();
  act(() => {
    editor.commands.setContent("<p>无标题</p>");
  });
  fireEvent.click(screen.getByRole("button", { name: "文档大纲" }));
  expect(screen.getByText("使用标题样式生成文档目录")).toBeInTheDocument();
});
it("reveals the active heading's ancestors after scrolling, without undoing a manual fold at the same position", async () => {
  const editor = make("<h1>父级</h1><h2>子级</h2><h3>末级</h3>");
  const headings = collectOutline(editor.state.doc);
  let at = -1;
  headings.forEach((h, i) => {
    const el = editor.view.nodeDOM(h.position) as HTMLElement;
    vi.spyOn(el, "getClientRects").mockReturnValue([
      {},
    ] as unknown as DOMRectList);
    vi.spyOn(el, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          top: i <= at ? 0 : 400 + i * 80,
          bottom: i <= at ? 20 : 420 + i * 80,
        }) as DOMRect,
    );
  });
  render(<DocumentOutline editor={editor} title="示例" />);
  fireEvent.click(screen.getByRole("button", { name: "收起父级的子章节" }));
  at = 2;
  await act(async () => {
    fireEvent.scroll(window);
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  expect(screen.getByRole("button", { name: "末级" })).toHaveAttribute(
    "aria-current",
    "location",
  );
  fireEvent.click(screen.getByRole("button", { name: "收起父级的子章节" }));
  await act(async () => {
    fireEvent.scroll(window);
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  expect(screen.queryByRole("button", { name: "末级" })).toBeNull();
});
