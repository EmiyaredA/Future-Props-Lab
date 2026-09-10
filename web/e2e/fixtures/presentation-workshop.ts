import {
  defaultRun,
  newElement,
} from "../../src/features/presentation-workshop/templates";
import type { Deck } from "../../src/features/presentation-workshop/types";

export function presentationSample(assetId: string): Deck {
  const text = (
    id: string,
    value: string,
    x: number,
    y: number,
    width: number,
    size = 36,
  ) =>
    newElement("text", {
      id,
      x,
      y,
      width,
      height: 120,
      paragraphs: [
        {
          align: "left",
          bullet: false,
          line_height: 1.35,
          runs: [{ ...defaultRun(), text: value, size, color: "#17334A" }],
        },
      ],
    });
  const mixed = text("mixed", "中文混合样式 · ", 72, 60, 1120, 42);
  mixed.paragraphs[0].runs.push({
    ...defaultRun(),
    text: "Native PPTX",
    font: "Arial",
    size: 42,
    color: "#4874DC",
    bold: true,
    italic: true,
    underline: true,
  });
  const body = text(
    "body",
    "这是一段用来检查自动换行的中文长文本。文字、字号与段落格式应该完整保留，导出后仍可逐字修改。中英文混排用于验证不同字体的回退效果。This paragraph checks wrapping and editable text.",
    72,
    210,
    680,
    30,
  );
  body.height = 360;
  body.paragraphs.push({
    align: "left",
    bullet: true,
    line_height: 1.4,
    runs: [
      {
        ...defaultRun(),
        text: "项目符号与演示者备注",
        size: 28,
        color: "#17334A",
      },
    ],
  });
  return {
    version: 1,
    width: 1280,
    height: 720,
    slides: [
      {
        id: "sample-text",
        background: "#F6F8FC",
        notes: "第一页面备注：核验中文、英文、混合样式、换行和项目符号。",
        elements: [
          mixed,
          body,
          newElement("roundRect", {
            id: "rounded",
            x: 900,
            y: 260,
            width: 240,
            height: 240,
            fill: "#D7E4FA",
            stroke_width: 0,
          }),
        ],
      },
      {
        id: "sample-image",
        background: "#FFFFFF",
        notes: "第二页面备注：用户提供的编辑器参考截图，核验矩形裁剪。",
        elements: [
          text("image-title", "图片裁剪与等比缩放", 72, 45, 1100, 42),
          newElement("image", {
            id: "sample-picture",
            asset_id: assetId,
            x: 72,
            y: 190,
            width: 760,
            height: 440,
            crop: { left: 0.18, right: 0.06, top: 0.08, bottom: 0.08 },
          }),
          text("image-label", "矩形裁剪\n图片保持独立对象", 880, 290, 320, 28),
        ],
      },
      {
        id: "sample-shapes",
        background: "#F6F8FC",
        notes: "第三页面备注：核验图层顺序、旋转和原生形状。",
        elements: [
          text("shape-title", "旋转形状与图层", 72, 45, 1100, 42),
          newElement("rect", {
            id: "rear-rect",
            x: 130,
            y: 250,
            width: 300,
            height: 240,
            rotation: 24,
            fill: "#5278D8",
            stroke_width: 0,
          }),
          newElement("ellipse", {
            id: "front-ellipse",
            x: 300,
            y: 330,
            width: 260,
            height: 210,
            fill: "#EDBF68",
            stroke_width: 0,
          }),
          newElement("arrow", {
            id: "native-arrow",
            x: 680,
            y: 300,
            width: 390,
            height: 180,
            fill: "#5DAD96",
            stroke_width: 0,
          }),
          text("layer-label", "前景", 350, 400, 200, 30),
        ],
      },
    ],
  };
}
