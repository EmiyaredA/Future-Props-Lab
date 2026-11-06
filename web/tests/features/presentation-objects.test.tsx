import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { newObject } from "@features/presentation-workshop/objects/objectDefaults";
import {
  mergeCells,
  splitCell,
  resizeTable,
} from "@features/presentation-workshop/objects/tableEditing";
import { NativeTable } from "@features/presentation-workshop/objects/NativeTable";
import {
  cosineFormula,
  formulaTemplates,
} from "@features/presentation-workshop/objects/formula/formulaTemplates";
import { formulaSvg } from "@features/presentation-workshop/objects/formulaSvg";

it("merged cells retain content and remain valid after splitting and resizing", () => {
  const data = newObject("table").table!;
  const merged = mergeCells(data, [0, 0], [1, 1]);
  expect(merged.rows[0][0].text).toBe("项目\n数值\n示例\n100");
  expect(merged.rows[0][0]).toMatchObject({ row_span: 2, col_span: 2 });
  expect(merged.rows[1][1].covered).toBe(true);
  expect(() => mergeCells(merged, [0, 0], [0, 1])).toThrow("先拆分");
  const split = splitCell(merged, 0, 0);
  expect(
    split.rows
      .flat()
      .every((c) => !c.covered && c.row_span === 1 && c.col_span === 1),
  ).toBe(true);
  const resized = resizeTable(merged, 3, 3);
  expect(resized.rows).toHaveLength(3);
  expect(resized.rows.every((row) => row.length === 3)).toBe(true);
  expect(resized.rows.flat().every((c) => !c.covered)).toBe(true);
  expect(data.rows[0][0].text).toBe("项目");
});

it("native table render honors merged ranges and cell typography", () => {
  const element = newObject("table");
  element.table = mergeCells(element.table!, [0, 0], [0, 1]);
  render(<NativeTable element={element} />);
  const cells = screen.getAllByRole("cell");
  expect(cells).toHaveLength(3);
  expect(cells[0]).toHaveAttribute("colspan", "2");
  expect(cells[0]).toHaveTextContent("项目 数值");
});

it.each([
  ...formulaTemplates.map((template) => template.sample),
  cosineFormula,
  String.raw`E=mc^2`,
  String.raw`\frac{1}{x^2+1}`,
  String.raw`\sum_{i=1}^{n} i = \frac{n(n+1)}2`,
])("formula export produces self-contained vector paths: %s", async (latex) => {
  const svg = await formulaSvg({ latex, color: "#17334A", size: 36 });
  const xml = new DOMParser().parseFromString(svg, "image/svg+xml");
  expect(xml.querySelector("parsererror")).toBeNull();
  expect(xml.querySelectorAll("path").length).toBeGreaterThan(0);
  expect(svg).not.toContain("currentColor");
  expect(svg).not.toContain("<foreignObject");
  expect(svg).not.toContain("http://cdn");
  expect(xml.documentElement.getAttribute("width")).toMatch(/^[0-9.]+$/);
});
