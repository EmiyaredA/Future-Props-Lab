import { common, createLowlight } from "lowlight";
import type { RootContent } from "hast";
import type { Paragraph, TextRun } from "./types";

const highlighter = createLowlight(common);
export const codeLanguages = [
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "python", label: "Python" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "xml", label: "HTML / XML" },
  { value: "css", label: "CSS" },
  { value: "bash", label: "Shell" },
  { value: "sql", label: "SQL" },
  { value: "plaintext", label: "纯文本" },
];
export const codePalettes = {
  light: {
    background: "#F3F5F8",
    text: "#26364A",
    keyword: "#8839A6",
    string: "#19733D",
    number: "#A34B00",
    literal: "#A34B00",
    attr: "#165EAB",
    attribute: "#165EAB",
    title: "#165EAB",
    name: "#A62B3B",
    tag: "#A62B3B",
    comment: "#627286",
    meta: "#8839A6",
    built_in: "#006F82",
    variable: "#A34B00",
    property: "#165EAB",
    params: "#26364A",
    punctuation: "#526479",
    selector_tag: "#A62B3B",
    selector_class: "#165EAB",
  },
  dark: {
    background: "#14283B",
    text: "#E4EDF6",
    keyword: "#D5A2F5",
    string: "#A4DA9B",
    number: "#F2B77C",
    literal: "#F2B77C",
    attr: "#85C6F4",
    attribute: "#85C6F4",
    title: "#86D8E1",
    name: "#FF9EA4",
    tag: "#FF9EA4",
    comment: "#A5B2C1",
    meta: "#D5A2F5",
    built_in: "#86D8E1",
    variable: "#F2B77C",
    property: "#85C6F4",
    params: "#E4EDF6",
    punctuation: "#A5B2C1",
    selector_tag: "#FF9EA4",
    selector_class: "#85C6F4",
  },
};
export type CodePalette = keyof typeof codePalettes;

export function codeSource(paragraphs: Paragraph[]) {
  return paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("\n");
}

/** Resolve tokens to the existing native contract, never persisted HTML or CSS. */
export function highlightCode(
  source: string,
  language: string,
  palette: CodePalette = "light",
  size = 16,
  lineHeight = 1.3,
): Paragraph[] {
  source = source.replace(/\r\n?/g, "\n");
  if (source.length > 12000 || source.split("\n").length > 150)
    throw new Error("代码超过 12000 字或 150 行，请拆成多个文本框。");
  if (
    !Number.isFinite(size) ||
    size < 6 ||
    size > 240 ||
    !Number.isFinite(lineHeight) ||
    lineHeight < 1 ||
    lineHeight > 3
  )
    throw new Error("字号或行距超出文本格式范围。");
  const colors = codePalettes[palette];
  const paragraphs: Paragraph[] = [];
  let runs: TextRun[] = [];
  const run = (text: string, color: string): TextRun => ({
    text,
    color,
    font: "Consolas",
    size,
    bold: false,
    italic: false,
    underline: false,
  });
  const finish = () => {
    if (runs.length > 1000) throw new Error("单行语法片段过多，请拆分代码。");
    paragraphs.push({
      align: "left",
      bullet: false,
      line_height: lineHeight,
      runs: runs.length ? runs : [run("", colors.text)],
    });
    runs = [];
  };
  const append = (text: string, color: string) => {
    text.split("\n").forEach((part, index) => {
      if (index) finish();
      if (!part) return;
      const last = runs.at(-1);
      if (last?.color === color) last.text += part;
      else runs.push(run(part, color));
    });
  };
  const walk = (node: RootContent, inherited = colors.text) => {
    if (node.type === "text") append(node.value, inherited);
    else if (node.type === "element") {
      let color = inherited;
      for (const cls of node.properties.className ?? []) {
        const key = String(cls)
          .replace(/^hljs-/, "")
          .replaceAll("-", "_") as keyof typeof colors;
        if (key !== "background" && key in colors) color = colors[key];
      }
      node.children.forEach((child) => walk(child, color));
    }
  };
  if (language !== "plaintext" && highlighter.registered(language))
    highlighter
      .highlight(language, source)
      .children.forEach((node) => walk(node));
  else append(source, colors.text);
  finish();
  return paragraphs;
}
