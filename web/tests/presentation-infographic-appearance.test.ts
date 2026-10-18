import { expect, it, vi } from "vitest";
import { convertSvg } from "@features/presentation-workshop/infographics/svgConversion";

it("转换排除 AntV 画布背景，避免不透明元素遮住原生连接线；标题与图形分区", () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const background = document.createElementNS(svg.namespaceURI, "rect");
  background.setAttribute("data-element-type", "background");
  const card = document.createElementNS(svg.namespaceURI, "rect");
  card.setAttribute(
    "style",
    "fill: #EEF7F9; stroke: none; fill-opacity: 1; opacity: 1",
  );
  svg.append(background, card);
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 1000, 500),
  );
  vi.spyOn(background, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 1000, 500),
  );
  vi.spyOn(card, "getBoundingClientRect").mockReturnValue(
    new DOMRect(200, 200, 200, 100),
  );
  const { fragment } = convertSvg(svg, "sequence-steps-simple", {
    title: "标题保持独立",
  });
  expect(fragment.elements).toHaveLength(2);
  const title = fragment.elements.find((e) => e.kind === "text")!;
  const shape = fragment.elements.find((e) => e.kind === "rect")!;
  expect(title.paragraphs[0].runs[0].size).toBe(44);
  expect(title.paragraphs[0].align).toBe("left");
  expect(shape.y).toBeGreaterThan(title.y + title.height);
  expect(shape.width).toBeLessThan(1000);
});
