import { useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SlideTextEditor } from "@features/presentation-workshop/SlideTextEditor";
import { newElement } from "@features/presentation-workshop/templates";

function clipboard(values: Record<string, string> = {}) {
  const data = new Map(Object.entries(values));
  return {
    getData: (type: string) => data.get(type) ?? "",
    setData: (type: string, value: string) => data.set(type, value),
    clearData: () => data.clear(),
    get types() {
      return [...data.keys()];
    },
  };
}

async function mount() {
  let editor: Editor | null = null;
  const change = vi.fn();
  const outerPaste = vi.fn();
  function Harness() {
    const [element, setElement] = useState(() => newElement("text"));
    return (
      <div onPaste={outerPaste}>
        <SlideTextEditor
          element={element}
          onChange={(paragraphs) => {
            change(paragraphs);
            setElement((old) => ({ ...old, paragraphs }));
          }}
          onReady={(ready) => {
            editor = ready;
          }}
          onComposition={vi.fn()}
          onExit={vi.fn()}
        />
      </div>
    );
  }
  render(<Harness />);
  await waitFor(() => expect(editor).not.toBeNull());
  const active = editor!;
  // JSDOM has no layout geometry for ProseMirror's scroll-to-selection path.
  active.view.setProps({ handleScrollToSelection: () => true });
  act(() => {
    active.commands.setContent("<p>原始内容</p>");
    active.commands.selectAll();
    active.commands.setColor("#123456");
  });
  change.mockClear();
  return {
    editor: active,
    textbox: screen.getByRole("textbox", { name: "编辑幻灯片文字" }),
    change,
    outerPaste,
  };
}

it.each([false, true])(
  "粘贴纯文本或富文本剪贴板时替换选区并保留换行：HTML=$0",
  async (rich) => {
    const { textbox, editor, change, outerPaste } = await mount();
    fireEvent.paste(textbox, {
      clipboardData: clipboard({
        "text/plain": "第一行\n第二行",
        ...(rich ? { "text/html": "<p><b>第一行</b></p><p>第二行</p>" } : {}),
      }),
    });
    expect(editor.getText()).toBe("第一行\n\n第二行");
    expect(editor.isActive("bold")).toBe(false);
    expect(change).toHaveBeenCalledTimes(1);
    expect(change.mock.calls[0][0][0].runs[0].color).toBe("#123456");
    expect(
      change.mock.calls[0][0].map((p: { runs: { text: string }[] }) =>
        p.runs.map((r) => r.text).join(""),
      ),
    ).toEqual(["第一行", "第二行"]);
    expect(outerPaste).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPrevented: true }),
    );
  },
);

it("复制选中文字后可在同一文本框粘贴，复制不会修改正文", async () => {
  const { textbox, editor, change } = await mount();
  const data = clipboard();
  fireEvent.copy(textbox, { clipboardData: data });
  expect(data.getData("text/plain")).toBe("原始内容");
  expect(data.getData("text/html")).toContain("原始内容");
  expect(change).not.toHaveBeenCalled();
  act(() => {
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  });
  fireEvent.paste(textbox, { clipboardData: data });
  expect(editor.getText()).toBe("原始内容原始内容");
  expect(change).toHaveBeenCalledTimes(1);
});

it("不含文字的剪贴板不删除当前选区", async () => {
  const { textbox, editor, change } = await mount();
  fireEvent.paste(textbox, {
    clipboardData: clipboard({ "text/html": '<img src="example.png">' }),
  });
  expect(editor.getText()).toBe("原始内容");
  expect(editor.state.selection.empty).toBe(false);
  expect(change).not.toHaveBeenCalled();
});
