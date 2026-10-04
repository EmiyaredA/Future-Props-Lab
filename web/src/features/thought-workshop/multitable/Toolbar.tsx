import {
  ArrowDownUp,
  Download,
  Filter,
  Group,
  History,
  ListFilter,
  Plus,
  Search,
  Settings2,
  Trash2,
  Upload,
} from "lucide-react";
import { KnowledgeActionMenu, type TopbarAction } from "../KnowledgeActionMenu";
import type { Table, View } from "./api";

export type ViewSection = "basic" | "filters" | "sorts" | "group" | "columns";
export type TableAction =
  | "history"
  | "import"
  | "export-all"
  | "export-view"
  | "delete-view"
  | "delete-table";
export function TableToolbar({
  table,
  view,
  embedded,
  canEdit,
  workspace,
  canDeleteTable,
  search,
  setSearch,
  add,
  full,
  fields,
  settings,
  action,
}: {
  table: Table;
  view: View;
  embedded: boolean;
  canEdit: boolean;
  workspace: boolean;
  canDeleteTable: boolean;
  search: string;
  setSearch: (value: string) => void;
  add: () => void;
  full: boolean;
  fields: () => void;
  settings: (section: ViewSection) => void;
  action: (action: TableAction) => void;
}) {
  const groups: TopbarAction[][] = [];
  if (workspace && !embedded) {
    groups.push([
      { value: "history", label: "表格历史", icon: History },
      ...(canEdit
        ? [{ value: "import", label: "导入 CSV", icon: Upload }]
        : []),
    ]);
    groups.push([
      { value: "export-all", label: "导出全部记录", icon: Download },
      { value: "export-view", label: "导出当前筛选结果", icon: Download },
    ]);
  }
  if (canEdit && !embedded)
    groups.push([
      {
        value: "delete-view",
        label: "删除视图",
        icon: Trash2,
        danger: true,
        disabled: table.views.length <= 1,
      },
      {
        value: "delete-table",
        label: "删除数据表",
        icon: Trash2,
        danger: true,
        disabled: !canDeleteTable,
      },
    ]);
  const config = view.config;
  return (
    <div className="multitable-toolbar">
      {embedded ? (
        <strong className="multitable-embedded-title">
          {table.name} · {view.name}
        </strong>
      ) : (
        canEdit && (
          <div className="multitable-configuration-tools">
            <button onClick={fields}>
              <ListFilter size={16} />
              字段
            </button>
            <button
              aria-label="筛选"
              className={config?.filters?.length ? "is-active" : undefined}
              onClick={() => settings("filters")}
            >
              <Filter size={16} />
              筛选
              {config?.filters?.length ? (
                <small>{config.filters.length}</small>
              ) : null}
            </button>
            <button
              aria-label="排序"
              className={config?.sorts?.length ? "is-active" : undefined}
              onClick={() => settings("sorts")}
            >
              <ArrowDownUp size={16} />
              排序
              {config?.sorts?.length ? (
                <small>{config.sorts.length}</small>
              ) : null}
            </button>
            <button
              aria-label="分组"
              className={config?.group_field_id ? "is-active" : undefined}
              onClick={() => settings("group")}
            >
              <Group size={16} />
              分组{config?.group_field_id && <small>1</small>}
            </button>
            <button onClick={() => settings("basic")}>
              <Settings2 size={16} />
              视图设置
            </button>
          </div>
        )
      )}
      <div className="multitable-record-tools">
        <label className="multitable-search">
          <Search size={16} />
          <input
            aria-label="搜索记录"
            placeholder="搜索记录…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {canEdit && (
          <button className="btn primary" disabled={full} onClick={add}>
            <Plus size={16} />
            新增记录
          </button>
        )}
        {!!groups.length && (
          <KnowledgeActionMenu
            ariaLabel="多维表格更多操作"
            groups={groups}
            onAction={(value) => action(value as TableAction)}
          />
        )}
      </div>
    </div>
  );
}
