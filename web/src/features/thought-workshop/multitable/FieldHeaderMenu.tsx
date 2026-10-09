import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowDownAZ,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpZA,
  ChevronDown,
  EyeOff,
  Filter,
  Group,
  Pencil,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useSelectPopover } from "@shared/ui/useSelectPopover";
import type { Field, View } from "./api";
import { FieldIcon } from "./FieldValue";
import { groupByField, hideField, sortFieldFirst } from "./fieldHeaderActions";
import "./field-menu.css";

type Item = {
  value: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  danger?: boolean;
};

export function FieldHeaderMenu({
  field,
  fieldCount,
  view,
  onEdit,
  onConfigure,
  onInsert,
  onDelete,
  onFilter,
}: {
  field: Field;
  fieldCount: number;
  view: View;
  onEdit: (anchor: HTMLElement) => void;
  onConfigure?: (view: View) => void;
  onInsert?: (field: Field, side: "before" | "after") => void;
  onDelete?: (field: Field) => void;
  onFilter?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  const menuId = useId();
  const label = `字段操作 ${field.name}`;
  const full = fieldCount >= 50;
  const groups: Item[][] = [
    [{ value: "edit", label: "修改字段", icon: Pencil }],
    [
      {
        value: "insert-before",
        label: "向左插入字段",
        icon: ArrowLeftToLine,
        disabled: field.position === 0 || full || !onInsert,
      },
      {
        value: "insert-after",
        label: "向右插入字段",
        icon: ArrowRightToLine,
        disabled: full || !onInsert,
      },
    ],
    [
      {
        value: "hide",
        label: "隐藏字段",
        icon: EyeOff,
        disabled: !onConfigure,
      },
    ],
    [
      {
        value: "sort-asc",
        label: "升序",
        icon: ArrowDownAZ,
        disabled: !onConfigure,
      },
      {
        value: "sort-desc",
        label: "降序",
        icon: ArrowUpZA,
        disabled: !onConfigure,
      },
    ],
    [
      {
        value: "group",
        label: "按此字段分组",
        icon: Group,
        disabled: !onConfigure,
      },
      {
        value: "filter",
        label: "按此字段筛选",
        icon: Filter,
        disabled: !onFilter,
      },
    ],
    [
      {
        value: "delete",
        label: "删除字段",
        icon: Trash2,
        danger: true,
        disabled: field.position === 0 || !onDelete,
      },
    ],
  ];
  useSelectPopover(open, trigger, menu, 420, 220, "start");
  const items = () =>
    Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
  const show = (last = false) => {
    focusLast.current = last;
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    (focusLast.current ? items().at(-1) : items()[0])?.focus();
    const closeOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target))
        setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [open]);
  const choose = (value: string) => {
    trigger.current?.focus();
    setOpen(false);
    if (value === "edit" && trigger.current) onEdit(trigger.current);
    if (value === "insert-before") onInsert?.(field, "before");
    if (value === "insert-after") onInsert?.(field, "after");
    if (value === "hide") onConfigure?.(hideField(view, field.id));
    if (value === "sort-asc")
      onConfigure?.(sortFieldFirst(view, field.id, "asc"));
    if (value === "sort-desc")
      onConfigure?.(sortFieldFirst(view, field.id, "desc"));
    if (value === "group") onConfigure?.(groupByField(view, field.id));
    if (value === "filter") onFilter?.();
    if (value === "delete") onDelete?.(field);
  };
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabled = items();
    if (!enabled.length) return;
    const current = enabled.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    let next: number | undefined;
    if (event.key === "ArrowDown") next = (current + 1) % enabled.length;
    if (event.key === "ArrowUp")
      next = (current - 1 + enabled.length) % enabled.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = enabled.length - 1;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (next === undefined) return;
    event.preventDefault();
    enabled[next]?.focus();
  };
  return (
    <div className="multitable-field-menu-wrap">
      <button
        ref={trigger}
        type="button"
        className={`multitable-field-header${open ? " is-open" : ""}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          show(event.key === "ArrowUp");
        }}
      >
        <FieldIcon type={field.type} />
        <span>{field.name}</span>
        <ChevronDown
          className="multitable-field-chevron"
          size={14}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div
          ref={menu}
          id={menuId}
          popover="manual"
          role="menu"
          aria-label={label}
          className="multitable-field-menu"
          onKeyDown={moveFocus}
        >
          {groups.map((group, groupIndex) => (
            <div key={group[0]!.value} role="presentation">
              {groupIndex > 0 ? (
                <div
                  className="multitable-field-menu-divider"
                  role="separator"
                />
              ) : null}
              {group.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="menuitem"
                  className={item.danger ? "is-danger" : undefined}
                  disabled={item.disabled}
                  onClick={() => choose(item.value)}
                >
                  <item.icon aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
