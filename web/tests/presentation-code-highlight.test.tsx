import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  codeSource,
  highlightCode,
} from "@features/presentation-workshop/codeHighlight";
import CodeHighlightDialog from "@features/presentation-workshop/CodeHighlightDialog";
import { ElementContent } from "@features/presentation-workshop/SlideSurface";
import {
  fromEditor,
  toEditor,
} from "@features/presentation-workshop/textAdapter";
import { newElement } from "@features/presentation-workshop/templates";
import { codeBlock } from "@features/presentation-workshop/codeBlock";

describe("native slide code highlighting", () => {
  it("creates a native grouped block and rejects oversized layouts before insertion", () => {
    const paragraphs = highlightCode('{"message": "中文"}', "json", "dark", 20);
    const block = codeBlock(paragraphs, "json", "dark");
    expect(block.elements.map((e) => e.kind)).toEqual([
      "roundRect",
      "text",
      "rect",
      "text",
    ]);
    expect(block.elements[0].fill).toBe("#14283B");
    expect(block.elements[3].paragraphs).toEqual(paragraphs);
    expect(block.groups?.[0].element_ids).toEqual(
      block.elements.map((e) => e.id),
    );
    expect(
      block.elements.every(
        (e) =>
          e.x >= 0 &&
          e.y >= 0 &&
          e.x + e.width <= 1280 &&
          e.y + e.height <= 720,
      ),
    ).toBe(true);
    expect(() =>
      codeBlock(
        highlightCode("x\n".repeat(40), "plaintext"),
        "plaintext",
        "light",
      ),
    ).toThrow("高度");
    expect(() =>
      codeBlock(
        highlightCode("x".repeat(180), "plaintext", "light", 20),
        "plaintext",
        "light",
      ),
    ).toThrow("宽度");
  });
  it("keeps indentation, blank lines, Chinese, tabs and trailing newline through editing", () => {
    const source = '{\n  "正文": "中文",\n\n\t"count": 12\n}\n';
    const paragraphs = highlightCode(source, "json", "light", 18, 1.4);
    expect(codeSource(paragraphs)).toBe(source);
    expect(paragraphs).toHaveLength(6);
    const edited = fromEditor(toEditor(paragraphs), paragraphs[0].runs[0]);
    expect(codeSource(edited)).toBe(source);
    expect(edited.map((p) => p.runs.filter((r) => r.text))).toEqual(
      paragraphs.map((p) => p.runs.filter((r) => r.text)),
    );
    const colors = paragraphs.flatMap((p) => p.runs.map((r) => r.color));
    expect(colors).toContain("#165EAB"); // JSON keys
    expect(colors).toContain("#19733D"); // string values
    expect(colors).toContain("#A34B00"); // numbers
    expect(
      paragraphs.every(
        (p) =>
          p.line_height === 1.4 &&
          !p.bullet &&
          p.runs.every((r) => r.font === "Consolas" && r.size === 18),
      ),
    ).toBe(true);
  });

  it("inherits multiline token colors and keeps unknown languages as plain text", () => {
    const source = '# 注释\ndef query():\n    return """first\nsecond"""';
    const paragraphs = highlightCode(source, "python", "dark");
    expect(codeSource(paragraphs)).toBe(source);
    expect(paragraphs[0].runs[0].color).toBe("#A5B2C1");
    expect(paragraphs[3].runs[0].color).toBe("#A4DA9B");
    expect(codeSource(highlightCode(source, "unknown"))).toBe(source);
    expect(highlightCode("a\r\nb\rc", "plaintext")).toHaveLength(3);
  });

  it("renders HTML examples as literal text with colors, without executing markup", () => {
    const source = '<script>alert("hello")</script>\n<img src="demo.png" />';
    const paragraphs = highlightCode(source, "xml");
    const { container } = render(
      <ElementContent element={newElement("text", { paragraphs })} />,
    );
    expect(container.querySelectorAll("script, img")).toHaveLength(0);
    expect(container.textContent).toBe(source.replaceAll("\n", ""));
    expect(
      new Set(paragraphs.flatMap((p) => p.runs.map((r) => r.color))).size,
    ).toBeGreaterThan(2);
  });

  it("rejects oversized input without truncation or replacing the original text", () => {
    expect(() => highlightCode("x".repeat(12001), "python")).toThrow("12000");
    expect(() => highlightCode("\n".repeat(150), "python")).toThrow("150");
    expect(() => highlightCode("x", "json", "light", NaN)).toThrow("字号");
  });

  it("previews before applying, respects the current font size, and cancels safely", async () => {
    const user = userEvent.setup();
    const element = newElement("text", {
      height: 20,
      paragraphs: highlightCode('{"count": 2}', "plaintext", "light", 21),
    });
    const before = structuredClone(element);
    const apply = vi.fn(),
      close = vi.fn();
    const view = render(
      <CodeHighlightDialog element={element} onApply={apply} onClose={close} />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "代码内容" }), {
      target: { value: '{\n  "count": 3\n}' },
    });
    expect(screen.getByRole("status").textContent).toContain("加高文本框");
    expect(apply).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "应用高亮" }));
    expect(codeSource(apply.mock.calls[0][0])).toBe('{\n  "count": 3\n}');
    expect(apply.mock.calls[0][0][0].runs[0].size).toBe(21);
    expect(element).toEqual(before);
    view.unmount();
    render(
      <CodeHighlightDialog element={element} onApply={apply} onClose={close} />,
    );
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(2);
  });
});
