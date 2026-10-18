import { codeLanguages, codePalettes, type CodePalette } from "./codeHighlight";
import { newElement, newId, defaultRun } from "./templates";
import type { Paragraph } from "./types";
import type { Fragment } from "./scene/model";

/** An editable code block uses the same native shapes, text and group contract. */
export function codeBlock(
  paragraphs: Paragraph[],
  language: string,
  palette: CodePalette,
): Fragment {
  const colors = codePalettes[palette];
  const contentHeight = paragraphs.reduce(
    (sum, p) => sum + Math.max(...p.runs.map((r) => r.size)) * p.line_height,
    0,
  );
  if (contentHeight > 400)
    throw new Error("代码块高度超过页面空间，请减小字号或拆分代码。");
  for (const p of paragraphs) {
    const width = p.runs.reduce(
      (sum, r) =>
        sum +
        [...r.text].reduce(
          (w, ch) =>
            w +
            r.size *
              (ch === "\t"
                ? 4 * 0.62
                : (ch.codePointAt(0) ?? 0) > 255
                  ? 1
                  : 0.62),
          0,
        ),
      0,
    );
    if (width > 1072)
      throw new Error("代码行超出代码块宽度，请换行或减小字号。");
  }
  const label =
    codeLanguages.find((item) => item.value === language)?.label ?? language;
  const elements = [
    newElement("roundRect", {
      x: 80,
      y: 160,
      width: 1120,
      height: 80 + contentHeight,
      fill: colors.background,
      stroke: palette === "light" ? "#CAD5E0" : "#3F5870",
      stroke_width: 1,
      corner_radius: 10,
    }),
    newElement("text", {
      x: 96,
      y: 168,
      width: 1088,
      height: 34,
      paragraphs: [
        {
          align: "left",
          bullet: false,
          line_height: 1.3,
          runs: [
            {
              ...defaultRun(label),
              font: "Consolas",
              size: 14,
              color: colors.comment,
            },
          ],
        },
      ],
    }),
    newElement("rect", {
      x: 104,
      y: 205,
      width: 1072,
      height: 1,
      fill: palette === "light" ? "#D8E0E8" : "#36516A",
      stroke_width: 0,
    }),
    newElement("text", {
      x: 96,
      y: 214,
      width: 1088,
      height: 16 + contentHeight,
      paragraphs,
    }),
  ];
  return {
    elements,
    groups: [
      {
        id: newId(),
        name: `代码块 · ${label}`,
        parent_id: null,
        element_ids: elements.map((e) => e.id),
      },
    ],
    connections: [],
    infographics: [],
  };
}
