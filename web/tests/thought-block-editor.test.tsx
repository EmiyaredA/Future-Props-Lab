import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { NodeRangeSelection } from "@tiptap/extension-node-range";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BlockInsertMenu,
  type BlockInsertMenuHandle,
} from "@features/thought-workshop/BlockInsertMenu";
import {
  copyBlockSelection,
  deleteBlockSelection,
  moveSelectedBlock,
  runInsertCommand,
} from "@features/thought-workshop/blockCommands";
import { editorExtensions } from "@features/thought-workshop/editorExtensions";
import {
  findMarqueeTargets,
  isGutterPointer,
} from "@features/thought-workshop/blockSelection";

const callbacks = {
  image: vi.fn(),
  attachment: vi.fn(),
  math: vi.fn(),
};

function makeEditor() {
  return new Editor({
    extensions: editorExtensions(),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "第一块", marks: [{ type: "bold" }] },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "第二块" }] },
        {
          type: "image",
          attrs: { assetId: "asset-a", width: 320, alt: "插图" },
        },
      ],
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  callbacks.image.mockClear();
  callbacks.attachment.mockClear();
  callbacks.math.mockClear();
});

describe("思绪工坊块命令", () => {
  it("uses a selection-only transaction for a contiguous block range", () => {
    const updated = vi.fn();
    const editor = makeEditor();
    editor.on("update", updated);
    const secondEnd =
      editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        NodeRangeSelection.create(editor.state.doc, 0, secondEnd),
      ),
    );
    expect(editor.state.selection).toBeInstanceOf(NodeRangeSelection);
    expect(editor.state.selection.ranges).toHaveLength(2);
    expect(updated).toHaveBeenCalled();
    expect(
      updated.mock.calls.every(([event]) => !event.transaction.docChanged),
    ).toBe(true);
    editor.destroy();
  });

  it("copies HTML and plain text without changing the document", async () => {
    const editor = makeEditor();
    const firstSize = editor.state.doc.child(0).nodeSize;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        NodeRangeSelection.create(editor.state.doc, 0, firstSize),
      ),
    );
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      "ClipboardItem",
      class ClipboardItemMock {
        constructor(public readonly data: Record<string, Blob>) {}
      },
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });
    const before = editor.getJSON();
    await copyBlockSelection(editor);
    expect(editor.getJSON()).toEqual(before);
    const item = write.mock.calls[0][0][0] as { data: Record<string, Blob> };
    expect(item.data["text/plain"].type).toBe("text/plain");
    expect(item.data["text/html"].type).toBe("text/html");
    expect(item.data["text/html"].size).toBeGreaterThan(
      item.data["text/plain"].size,
    );
    editor.destroy();
  });

  it("deletes every selected block in one undoable change and keeps a valid paragraph", () => {
    const editor = makeEditor();
    editor.view.dispatch(
      editor.state.tr.setSelection(
        NodeRangeSelection.create(
          editor.state.doc,
          0,
          editor.state.doc.content.size,
        ),
      ),
    );
    deleteBlockSelection(editor);
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getText()).toContain("第一块");
    expect(editor.getJSON().content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "image",
          attrs: expect.objectContaining({ assetId: "asset-a" }),
        }),
      ]),
    );
    editor.destroy();
  });

  it("moves a selected block while preserving its marks and atom attributes", () => {
    const editor = makeEditor();
    const firstSize = editor.state.doc.child(0).nodeSize;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        NodeRangeSelection.create(editor.state.doc, 0, firstSize),
      ),
    );
    expect(moveSelectedBlock(editor, 1)).toBe(true);
    expect(editor.state.doc.child(1).textContent).toBe("第一块");
    expect(editor.state.doc.child(1).firstChild?.marks[0]?.type.name).toBe(
      "bold",
    );
    editor.commands.undo();
    const imagePos =
      editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize;
    const image = editor.state.doc.nodeAt(imagePos)!;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        NodeRangeSelection.create(
          editor.state.doc,
          imagePos,
          imagePos + image.nodeSize,
        ),
      ),
    );
    expect(moveSelectedBlock(editor, -1)).toBe(true);
    expect(editor.state.doc.child(1).attrs.assetId).toBe("asset-a");
    editor.destroy();
  });

  it("routes uploads and formulas through the shared insert commands", () => {
    const editor = makeEditor();
    const end = editor.state.doc.content.size;
    runInsertCommand(editor, "image", callbacks, end);
    runInsertCommand(editor, "attachment", callbacks, end);
    runInsertCommand(editor, "math", callbacks, end);
    runInsertCommand(editor, "table", callbacks, end);
    expect(callbacks.image).toHaveBeenCalledWith(end);
    expect(callbacks.attachment).toHaveBeenCalledWith(end);
    expect(callbacks.math).toHaveBeenCalledWith(false, end);
    expect(
      editor.getJSON().content?.some((node) => node.type === "table"),
    ).toBe(true);
    editor.destroy();
  });

  it("does not register block-selection or slash interactions in read-only mode", () => {
    const editor = new Editor({
      extensions: editorExtensions(undefined, true),
      editable: false,
    });
    expect(
      editor.extensionManager.extensions.map((extension) => extension.name),
    ).not.toContain("nodeRange");
    expect(
      editor.extensionManager.extensions.map((extension) => extension.name),
    ).not.toContain("thoughtSlashCommand");
    editor.destroy();
  });
});

describe("共享插入菜单", () => {
  it("filters and supports Home, End, arrows, Enter and Escape", () => {
    const command = vi.fn();
    const close = vi.fn();
    const ref = createRef<BlockInsertMenuHandle>();
    render(
      <BlockInsertMenu
        ref={ref}
        searchable
        command={command}
        onClose={close}
      />,
    );
    const input = screen.getByRole("textbox", { name: "筛选插入内容" });
    fireEvent.change(input, { target: { value: "表格" } });
    expect(screen.getByRole("option", { name: /表格/ })).toBeVisible();
    fireEvent.keyDown(input, { key: "End" });
    fireEvent.keyDown(input, { key: "Home" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({ key: "table" }),
    );
    ref.current?.onKeyDown(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(close).toHaveBeenCalled();
  });
});

describe("留白框选策略", () => {
  const rect = (left: number, top: number, right: number, bottom: number) =>
    ({
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
      x: left,
      y: top,
      toJSON() {},
    }) as DOMRect;

  it("starts only outside the prose body", () => {
    const prose = rect(100, 0, 700, 600);
    expect(isGutterPointer(prose, 72)).toBe(true);
    expect(isGutterPointer(prose, 320)).toBe(false);
    expect(isGutterPointer(prose, 730)).toBe(true);
  });

  it("selects list items within one list and normalizes mixed ranges to top-level blocks", () => {
    const prose = document.createElement("div");
    const list = document.createElement("ul");
    const first = document.createElement("li");
    const second = document.createElement("li");
    const paragraph = document.createElement("p");
    list.append(first, second);
    prose.append(list, paragraph);
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue(
      rect(100, 20, 700, 120),
    );
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue(
      rect(120, 20, 680, 65),
    );
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue(
      rect(120, 66, 680, 120),
    );
    vi.spyOn(paragraph, "getBoundingClientRect").mockReturnValue(
      rect(100, 130, 700, 180),
    );
    expect(
      findMarqueeTargets(prose, 28, 110, {
        left: 60,
        top: 25,
        right: 710,
        bottom: 115,
      }),
    ).toEqual([first, second]);
    expect(
      findMarqueeTargets(prose, 28, 160, {
        left: 60,
        top: 25,
        right: 710,
        bottom: 165,
      }),
    ).toEqual([list, paragraph]);
  });
});
