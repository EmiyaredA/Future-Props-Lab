import type { Field } from "./api";
import { display } from "./model";

export const dateFormats = [
  "YYYY-MM-DD",
  "YYYY/MM/DD",
  "YYYY.MM.DD",
  "YYYY年M月D日",
  "DD/MM/YYYY",
  "MM/DD/YYYY",
] as const;

/** Presentation only: editing, clipboard and CSV continue using canonical values. */
export function formatFieldValue(field: Field, value: unknown): string {
  if (value == null || value === "") return "";
  const config = field.config ?? {};
  if (field.type === "date" && typeof value === "string") {
    const [year, month, day] = value.split("-");
    if (!year || !month || !day) return String(value);
    const format = config.date_format ?? "YYYY-MM-DD";
    if (format === "YYYY年M月D日")
      return `${year}年${Number(month)}月${Number(day)}日`;
    if (format === "DD/MM/YYYY") return `${day}/${month}/${year}`;
    if (format === "MM/DD/YYYY") return `${month}/${day}/${year}`;
    const separator =
      format === "YYYY/MM/DD" ? "/" : format === "YYYY.MM.DD" ? "." : "-";
    return [year, month, day].join(separator);
  }
  if (
    field.type === "number" &&
    typeof value === "number" &&
    (config.decimal_places != null || config.use_grouping)
  ) {
    return new Intl.NumberFormat("en-US", {
      useGrouping: config.use_grouping ?? false,
      ...(config.decimal_places != null
        ? {
            minimumFractionDigits: config.decimal_places,
            maximumFractionDigits: config.decimal_places,
          }
        : { maximumSignificantDigits: 21 }),
    }).format(value);
  }
  return display(field, value);
}
