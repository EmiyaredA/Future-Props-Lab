import type { JSONContent } from "@tiptap/core";
import type { Paragraph, TextRun, SlideElement } from "./types";
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
        indent: p.indent ?? 0,
        firstLineIndent: p.first_line_indent ?? 0,
        spaceBefore: p.space_before ?? 0,
        spaceAfter: p.space_after ?? 0,
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
          ...(run.strike ? [{ type: "strike" }] : []),
          ...(run.highlight
            ? [{ type: "highlight", attrs: { color: run.highlight } }]
            : []),
          ...(run.code ? [{ type: "code" }] : []),
          ...(run.script && run.script !== "normal"
            ? [{ type: "script", attrs: { kind: run.script } }]
            : []),
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
    ...(Number(p.attrs?.indent)
      ? { indent: Math.max(0, Math.min(8, Number(p.attrs?.indent))) }
      : {}),
    ...(Number(p.attrs?.firstLineIndent)
      ? { first_line_indent: Number(p.attrs?.firstLineIndent) }
      : {}),
    ...(Number(p.attrs?.spaceBefore)
      ? { space_before: Number(p.attrs?.spaceBefore) }
      : {}),
    ...(Number(p.attrs?.spaceAfter)
      ? { space_after: Number(p.attrs?.spaceAfter) }
      : {}),
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
          ...(marks.some((m) => m.type === "strike")
            ? { strike: true }
            : { ...(fallback.strike !== undefined ? { strike: false } : {}) }),
          ...(marks.some((m) => m.type === "highlight")
            ? {
                highlight: runColor(
                  marks.find((m) => m.type === "highlight")?.attrs?.color,
                  "#FFFF00",
                ),
              }
            : {
                ...(fallback.highlight !== undefined
                  ? { highlight: null }
                  : {}),
              }),
          ...(marks.some((m) => m.type === "code")
            ? { code: true }
            : { ...(fallback.code !== undefined ? { code: false } : {}) }),
          ...(marks.some((m) => m.type === "script")
            ? {
                script:
                  marks.find((m) => m.type === "script")?.attrs?.kind === "sub"
                    ? ("sub" as const)
                    : ("sup" as const),
              }
            : {
                ...(fallback.script !== undefined
                  ? { script: "normal" as const }
                  : {}),
              }),
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

export const canContainText = (kind: SlideElement["kind"]) =>
  ![
    "image",
    "vector",
    "formula",
    "audio",
    "video",
    "table",
    "chart",
    "line",
    "path",
  ].includes(kind);
