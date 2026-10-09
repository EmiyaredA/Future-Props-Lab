import type { Field, Table } from "./api";

export function columnBands(fields: Field[], groups: Table["groups"]) {
  const owner = new Map<string, { id: string; name: string }>();
  for (const group of groups ?? [])
    for (const id of group.field_ids)
      owner.set(id, { id: group.id, name: group.name });
  const bands: { key: string; name: string; fieldIds: string[] }[] = [];
  for (const field of fields) {
    const group = owner.get(field.id);
    const last = bands.at(-1);
    if (group && last?.key === group.id) last.fieldIds.push(field.id);
    else
      bands.push({
        key: group?.id ?? field.id,
        name: group?.name ?? "",
        fieldIds: [field.id],
      });
  }
  return bands;
}
