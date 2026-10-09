import type { Field, RecordRow, View } from "./api";

function blank(value: unknown) {
  return (
    value == null || value === "" || (Array.isArray(value) && !value.length)
  );
}

function singleLabel(field: Field, value: unknown) {
  if (typeof value !== "string") return value;
  return field.options?.find((option) => option.id === value)?.label ?? value;
}

/** Mirrors server filter comparison so the first saved rule paints the row. */
export function matchesCondition(
  field: Field,
  operator: string,
  expected: unknown,
  value: unknown,
) {
  if (operator === "empty") return blank(value);
  if (operator === "not_empty") return !blank(value);
  if (operator === "contains") {
    if (Array.isArray(value))
      return value.map(String).includes(String(expected ?? ""));
    const text =
      field.type === "single"
        ? String(singleLabel(field, value) ?? "")
        : String(value ?? "");
    return text.includes(String(expected ?? ""));
  }
  const left = field.type === "single" ? singleLabel(field, value) : value;
  const right =
    field.type === "single" ? singleLabel(field, expected) : expected;
  if (operator === "eq") return left === right;
  if (operator === "ne") return left !== right;
  const ranked = (item: unknown) =>
    typeof item === "number" || typeof item === "string" ? item : null;
  const a = ranked(left),
    b = ranked(right);
  if (a == null || b == null || a === "" || b === "") return false;
  if (operator === "gt") return a > b;
  if (operator === "gte") return a >= b;
  if (operator === "lt") return a < b;
  if (operator === "lte") return a <= b;
  return false;
}

export function rowFill(view: View, fields: Field[], row: RecordRow) {
  for (const rule of view.config?.color_rules ?? []) {
    const field = fields.find((item) => item.id === rule.field_id);
    if (
      field &&
      matchesCondition(field, rule.operator, rule.value, row.values[field.id])
    )
      return rule.color;
  }
  return undefined;
}
