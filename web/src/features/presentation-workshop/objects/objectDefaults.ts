import type { SlideElement } from "../types";
import { newElement } from "../templates";

export type ObjectKind = "table" | "chart" | "formula" | "audio" | "video";
export const cell = (text = "") => ({
  text,
  fill: "#FFFFFF",
  color: "#17334A",
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  align: "left" as const,
  row_span: 1,
  col_span: 1,
  covered: false,
});
export function newObject(kind: ObjectKind): SlideElement {
  const content: Partial<SlideElement> =
    kind === "table"
      ? {
          table: {
            rows: [
              [cell("项目"), cell("数值")],
              [cell("示例"), cell("100")],
            ],
            column_widths: [1, 1],
            font_size: 20,
            border_color: "#CDD5DE",
            border_width: 1,
          },
        }
      : kind === "chart"
        ? {
            chart: {
              type: "column",
              categories: ["第一项", "第二项", "第三项"],
              series: [{ name: "系列 1", values: [12, 24, 18] }],
              colors: ["#5474E5", "#18A999", "#F0AD4E"],
              stacked: false,
              smooth: false,
              axis_color: "#56677A",
              grid_color: "#DDE4EB",
            },
          }
        : kind === "formula"
          ? { formula: { latex: "E = mc^2", color: "#17334A", size: 36 } }
          : {
              media: {
                poster_asset_id: null,
                autoplay: false,
                loop: false,
                icon_color: "#5474E5",
              },
            };
  return newElement(kind, {
    width: kind === "audio" ? 100 : 560,
    height: kind === "audio" ? 100 : kind === "formula" ? 140 : 320,
    ...content,
  });
}
export const objectLabels: Record<ObjectKind, string> = {
  table: "表格",
  chart: "图表",
  formula: "公式",
  audio: "音频",
  video: "视频",
};
