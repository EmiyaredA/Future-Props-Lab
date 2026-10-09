import type { Field, Table } from "./api";

const signature = (field: Field) =>
  JSON.stringify({
    id: field.id,
    name: field.name,
    type: field.type,
    position: field.position,
    options: field.options ?? [],
    config: Object.fromEntries(
      Object.entries(field.config ?? {})
        .filter(([, v]) => v != null)
        .sort(),
    ),
  });
export function needsFieldPreview(base: Table, draft: Table) {
  return base.fields.some((old) => {
    const next = draft.fields.find((f) => f.id === old.id);
    return (
      !next ||
      next.type !== old.type ||
      Boolean(old.config?.allow_multiple) !==
        Boolean(next.config?.allow_multiple) ||
      (old.options ?? []).some(
        (o) => !(next.options ?? []).some((n) => n.id === o.id),
      )
    );
  });
}
export function validateFieldDraft(table: Table) {
  if (!table.name.trim()) throw new Error("请输入数据表名称");
  for (const field of table.fields) {
    if (!field.name.trim()) throw new Error("请输入字段名称");
    if ((field.options ?? []).some((option) => !option.label.trim()))
      throw new Error(`字段「${field.name}」的选项名称不能为空`);
  }
}
/** Merge only the user's changes; never replace freshly loaded unrelated structure. */
export function mergeFieldChanges(
  base: Table,
  draft: Table,
  latest: Table,
): Table {
  const changed = new Map(
    draft.fields
      .filter((f) => {
        const original = base.fields.find((o) => o.id === f.id);
        return !original || signature(original) !== signature(f);
      })
      .map((f) => [f.id, f]),
  );
  const removed = new Set(
    base.fields
      .filter((f) => !draft.fields.some((n) => n.id === f.id))
      .map((f) => f.id),
  );
  for (const original of base.fields) {
    if (!changed.has(original.id) && !removed.has(original.id)) continue;
    const current = latest.fields.find((f) => f.id === original.id);
    if (!current || signature(current) !== signature(original))
      throw new Error(
        `字段「${original.name}」已被其他操作修改，请保留草稿并重新核对最新配置`,
      );
  }
  if (base.name !== draft.name && latest.name !== base.name)
    throw new Error("数据表名称已被其他操作修改，请重新核对");
  // Deletion changes view references; require the original views to still match.
  if (
    removed.size &&
    JSON.stringify(latest.views) !== JSON.stringify(base.views)
  )
    throw new Error("视图已被其他操作修改，请重新核对字段删除影响");
  const fields = latest.fields
    .filter((f) => !removed.has(f.id))
    .map((f) => changed.get(f.id) ?? f);
  for (const field of changed.values())
    if (!fields.some((f) => f.id === field.id)) fields.push(field);
  const groupsChanged =
    JSON.stringify(base.groups ?? []) !== JSON.stringify(draft.groups ?? []);
  if (
    groupsChanged &&
    JSON.stringify(latest.groups ?? []) !== JSON.stringify(base.groups ?? [])
  )
    throw new Error("字段编组已被其他操作修改，请重新核对");
  const live = new Set(fields.map((field) => field.id));
  const groups = (groupsChanged ? draft.groups : latest.groups) ?? [];
  return {
    ...latest,
    name: base.name === draft.name ? latest.name : draft.name,
    fields: fields.sort((a, b) => a.position - b.position),
    views: removed.size ? draft.views : latest.views,
    groups: groups
      .map((group) => ({
        ...group,
        field_ids: group.field_ids.filter((id) => live.has(id)),
      }))
      .filter((group) => group.field_ids.length > 0),
  };
}
