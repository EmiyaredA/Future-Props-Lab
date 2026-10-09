import type { Config, Field, Table, View } from "./api";
import { cleanConfig, uid } from "./model";

const configOf = (view: View): Config => ({
  filter_mode: "all",
  ...view.config,
});

export function hideField(view: View, fieldId: string): View {
  const hidden = configOf(view).hidden_fields ?? [];
  return {
    ...view,
    config: {
      ...configOf(view),
      hidden_fields: hidden.includes(fieldId) ? hidden : [...hidden, fieldId],
    },
  };
}

export function sortFieldFirst(
  view: View,
  fieldId: string,
  direction: "asc" | "desc",
): View {
  const rest = (configOf(view).sorts ?? []).filter(
    (sort) => sort.field_id !== fieldId,
  );
  return {
    ...view,
    config: {
      ...configOf(view),
      sorts: [{ field_id: fieldId, direction }, ...rest],
    },
  };
}

export function groupByField(view: View, fieldId: string): View {
  return {
    ...view,
    config: { ...configOf(view), group_field_id: fieldId },
  };
}

export function insertTextField(
  table: Table,
  anchor: Field,
  side: "before" | "after",
): Table {
  if (table.fields.length >= 50) throw new Error("每表最多 50 个字段");
  if (anchor.position === 0 && side === "before")
    throw new Error("不能在名称列左侧插入字段");
  const created: Field = {
    id: uid(),
    name: "新字段",
    type: "text",
    position: side === "before" ? anchor.position : anchor.position + 1,
    options: [],
  };
  return {
    ...table,
    fields: [
      ...table.fields.map((field) =>
        field.position >= created.position
          ? { ...field, position: field.position + 1 }
          : field,
      ),
      created,
    ],
    views: table.views.map((view) => {
      const order = view.config?.column_order;
      if (!order?.length) return view;
      const ids = [...order];
      const index = ids.indexOf(anchor.id);
      ids.splice(
        index < 0 ? ids.length : side === "before" ? index : index + 1,
        0,
        created.id,
      );
      return {
        ...view,
        config: { ...configOf(view), column_order: ids },
      };
    }),
  };
}

export function deleteFieldDraft(table: Table, field: Field): Table {
  if (field.position === 0) throw new Error("名称字段不能删除");
  if (
    table.views.some(
      (view) =>
        view.config?.stack_field_id === field.id ||
        view.config?.date_field_id === field.id,
    )
  )
    throw new Error("请先更改使用该字段的看板或日历配置");
  const ids = new Set(
    table.fields.filter((item) => item.id !== field.id).map((item) => item.id),
  );
  return {
    ...table,
    fields: table.fields
      .filter((item) => item.id !== field.id)
      .sort((a, b) => a.position - b.position)
      .map((item, index) => ({ ...item, position: index })),
    views: table.views.map((view) => ({
      ...view,
      config: cleanConfig(configOf(view), ids),
    })),
  };
}
