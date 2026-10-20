import type { SlideElement } from "../types";
import { cell } from "./objectDefaults";
export type TableData = NonNullable<SlideElement["table"]>;

export function resizeTable(
  data: TableData,
  rows: number,
  columns: number,
): TableData {
  const result = structuredClone(data);
  result.rows = Array.from(
    { length: Math.max(1, Math.min(100, rows)) },
    (_, r) =>
      Array.from({ length: Math.max(1, Math.min(30, columns)) }, (_, c) => {
        const previous = data.rows[r]?.[c];
        return previous
          ? { ...previous, row_span: 1, col_span: 1, covered: false }
          : cell();
      }),
  );
  result.column_widths = Array.from(
    { length: result.rows[0].length },
    (_, i) => data.column_widths[i] ?? 1,
  );
  return result;
}

export function mergeCells(
  data: TableData,
  start: [number, number],
  end: [number, number],
): TableData {
  const top = Math.min(start[0], end[0]),
    bottom = Math.max(start[0], end[0]);
  const left = Math.min(start[1], end[1]),
    right = Math.max(start[1], end[1]);
  for (let r = top; r <= bottom; r++)
    for (let c = left; c <= right; c++) {
      const item = data.rows[r]?.[c];
      if (!item || item.covered || item.row_span !== 1 || item.col_span !== 1)
        throw new Error("请先拆分选区中的合并单元格");
    }
  const next = structuredClone(data);
  const texts: string[] = [];
  for (let r = top; r <= bottom; r++)
    for (let c = left; c <= right; c++) {
      if (next.rows[r][c].text) texts.push(next.rows[r][c].text);
      next.rows[r][c] = {
        ...next.rows[r][c],
        text: "",
        covered: r !== top || c !== left,
      };
    }
  next.rows[top][left] = {
    ...next.rows[top][left],
    text: texts.join("\n"),
    row_span: bottom - top + 1,
    col_span: right - left + 1,
  };
  return next;
}

export function splitCell(
  data: TableData,
  row: number,
  column: number,
): TableData {
  const next = structuredClone(data),
    source = next.rows[row][column];
  for (let r = row; r < row + source.row_span; r++)
    for (let c = column; c < column + source.col_span; c++)
      next.rows[r][c] = {
        ...next.rows[r][c],
        row_span: 1,
        col_span: 1,
        covered: false,
      };
  return next;
}
