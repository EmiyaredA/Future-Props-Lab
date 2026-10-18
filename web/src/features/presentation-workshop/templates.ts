import { slideTheme } from "./slideTheme";
import type { Deck, Slide, SlideElement, TextRun } from "./types";
import { cloneFragment } from "./scene/model";

export const layouts = [
  { value: "blank", label: "空白" },
  { value: "cover", label: "封面" },
  { value: "body", label: "标题正文" },
  { value: "columns", label: "图文双栏" },
  { value: "ending", label: "结束页" },
];
export const shapes: { value: SlideElement["kind"]; label: string }[] = [
  { value: "rect", label: "矩形" },
  { value: "roundRect", label: "圆角矩形" },
  { value: "ellipse", label: "椭圆" },
  { value: "triangle", label: "三角形" },
  { value: "diamond", label: "菱形" },
  { value: "arrow", label: "箭头" },
  { value: "line", label: "直线" },
];
export const newId = () => crypto.randomUUID();
export const defaultRun = (text = "在此输入文字"): TextRun => ({
  text,
  font: "Microsoft YaHei",
  size: 28,
  color: slideTheme.navy,
  bold: false,
  italic: false,
  underline: false,
});
export function newElement(
  kind: SlideElement["kind"],
  patch: Partial<SlideElement> = {},
): SlideElement {
  return {
    id: newId(),
    kind,
    x: 160,
    y: 180,
    width: kind === "text" ? 520 : 260,
    height: kind === "text" ? 180 : kind === "line" ? 1 : 180,
    opacity: 1,
    flip_x: false,
    flip_y: false,
    vector_color: null,
    image_border: false,
    rotation: 0,
    locked: false,
    fill: slideTheme.blue,
    fill_opacity: 1,
    stroke_dash: "solid",
    start_arrow: "none",
    end_arrow: "none",
    corner_radius: kind === "roundRect" ? 12 : null,
    stroke: slideTheme.blue,
    stroke_width: kind === "line" ? 3 : 0,
    paragraphs:
      kind === "text"
        ? [
            {
              align: "left",
              line_height: 1.3,
              bullet: false,
              runs: [defaultRun()],
            },
          ]
        : [],
    asset_id: null,
    crop: { left: 0, right: 0, top: 0, bottom: 0 },
    ...patch,
  };
}
function text(
  text: string,
  x: number,
  y: number,
  width: number,
  size: number,
  color: string,
  bold = false,
  height = size > 40 ? 100 : 180,
): SlideElement {
  return newElement("text", {
    x,
    y,
    width,
    height,
    paragraphs: [
      {
        align: "left",
        line_height: 1.3,
        bullet: false,
        runs: [{ ...defaultRun(text), size, color, bold }],
      },
    ],
  });
}
export function newSlide(layout = "blank"): Slide {
  const slide: Slide = {
    id: newId(),
    background: slideTheme.background,
    notes: "",
    groups: [],
    connections: [],
    infographics: [],
    reference: null,
    image_asset_id: null,
    elements: [],
  };
  if (layout === "cover" || layout === "ending") {
    slide.background = slideTheme.navy;
    slide.elements = [
      newElement("rect", {
        x: 88,
        y: 176,
        width: 64,
        height: 6,
        fill: slideTheme.teal,
      }),
      text(
        layout === "cover" ? "让想法，被看见" : "感谢聆听",
        80,
        224,
        1080,
        64,
        slideTheme.white,
        true,
        110,
      ),
      text(
        layout === "cover"
          ? "演示文稿 · 从一个清晰的想法开始"
          : "让我们一起，把想法变成行动",
        84,
        364,
        1000,
        26,
        slideTheme.border,
        false,
        90,
      ),
    ];
  } else if (layout !== "blank") {
    slide.elements = [
      text("在这里写下标题", 72, 56, 1120, 44, slideTheme.navy, true, 80),
      newElement("rect", {
        x: 80,
        y: 158,
        width: 56,
        height: 4,
        fill: slideTheme.blue,
      }),
      text(
        "用简洁的文字表达核心观点。\n补充事实、数据或一个令人印象深刻的故事。",
        72,
        210,
        layout === "columns" ? 520 : 1080,
        26,
        slideTheme.muted,
        false,
        300,
      ),
    ];
    if (layout === "columns")
      slide.elements.push(
        newElement("roundRect", {
          x: 680,
          y: 210,
          width: 520,
          height: 360,
          fill: slideTheme.fill,
          stroke: slideTheme.border,
          stroke_width: 1,
        }),
        text("在此插入图片", 804, 354, 300, 24, slideTheme.muted, false, 70),
      );
  }
  return slide;
}
export const newDeck = (layout = "cover"): Deck => ({
  version: 2,
  width: 1280,
  height: 720,
  slides: [newSlide(layout)],
});
export function copySlide(slide: Slide): Slide {
  return {
    ...structuredClone(slide),
    id: newId(),
    ...cloneFragment(
      slide,
      slide.elements.map((e) => e.id),
      newId,
      0,
    ),
  };
}
