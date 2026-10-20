import { useEffect, useReducer, useRef } from "react";
import type { Editor } from "@tiptap/react";
import type { Paragraph, SlideElement, TextRun } from "./types";
import { defaultRun } from "./templates";
import { fromEditor } from "./textAdapter";
import { paragraphListType, type ListType } from "./paragraphLists";

type RunStyle = Omit<TextRun, "text">;
export function commonRunStyle(runs: TextRun[]): Partial<RunStyle> {
  const first = runs[0] ?? defaultRun();
  return Object.fromEntries(
    Object.entries(first).filter(
      ([key, value]) =>
        key !== "text" &&
        runs.every((run) => run[key as keyof TextRun] === value),
    ),
  ) as Partial<RunStyle>;
}
export function useSelectionFormat(
  element: SlideElement | undefined,
  editor: Editor | null,
  patch: (value: Partial<SlideElement>) => void,
) {
  const [, refresh] = useReducer((n) => n + 1, 0);
  const saved = useRef<{ from: number; to: number } | null>(null);
  useEffect(() => {
    if (!editor) {
      saved.current = null;
      return;
    }
    const update = () => {
      saved.current = {
        from: editor.state.selection.from,
        to: editor.state.selection.to,
      };
      refresh();
    };
    update();
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);
  const fallback = element?.paragraphs[0]?.runs[0] ?? defaultRun();
  let runs = element?.paragraphs.flatMap((p) => p.runs) ?? [];
  const paragraphs = element?.paragraphs ?? [];
  let align: Paragraph["align"] | undefined = paragraphs[0]?.align;
  let lineHeight: number | undefined = paragraphs[0]?.line_height;
  let listType: ListType | undefined = paragraphs[0]
    ? paragraphListType(paragraphs[0])
    : "none";
  if (editor && !editor.isDestroyed) {
    const { from, to, empty, $from } = editor.state.selection;
    const nodes: {
      marks?: { type: string; attrs: Record<string, unknown> }[];
      type: string;
      text: string;
    }[] = [];
    const selectedParagraphs: Record<string, unknown>[] = [];
    if (empty) {
      nodes.push({
        type: "text",
        text: "",
        marks: (editor.state.storedMarks ?? $from.marks()).map((mark) => ({
          type: mark.type.name,
          attrs: mark.attrs,
        })),
      });
      selectedParagraphs.push($from.parent.attrs);
    } else
      editor.state.doc.nodesBetween(from, to, (node) => {
        if (node.isText) nodes.push(node.toJSON());
        if (node.type.name === "paragraph") selectedParagraphs.push(node.attrs);
      });
    runs = fromEditor(
      { type: "doc", content: [{ type: "paragraph", content: nodes }] },
      fallback,
    )[0].runs;
    const common = (key: string) =>
      selectedParagraphs.every((p) => p[key] === selectedParagraphs[0]?.[key])
        ? selectedParagraphs[0]?.[key]
        : undefined;
    align = common("textAlign") as Paragraph["align"] | undefined;
    lineHeight = common("lineHeight") as number | undefined;
    const lists = selectedParagraphs.map((p) =>
      paragraphListType({ bullet: !!p.bullet, numbered: !!p.numbered }),
    );
    listType = lists.every((value) => value === lists[0])
      ? lists[0]
      : undefined;
  } else {
    if (!paragraphs.every((p) => p.align === align)) align = undefined;
    if (!paragraphs.every((p) => p.line_height === lineHeight))
      lineHeight = undefined;
    if (!paragraphs.every((p) => paragraphListType(p) === listType))
      listType = undefined;
  }
  const chain = () => {
    if (!editor || editor.isDestroyed || editor.view.composing) return null;
    let commands = editor.chain();
    if (!(document.activeElement instanceof HTMLInputElement))
      commands = commands.focus();
    if (
      saved.current &&
      (saved.current.from !== editor.state.selection.from ||
        saved.current.to !== editor.state.selection.to)
    )
      commands = commands.setTextSelection(saved.current);
    return commands.setMeta("presentationFormat", true);
  };
  const format = (values: Partial<RunStyle>) => {
    if (!element || element.locked) return;
    if (editor) {
      const commands = chain();
      if (!commands) return;
      if (values.font) commands.setFontFamily(values.font);
      if (values.size) commands.setFontSize(`${values.size}px`);
      if (values.color) commands.setColor(values.color);
      if (values.bold !== undefined) {
        if (values.bold) commands.setBold();
        else commands.unsetBold();
      }
      if (values.italic !== undefined) {
        if (values.italic) commands.setItalic();
        else commands.unsetItalic();
      }
      if (values.underline !== undefined) {
        if (values.underline) commands.setUnderline();
        else commands.unsetUnderline();
      }
      if (values.strike !== undefined) {
        if (values.strike) commands.setStrike();
        else commands.unsetStrike();
      }
      if (values.code !== undefined) {
        if (values.code) commands.setCode();
        else commands.unsetCode();
      }
      if (values.highlight !== undefined) {
        if (values.highlight)
          commands.setHighlight({ color: values.highlight });
        else commands.unsetHighlight();
      }
      if (values.script !== undefined) {
        if (values.script === "normal") commands.unsetMark("script");
        else commands.setMark("script", { kind: values.script });
      }
      commands.run();
    } else
      patch({
        paragraphs: element.paragraphs.map((p) => ({
          ...p,
          runs: p.runs.map((r) => ({ ...r, ...values })),
        })),
      });
  };
  const paragraph = (values: Partial<Omit<Paragraph, "runs">>) => {
    if (!element || element.locked) return;
    if (editor) {
      const commands = chain();
      if (!commands) return;
      if (values.align) commands.setTextAlign(values.align);
      if (values.line_height !== undefined)
        commands.updateAttributes("paragraph", {
          lineHeight: values.line_height,
        });
      const fields = {
        indent: values.indent,
        firstLineIndent: values.first_line_indent,
        spaceBefore: values.space_before,
        spaceAfter: values.space_after,
      };
      commands.updateAttributes(
        "paragraph",
        Object.fromEntries(
          Object.entries(fields).filter(([, v]) => v !== undefined),
        ),
      );
      if (values.bullet !== undefined)
        commands.updateAttributes("paragraph", { bullet: values.bullet });
      if (values.numbered !== undefined)
        commands.updateAttributes("paragraph", { numbered: values.numbered });
      commands.run();
    } else
      patch({
        paragraphs: element.paragraphs.map((p) => ({ ...p, ...values })),
      });
  };
  return {
    style: commonRunStyle(runs),
    align,
    lineHeight,
    listType,
    format,
    paragraph,
  };
}
