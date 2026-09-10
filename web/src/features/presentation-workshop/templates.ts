import type { Deck, Slide, SlideElement, TextRun } from "./types";

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
  color: "#24344B",
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
    rotation: 0,
    locked: false,
    fill: "#6476DC",
    stroke: "#4556BA",
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
): SlideElement {
  return newElement("text", {
    x,
    y,
    width,
    height: size > 40 ? 110 : 220,
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
    background: "#FFFFFF",
    notes: "",
    elements: [],
  };
  if (layout === "cover" || layout === "ending") {
    slide.background = "#132338";
    slide.elements = [
      newElement("rect", {
        x: 80,
        y: 168,
        width: 62,
        height: 7,
        fill: "#D5AE75",
      }),
      text(
        layout === "cover" ? "让想法，被看见" : "感谢聆听",
        72,
        220,
        1080,
        64,
        "#FFFFFF",
        true,
      ),
      text(
        layout === "cover"
          ? "演示文稿 · 从一个清晰的想法开始"
          : "让我们一起，把想法变成行动",
        76,
        360,
        950,
        26,
        "#B5C1D1",
      ),
    ];
  } else if (layout !== "blank") {
    slide.elements = [
      text("在这里写下标题", 72, 62, 1080, 46, "#24344B", true),
      newElement("rect", {
        x: 80,
        y: 168,
        width: 72,
        height: 5,
        fill: "#6476DC",
      }),
      text(
        "用简洁的文字表达核心观点。\n补充事实、数据或一个令人印象深刻的故事。",
        72,
        214,
        layout === "columns" ? 530 : 1080,
        30,
        "#52627A",
      ),
    ];
    if (layout === "columns")
      slide.elements.push(
        newElement("roundRect", {
          x: 700,
          y: 214,
          width: 480,
          height: 360,
          fill: "#EDF0F8",
        }),
        text("在此插入图片", 784, 340, 340, 28, "#7D8BA0"),
      );
  }
  return slide;
}
export const newDeck = (layout = "cover"): Deck => ({
  version: 1,
  width: 1280,
  height: 720,
  slides: [newSlide(layout)],
});
export function copySlide(slide: Slide): Slide {
  return {
    ...structuredClone(slide),
    id: newId(),
    elements: slide.elements.map((e) => ({
      ...structuredClone(e),
      id: newId(),
    })),
  };
}
