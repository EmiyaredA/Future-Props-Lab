import { describe, expect, it } from "vitest";
import { applyLayout } from "@features/presentation-workshop/layoutObjects";
import { snapTranslation } from "@features/presentation-workshop/layoutSnapping";
import {
  copySlide,
  layouts,
  newElement,
  newSlide,
  defaultRun,
} from "@features/presentation-workshop/templates";
import {
  fromEditor,
  toEditor,
} from "@features/presentation-workshop/textAdapter";

describe("演示文稿编辑规则", () => {
  it("五种版式生成普通元素，复制页面不会复用身份", () => {
    for (const layout of layouts) {
      const slide = newSlide(layout.value),
        copy = copySlide(slide);
      expect(copy.id).not.toBe(slide.id);
      expect(copy.elements.length).toBe(slide.elements.length);
      expect(
        new Set([...slide.elements, ...copy.elements].map((e) => e.id)).size,
      ).toBe(slide.elements.length * 2);
    }
  });
  it("混合字体、换行、项目符号通过富文本编辑往返", () => {
    const paragraphs = [
      {
        align: "center" as const,
        line_height: 1.5,
        bullet: true,
        runs: [
          { ...defaultRun("中文"), bold: true },
          {
            ...defaultRun("Arial"),
            font: "Arial" as const,
            italic: true,
            underline: true,
            size: 42,
            color: "#123456",
          },
        ],
      },
    ];
    expect(fromEditor(toEditor(paragraphs), defaultRun())).toEqual(paragraphs);
    const line = [{ ...paragraphs[0], runs: [defaultRun("第一行\n第二行")] }];
    expect(
      fromEditor(toEditor(line), defaultRun())[0]
        .runs.map((r) => r.text)
        .join(""),
    ).toBe("第一行\n第二行");
  });
  it("按选择边界对齐，含锁定元素时禁用整个命令", () => {
    const a = newElement("rect", { x: 100, width: 60 }),
      b = newElement("rect", { x: 350, width: 100 }),
      locked = newElement("rect", { x: 900, locked: true });
    const slide = { ...newSlide("blank"), elements: [a, b, locked] };
    expect(applyLayout(slide, [a.id, b.id, locked.id], null, "left")).toBe(
      slide,
    );
    expect(
      applyLayout(slide, [a.id, b.id], null, "left").elements.map((e) => e.x),
    ).toEqual([100, 100, 900]);
    expect(applyLayout(slide, [a.id], null, "center").elements[0].x).toBe(610);
  });
  it("等距分布保留两端，吸附阈值随画布缩放换算", () => {
    const elements = [
      newElement("rect", { x: 0, width: 50 }),
      newElement("rect", { x: 100, width: 100 }),
      newElement("rect", { x: 350, width: 50 }),
    ];
    expect(
      applyLayout(
        { ...newSlide("blank"), elements },
        elements.map((e) => e.id),
        null,
        "horizontal",
      ).elements.map((e) => e.x),
    ).toEqual([0, 150, 350]);
    const snapped = snapTranslation(
      { x: 30, y: 90, width: 100, height: 100 },
      -27,
      0,
      [],
      { x: 0, y: 0, width: 1280, height: 720 },
      1,
    );
    expect(snapped.dx).toBe(-30);
    expect(snapped.guides.some((g) => g.x1 === 0 && g.x2 === 0)).toBe(true);
  });
});

it("旋转后的缩放固定左上角，并保持图片比例", async () => {
  const { resizeRotatedElement } =
    await import("@features/presentation-workshop/geometry");
  const shape = newElement("rect", {
    x: 100,
    y: 200,
    width: 120,
    height: 80,
    rotation: 90,
  });
  const resized = resizeRotatedElement(shape, -20, 40, false);
  expect(resized.width).toBeCloseTo(160);
  expect(resized.height).toBeCloseTo(100);
  expect(resized.x).toBeCloseTo(70);
  expect(resized.y).toBeCloseTo(210);
  const image = resizeRotatedElement(
    { ...shape, kind: "image" },
    -20,
    40,
    false,
  );
  expect(image.width / image.height).toBeCloseTo(1.5);
});
