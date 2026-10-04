import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CalendarDays,
  Columns3,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Table2,
  Settings2,
  Trash2,
} from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { KnowledgeActionMenu } from "../KnowledgeActionMenu";
import type { Table, View } from "./api";

export function TableWorkspace({
  tables,
  table,
  preference,
  canEdit,
  choose,
  add,
  configure,
  remove,
  children,
  embedded = false,
}: {
  embedded?: boolean;
  tables: Table[];
  table: Table;
  preference: string;
  canEdit: boolean;
  choose: (id: string) => void;
  add: () => void;
  configure: () => void;
  remove: () => void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false),
    [narrow, setNarrow] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(
        localStorage.getItem(`fpl-table-sidebar/${preference}`) === "collapsed",
      );
    } catch {
      setCollapsed(false);
    }
  }, [preference]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setNarrow(entry.contentRect.width < 900),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const toggle = () => {
    setCollapsed(!collapsed);
    try {
      localStorage.setItem(
        `fpl-table-sidebar/${preference}`,
        collapsed ? "expanded" : "collapsed",
      );
    } catch {
      /* Personal layout preferences do not block editing. */
    }
  };
  if (embedded) return <div className="multitable-main">{children}</div>;
  const compact = collapsed || narrow;
  const tableMenu = canEdit ? (
    <KnowledgeActionMenu
      ariaLabel="当前数据表操作"
      groups={[
        [{ value: "fields", label: "字段与数据表名称", icon: Settings2 }],
        [
          {
            value: "delete",
            label: "删除数据表",
            icon: Trash2,
            danger: true,
            disabled: tables.length <= 1,
          },
        ],
      ]}
      onAction={(action) => (action === "fields" ? configure() : remove())}
    />
  ) : null;
  return (
    <div
      ref={root}
      className={`multitable-workspace${compact ? " is-compact" : ""}`}
    >
      {!compact && (
        <nav className="multitable-sidebar" aria-label="数据表">
          <div className="multitable-sidebar-heading">
            <strong>数据表</strong>
            <button
              className="multitable-icon-button"
              aria-label="收起数据表侧栏"
              onClick={toggle}
            >
              <PanelLeftClose size={16} />
            </button>
          </div>
          <div className="multitable-table-list">
            {tables.map((item) => (
              <button
                key={item.id}
                aria-current={item.id === table.id ? "page" : undefined}
                className="multitable-table-link"
                onClick={() => choose(item.id)}
              >
                <Table2 size={16} />
                <span>{item.name}</span>
              </button>
            ))}
          </div>
          {canEdit && (
            <button
              className="multitable-table-link"
              disabled={tables.length >= 30}
              onClick={add}
            >
              <Plus size={16} />
              <span>新建数据表</span>
            </button>
          )}
          <div className="multitable-sidebar-heading">
            <span>当前数据表</span>
            {tableMenu}
          </div>
        </nav>
      )}
      <div className="multitable-main">
        {compact && (
          <div className="multitable-compact-navigation">
            {!narrow && (
              <button
                className="multitable-icon-button"
                aria-label="展开数据表侧栏"
                onClick={toggle}
              >
                <PanelLeftOpen size={16} />
              </button>
            )}
            <CustomSelect
              ariaLabel="当前数据表"
              value={table.id}
              options={tables.map((t) => ({ value: t.id, label: t.name }))}
              onChange={choose}
              leadingIcon={<Table2 size={16} />}
            />
            {canEdit && (
              <button
                className="multitable-icon-button"
                aria-label="新建数据表"
                disabled={tables.length >= 30}
                onClick={add}
              >
                <Plus size={16} />
              </button>
            )}
            {tableMenu}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

const viewIcon = (type: View["type"]) =>
  type === "kanban" ? Columns3 : type === "calendar" ? CalendarDays : Table2;
export function ViewTabs({
  views,
  view,
  choose,
  add,
}: {
  views: View[];
  view: View;
  choose: (id: string) => void;
  add?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div className="multitable-view-navigation">
      <div
        ref={root}
        className="multitable-view-tabs"
        role="tablist"
        aria-label="数据视图"
        onKeyDown={(event) => {
          const tabs = Array.from(
            root.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ??
              [],
          );
          const index = tabs.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          if (
            index < 0 ||
            !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
          )
            return;
          event.preventDefault();
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : (index +
                    (event.key === "ArrowRight" ? 1 : -1) +
                    tabs.length) %
                  tabs.length;
          tabs[next]?.focus();
          tabs[next]?.click();
        }}
      >
        {views.map((item) => {
          const Icon = viewIcon(item.type);
          return (
            <button
              key={item.id}
              role="tab"
              aria-selected={view.id === item.id}
              tabIndex={view.id === item.id ? 0 : -1}
              onClick={() => choose(item.id)}
            >
              <Icon size={16} />
              <span>{item.name}</span>
            </button>
          );
        })}
      </div>
      {add && (
        <button
          className="multitable-icon-button"
          aria-label="新建视图"
          disabled={views.length >= 30}
          onClick={add}
        >
          <Plus size={16} />
        </button>
      )}
    </div>
  );
}
