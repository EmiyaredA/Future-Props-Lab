import type { Table, Field, RecordRow, Config, View } from "./api";
export const fieldTypes = [
  { value: "text", label: "文本" },
  { value: "number", label: "数字" },
  { value: "single", label: "单选" },
  { value: "multi", label: "多选" },
  { value: "date", label: "日期" },
  { value: "checkbox", label: "复选框" },
  { value: "url", label: "链接" },
  { value: "attachment", label: "附件" },
  { value: "note", label: "笔记引用" },
];
export const uid = () => crypto.randomUUID();
export const newTable = (position: number): Table => ({
  id: uid(),
  name: `数据表 ${position + 1}`,
  position,
  fields: [
    { id: uid(), name: "名称", type: "text", position: 0, options: [] },
    {
      id: uid(),
      name: "状态",
      type: "single",
      position: 1,
      options: ["待开始", "进行中", "已完成"].map((label) => ({
        id: uid(),
        label,
        color: "#7c89c9",
      })),
    },
    { id: uid(), name: "截止日期", type: "date", position: 2, options: [] },
    { id: uid(), name: "备注", type: "text", position: 3, options: [] },
  ],
  views: [
    {
      id: uid(),
      name: "表格",
      type: "grid",
      position: 0,
      config: { filter_mode: "all" },
    },
  ],
});
export const emptyRow = (
  position: number,
  values: RecordRow["values"] = {},
): RecordRow => ({ id: uid(), position, values });
export function display(field: Field, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (field.type === "checkbox") return value ? "✓" : "";
  if (field.type === "single" || field.type === "multi") {
    const options = new Map((field.options ?? []).map((o) => [o.id, o.label]));
    return (Array.isArray(value) ? value : [value])
      .map((v) => options.get(String(v)) ?? String(v))
      .join("; ");
  }
  return Array.isArray(value) ? value.join("; ") : String(value);
}
export function parseCell(
  field: Field,
  text: string,
): RecordRow["values"][string] {
  if (!text) return null;
  if (field.type === "text" && text.length > 10000)
    throw new Error(`${field.name}：不能超过 10,000 字`);
  if (
    field.type === "date" &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(text) ||
      new Date(text).toISOString().slice(0, 10) !== text)
  )
    throw new Error(`${field.name}：请输入有效日期 YYYY-MM-DD`);
  if (
    field.type === "url" &&
    (!/^(https?:|mailto:)/i.test(text) ||
      [...text].some((c) => c.charCodeAt(0) < 32))
  )
    throw new Error(`${field.name}：请输入 http、https 或 mailto 链接`);
  if (field.type === "url") {
    try {
      const url = new URL(text);
      if (
        url.protocol !== "mailto:" &&
        (!/^https?:\/\//i.test(text) || !url.hostname)
      )
        throw new Error();
    } catch {
      throw new Error(`${field.name}：链接格式无效`);
    }
  }
  if (field.type === "number") {
    if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(text.trim()))
      throw new Error(`${field.name}：请输入数字`);
    const n = Number(text);
    if (!Number.isFinite(n)) throw new Error(`${field.name}：请输入数字`);
    return n;
  }
  if (field.type === "checkbox") {
    if (!["true", "false", "1", "0", "✓"].includes(text.toLowerCase()))
      throw new Error(`${field.name}：请输入 true 或 false`);
    return ["true", "1", "✓"].includes(text.toLowerCase());
  }
  if (["multi", "attachment", "note"].includes(field.type)) {
    const parts = text
      .split(";")
      .map((v) => v.trim())
      .filter(Boolean);
    if (field.type === "multi")
      return parts.map((v) => {
        const option = field.options?.find((o) => o.label === v || o.id === v);
        if (!option) throw new Error(`${field.name}：没有选项「${v}」`);
        return option.id;
      });
    if (parts.length > 100 || parts.some((v) => v.length > 36))
      throw new Error(`${field.name}：引用 ID 或数量无效`);
    return [...new Set(parts)];
  }
  if (field.type === "single") {
    const option = field.options?.find(
      (o) => o.label === text || o.id === text,
    );
    if (!option) throw new Error(`${field.name}：没有选项「${text}」`);
    return option.id;
  }
  return text;
}
export function visibleFields(table: Table, view: View): Field[] {
  const config = view.config ?? { filter_mode: "all" };
  const order = config.column_order ?? [];
  return [...table.fields]
    .sort(
      (a, b) =>
        (order.includes(a.id)
          ? order.indexOf(a.id)
          : order.length + a.position) -
        (order.includes(b.id)
          ? order.indexOf(b.id)
          : order.length + b.position),
    )
    .filter((f) => !(config.hidden_fields ?? []).includes(f.id));
}
export const cleanConfig = (config: Config, ids: Set<string>): Config => ({
  ...config,
  filters: (config.filters ?? []).filter((f) => ids.has(f.field_id)),
  sorts: (config.sorts ?? []).filter((f) => ids.has(f.field_id)),
  column_order: (config.column_order ?? []).filter((id) => ids.has(id)),
  hidden_fields: (config.hidden_fields ?? []).filter((id) => ids.has(id)),
  column_widths: Object.fromEntries(
    Object.entries(config.column_widths ?? {}).filter(([id]) => ids.has(id)),
  ),
  group_field_id:
    config.group_field_id && ids.has(config.group_field_id)
      ? config.group_field_id
      : null,
});

export function readTsv(source: string): string[][] {
  const rows: string[][] = [],
    row: string[] = [];
  let cell = "",
    quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || !cell) quoted = !quoted;
      else cell += c;
    } else if (!quoted && (c === "\t" || c === "\n" || c === "\r")) {
      row.push(cell);
      cell = "";
      if (c !== "\t") {
        rows.push([...row]);
        row.length = 0;
        if (c === "\r" && source[i + 1] === "\n") i++;
      }
    } else cell += c;
  }
  if (quoted) throw new Error("TSV 引号不完整");
  if (cell || row.length || !rows.length) {
    row.push(cell);
    rows.push(row);
  }
  if (rows.length > 5000) throw new Error("粘贴不能超过 5,000 行");
  return rows;
}
export const writeTsv = (rows: string[][]) =>
  rows
    .map((row) =>
      row
        .map((cell) =>
          /[\t\r\n"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell,
        )
        .join("\t"),
    )
    .join("\n");
