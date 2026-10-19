import type { JSONContent } from "@tiptap/core";
import type { Paragraph, TextRun } from "./types";
import { defaultRun } from "./templates";

function runColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  // The browser serializes hex styles as rgb() when pasted marks are parsed.
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(value);
  if (!rgb) return fallback;
  const channels = rgb.slice(1).map(Number);
  if (channels.some((channel) => channel > 255)) return fallback;
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function toEditor(paragraphs: Paragraph[]): JSONContent {
  return {
    type: "doc",
    content: paragraphs.map((p) => ({
      type: "paragraph",
      attrs: {
        textAlign: p.align,
        lineHeight: p.line_height,
        bullet: p.bullet,
        numbered: p.numbered ?? false,
      },
      content: p.runs.flatMap((run) => {
        const marks = [
          {
            type: "textStyle",
            attrs: {
              fontFamily: run.font,
              fontSize: `${run.size}px`,
              color: run.color,
            },
          },
          ...(run.bold ? [{ type: "bold" }] : []),
          ...(run.italic ? [{ type: "italic" }] : []),
          ...(run.underline ? [{ type: "underline" }] : []),
        ];
        return run.text
          .split("\n")
          .flatMap((part, i) => [
            ...(i ? [{ type: "hardBreak" }] : []),
            ...(part ? [{ type: "text", text: part, marks }] : []),
          ]);
      }),
    })),
  };
}
export function fromEditor(
  document: JSONContent,
  fallback: TextRun,
): Paragraph[] {
  return (document.content ?? [{ type: "paragraph" }]).map((p) => ({
    align: ["left", "center", "right"].includes(p.attrs?.textAlign)
      ? p.attrs?.textAlign
      : "left",
    line_height: Number(p.attrs?.lineHeight) || 1.3,
    bullet: !!p.attrs?.bullet,
    numbered: !!p.attrs?.numbered,
    runs: (p.content?.length ? p.content : [{ type: "text", text: "" }]).map(
      (node) => {
        const marks = node.marks ?? [],
          style = marks.find((m) => m.type === "textStyle")?.attrs;
        return {
          ...defaultRun(),
          ...fallback,
          text: node.type === "hardBreak" ? "\n" : (node.text ?? ""),
          font:
            style?.fontFamily === "Consolas"
              ? "Consolas"
              : style?.fontFamily === "Arial"
                ? "Arial"
                : style?.fontFamily === "Microsoft YaHei"
                  ? "Microsoft YaHei"
                  : fallback.font,
          size: Math.min(
            240,
            Math.max(6, parseFloat(style?.fontSize) || fallback.size),
          ),
          color: runColor(style?.color, fallback.color),
          bold: marks.some((m) => m.type === "bold"),
          italic: marks.some((m) => m.type === "italic"),
          underline: marks.some((m) => m.type === "underline"),
        };
      },
    ),
  }));
}

export function fontFamily(font: TextRun["font"]): string {
  return font === "Consolas"
    ? '"Consolas", "Courier New", monospace'
    : `"${font}", "PingFang SC", sans-serif`;
}
