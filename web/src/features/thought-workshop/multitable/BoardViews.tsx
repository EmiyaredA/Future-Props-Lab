import { useState, type CSSProperties } from "react";
import type { RecordRow, Table, View } from "./api";
import { formatFieldValue } from "./formatting";
import { rowFill } from "./colorRules";
import type { People } from "./formatting";

export function KanbanView({
  table,
  view,
  rows,
  readOnly,
  move,
  open,
  people = {},
}: {
  table: Table;
  view: View;
  rows: RecordRow[];
  readOnly: boolean;
  move: (row: RecordRow, field: string, value: string) => void;
  open: (row: RecordRow) => void;
  people?: People;
}) {
  const [drop, setDrop] = useState<string | null>(null);
  const field = table.fields.find((f) => f.id === view.config?.stack_field_id);
  if (!field) return <p>请为看板选择单选字段。</p>;
  const primary = table.fields.find((f) => f.position === 0)!;
  return (
    <div className="multitable-board" aria-label="看板记录">
      {[
        { id: "", label: "未分配", color: "var(--faint)" },
        ...(field.options ?? []),
      ].map((o) => {
        const items = rows.filter((r) => (r.values[field.id] ?? "") === o.id);
        return (
          <section
            key={o.id}
            className={`multitable-lane${drop === o.id ? " is-drop-target" : ""}`}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                setDrop(null);
            }}
            onDragOver={(e) => {
              if (!readOnly) {
                e.preventDefault();
                setDrop(o.id);
              }
            }}
            onDrop={(e) => {
              if (readOnly) return;
              e.preventDefault();
              setDrop(null);
              const r = rows.find(
                (r) =>
                  r.id === e.dataTransfer.getData("application/fpl-record"),
              );
              if (r) move(r, field.id, o.id);
            }}
          >
            <h3>
              <span style={{ background: o.color }} />
              {o.label}
              <small>{items.length}</small>
            </h3>
            {items.map((r) => {
              const fill = rowFill(view, table.fields, r);
              return (
                <button
                  key={r.id}
                  className="multitable-card"
                  draggable={!readOnly}
                  style={
                    fill
                      ? ({
                          "--row-fill": fill,
                          background:
                            "color-mix(in srgb, var(--row-fill) 32%, transparent)",
                        } as CSSProperties)
                      : undefined
                  }
                  onDragStart={(e) =>
                    e.dataTransfer.setData("application/fpl-record", r.id)
                  }
                  onClick={() => open(r)}
                >
                  <strong>
                    {formatFieldValue(primary, r.values[primary.id], people) ||
                      "未命名记录"}
                  </strong>
                  {table.fields
                    .filter((f) => f.id !== primary.id && f.id !== field.id)
                    .slice(0, 3)
                    .map((f) => (
                      <span key={f.id}>
                        {f.name}：
                        {formatFieldValue(f, r.values[f.id], people) || "—"}
                      </span>
                    ))}
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

export function CalendarView({
  table,
  view,
  rows,
  readOnly,
  move,
  open,
  add,
  people = {},
}: {
  table: Table;
  view: View;
  rows: RecordRow[];
  readOnly: boolean;
  move: (row: RecordRow, field: string, value: string) => void;
  open: (row: RecordRow) => void;
  add: (values: RecordRow["values"]) => void;
  people?: People;
}) {
  const [dropDate, setDropDate] = useState<string | null>(null);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const field = table.fields.find((f) => f.id === view.config?.date_field_id),
    primary = table.fields.find((f) => f.position === 0)!;
  if (!field) return <p>请为日历选择日期字段。</p>;
  const [year, m] = month.split("-").map(Number),
    first = new Date(year, m - 1, 1),
    offset = (first.getDay() + 6) % 7;
  const dates = Array.from(
    { length: 42 },
    (_, i) => new Date(year, m - 1, i - offset + 1),
  );
  const dateString = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const shift = (delta: number) => {
    const d = new Date(year, m - 1 + delta, 1);
    setMonth(dateString(d).slice(0, 7));
  };
  return (
    <div className="multitable-calendar">
      <div className="multitable-actions">
        <button className="btn" aria-label="上个月" onClick={() => shift(-1)}>
          ←
        </button>
        <strong>{month}</strong>
        <button className="btn" aria-label="下个月" onClick={() => shift(1)}>
          →
        </button>
      </div>
      <div className="multitable-calendar-grid">
        {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
          <div key={day} className="multitable-weekday">
            {day}
          </div>
        ))}
        {dates.map((d) => {
          const value = dateString(d);
          return (
            <section
              key={value}
              data-date={value}
              aria-label={value}
              className={`multitable-day${d.getMonth() !== m - 1 ? " is-outside" : ""}${value === dateString(new Date()) ? " is-today" : ""}${dropDate === value ? " is-drop-target" : ""}`}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                  setDropDate(null);
              }}
              onDragOver={(e) => {
                if (!readOnly) {
                  e.preventDefault();
                  setDropDate(value);
                }
              }}
              onDrop={(e) => {
                if (readOnly) return;
                e.preventDefault();
                setDropDate(null);
                const r = rows.find(
                  (r) =>
                    r.id === e.dataTransfer.getData("application/fpl-record"),
                );
                if (r) move(r, field.id, value);
              }}
            >
              <div>
                <span>{d.getDate()}</span>
                {!readOnly && (
                  <button
                    className="multitable-day-add"
                    aria-label={`在 ${value} 新增记录`}
                    onClick={() => add({ [field.id]: value })}
                  >
                    +
                  </button>
                )}
              </div>
              {rows
                .filter((r) => r.values[field.id] === value)
                .map((r) => (
                  <button
                    className="multitable-event"
                    key={r.id}
                    draggable={!readOnly}
                    onDragStart={(e) =>
                      e.dataTransfer.setData("application/fpl-record", r.id)
                    }
                    onClick={() => open(r)}
                  >
                    {formatFieldValue(primary, r.values[primary.id], people) ||
                      "未命名记录"}
                  </button>
                ))}
            </section>
          );
        })}
      </div>
      <details className="multitable-undated">
        <summary>
          无日期记录（{rows.filter((r) => !r.values[field.id]).length}）
        </summary>
        {rows
          .filter((r) => !r.values[field.id])
          .map((r) => (
            <button className="btn" key={r.id} onClick={() => open(r)}>
              {formatFieldValue(primary, r.values[primary.id], people) ||
                "未命名记录"}
            </button>
          ))}
      </details>
    </div>
  );
}
