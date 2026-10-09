import { useEffect, useId, useRef, useState } from "react";
import { Eye, EyeOff, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { Field, Table } from "./api";
import { FieldIcon } from "./FieldValue";
import { cleanConfig, uid } from "./model";
import "./field-catalog.css";

function dropField(table: Table, field: Field) {
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
      .map((item, index) => ({ ...item, position: index })),
    groups: (table.groups ?? [])
      .map((group) => ({
        ...group,
        field_ids: group.field_ids.filter((id) => ids.has(id)),
      }))
      .filter((group) => group.field_ids.length > 0),
    views: table.views.map((view) => ({
      ...view,
      config: cleanConfig(view.config ?? { filter_mode: "all" }, ids),
    })),
  };
}

export function FieldCatalog({
  table,
  viewId,
  selectedId,
  onSelect,
  onChange,
  onError,
  onRemoved,
}: {
  table: Table;
  viewId?: string;
  selectedId: string;
  onSelect: (id: string) => void;
  onChange: (table: Table) => void;
  onError: (message: string) => void;
  onRemoved: () => void;
}) {
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("新编组");
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const view = table.views.find((item) => item.id === viewId) ?? table.views[0];
  const hidden = new Set(view?.config?.hidden_fields ?? []);
  const grouped = new Set(
    (table.groups ?? []).flatMap((group) => group.field_ids),
  );
  const visible = table.fields.filter((field) =>
    field.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);
  const toggleHidden = (field: Field) => {
    if (!view) return;
    const next = hidden.has(field.id)
      ? [...hidden].filter((id) => id !== field.id)
      : [...hidden, field.id];
    onChange({
      ...table,
      views: table.views.map((item) =>
        item.id === view.id
          ? {
              ...item,
              config: {
                filter_mode: "all",
                ...item.config,
                hidden_fields: next,
              },
            }
          : item,
      ),
    });
  };
  const createGroup = (field: Field) => {
    const name = groupName.trim();
    if (!name) {
      onError("请输入编组名称");
      return;
    }
    onChange({
      ...table,
      groups: [
        ...(table.groups ?? [])
          .map((group) => ({
            ...group,
            field_ids: group.field_ids.filter((id) => id !== field.id),
          }))
          .filter((group) => group.field_ids.length > 0),
        { id: uid(), name, field_ids: [field.id] },
      ],
    });
    setNaming(null);
    setGroupName("新编组");
  };
  const joinGroup = (field: Field, groupId: string) => {
    onChange({
      ...table,
      groups: (table.groups ?? []).map((group) => ({
        ...group,
        field_ids:
          group.id === groupId
            ? [...group.field_ids.filter((id) => id !== field.id), field.id]
            : group.field_ids.filter((id) => id !== field.id),
      })),
    });
  };
  const renameGroup = (groupId: string, name: string) =>
    onChange({
      ...table,
      groups: (table.groups ?? []).map((group) =>
        group.id === groupId ? { ...group, name } : group,
      ),
    });
  const dissolve = (groupId: string) =>
    onChange({
      ...table,
      groups: (table.groups ?? []).filter((group) => group.id !== groupId),
    });
  const row = (field: Field) => (
    <div
      key={field.id}
      className={`multitable-catalog-row${field.id === selectedId ? " is-selected" : ""}`}
    >
      <button type="button" onClick={() => onSelect(field.id)}>
        <FieldIcon type={field.type} />
        <span>{field.name}</span>
      </button>
      <button
        type="button"
        className="multitable-icon-button"
        aria-label={`${hidden.has(field.id) ? "显示" : "隐藏"} ${field.name}`}
        onClick={() => toggleHidden(field)}
      >
        {hidden.has(field.id) ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
      <button
        type="button"
        className="multitable-icon-button"
        aria-label={`${field.name}字段操作`}
        aria-expanded={menu === field.id}
        aria-controls={menu === field.id ? menuId : undefined}
        onClick={() => setMenu(menu === field.id ? null : field.id)}
      >
        <MoreHorizontal size={14} />
      </button>
      {menu === field.id && (
        <div
          ref={menuRef}
          id={menuId}
          className="multitable-catalog-menu"
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onSelect(field.id);
              setMenu(null);
            }}
          >
            <Pencil size={14} /> 编辑
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setNaming(field.id);
              setMenu(null);
            }}
          >
            创建编组
          </button>
          {!grouped.has(field.id) &&
            (table.groups ?? []).map((group) => (
              <button
                type="button"
                role="menuitem"
                key={group.id}
                onClick={() => {
                  joinGroup(field, group.id);
                  setMenu(null);
                }}
              >
                加入编组 {group.name}
              </button>
            ))}
          <button
            type="button"
            role="menuitem"
            disabled={field.position === 0}
            onClick={() => {
              try {
                onChange(dropField(table, field));
                onRemoved();
                setMenu(null);
              } catch (error) {
                onError(
                  error instanceof Error ? error.message : "无法删除字段",
                );
              }
            }}
          >
            <Trash2 size={14} /> 删除
          </button>
        </div>
      )}
      {naming === field.id && (
        <form
          className="multitable-catalog-name"
          onSubmit={(event) => {
            event.preventDefault();
            createGroup(field);
          }}
        >
          <input
            aria-label="编组名称"
            maxLength={120}
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            autoFocus
          />
          <button type="submit" className="btn primary">
            创建
          </button>
        </form>
      )}
    </div>
  );
  const loose = visible.filter((field) => !grouped.has(field.id));
  return (
    <div className="multitable-catalog">
      <input
        aria-label="搜索字段"
        placeholder="搜索字段"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="multitable-catalog-list">
        {(table.groups ?? []).map((group) => (
          <section key={group.id} aria-label={`编组 ${group.name}`}>
            <div className="multitable-catalog-group">
              <input
                aria-label={`编组 ${group.name} 名称`}
                value={group.name}
                maxLength={120}
                onChange={(event) => renameGroup(group.id, event.target.value)}
              />
              <button
                type="button"
                className="btn"
                onClick={() => dissolve(group.id)}
              >
                解散
              </button>
            </div>
            {group.field_ids
              .map((id) => visible.find((field) => field.id === id))
              .filter((field): field is Field => !!field)
              .map(row)}
          </section>
        ))}
        {loose.map(row)}
      </div>
      <button
        type="button"
        className="btn"
        disabled={table.fields.length >= 50}
        onClick={() => {
          const field: Field = {
            id: uid(),
            name: "新字段",
            type: "text",
            position: table.fields.length,
            options: [],
          };
          onChange({ ...table, fields: [...table.fields, field] });
          onSelect(field.id);
        }}
      >
        新增字段（{table.fields.length}/50）
      </button>
    </div>
  );
}
