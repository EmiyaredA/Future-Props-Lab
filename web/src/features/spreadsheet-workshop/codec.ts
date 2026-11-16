import type { Sheet, Cell } from "@fortune-sheet/core";
import type { Document } from "./api";

const fields = [
  "config",
  "hide",
  "color",
  "frozen",
  "filter",
  "filter_select",
  "dataVerification",
  "luckysheet_conditionformat_save",
  "luckysheet_alternateformat_save",
  "hyperlink",
  "showGridLines",
  "defaultRowHeight",
  "defaultColWidth",
] as const;

export function snapshot(sheets: Sheet[]): Document {
  const ordered = [...sheets].sort((a, b) => (a.order || 0) - (b.order || 0));
  const visible = ordered.find((sheet) => !sheet.hide)?.id;
  return {
    schema_version: 1,
    sheets: ordered.map((sheet, order) => {
      const sparse: { r: number; c: number; v: Record<string, unknown> }[] = [];
      const add = (r: number, c: number, value: Cell | null) => {
        if (!value || !Object.keys(value).length) return;
        const v: Record<string, unknown> = { ...value };
        delete v.m;
        // FortuneSheet sometimes keeps a numeric input as text while marking it numeric.
        if (
          value.ct?.t === "n" &&
          typeof v.v === "string" &&
          v.v.trim() &&
          Number.isFinite(Number(v.v))
        )
          v.v = Number(v.v);
        sparse.push({ r, c, v });
      };
      if (sheet.data)
        sheet.data.forEach((row, r) =>
          row?.forEach((value, c) => add(r, c, value)),
        );
      else sheet.celldata?.forEach((cell) => add(cell.r, cell.c, cell.v));
      const extras: Record<string, unknown> = {};
      fields.forEach((field) => {
        if (sheet[field] !== undefined) extras[field] = sheet[field];
      });
      return {
        ...extras,
        id: sheet.id!,
        name: sheet.name,
        row: sparse.reduce(
          (size, c) => Math.max(size, c.r + 1),
          sheet.row || 100,
        ),
        column: sparse.reduce(
          (size, c) => Math.max(size, c.c + 1),
          sheet.column || 26,
        ),
        order,
        status: sheet.id === visible ? 1 : 0,
        config: sheet.config || {},
        celldata: sparse,
      };
    }),
  };
}

export function nativeSheets(document: Document): Sheet[] {
  return structuredClone(document.sheets) as unknown as Sheet[];
}

export function stable(document: Document): string {
  return JSON.stringify(document, function (_key, value) {
    if (value && typeof value === "object" && !Array.isArray(value))
      return Object.fromEntries(
        Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
      );
    return value;
  });
}
