import { useEffect, useMemo, useRef, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { RecordRow, Table, View, Scope } from "./api";
import {
  display,
  emptyRow,
  parseCell,
  visibleFields,
  readTsv,
  writeTsv,
} from "./model";
import { CellEditor } from "./CellEditor";

export function GridView({
  table,
  view,
  rows,
  readOnly,
  change,
  open,
  error,
  scope,
  noteId,
  configure,
  positionKey,
  loadMore,
  hasMore,
}: {
  table: Table;
  view: View;
  rows: RecordRow[];
  readOnly: boolean;
  change: (rows: RecordRow[]) => void;
  open: (row: RecordRow) => void;
  error: (text: string) => void;
  scope: Scope;
  noteId: string;
  configure?: (view: View) => void;
  positionKey: string;
  loadMore: () => void;
  hasMore: boolean;
}) {
  const container = useRef<HTMLDivElement>(null),
    [anchor, setAnchor] = useState<[number, number] | null>(null),
    [end, setEnd] = useState<[number, number] | null>(null);
  const fields = useMemo(() => visibleFields(table, view), [table, view]);
  const groupField = table.fields.find(
    (f) => f.id === view.config?.group_field_id,
  );
  const startsGroup = (index: number) =>
    !!groupField &&
    (index === 0 ||
      JSON.stringify(rows[index].values[groupField.id]) !==
        JSON.stringify(rows[index - 1].values[groupField.id]));
  const restoreOffset = useRef<number | null>(null);
  useEffect(() => {
    try {
      const value = Number(
        localStorage.getItem(`fpl-table-scroll/${positionKey}`),
      );
      restoreOffset.current = Number.isFinite(value)
        ? Math.max(0, Math.min(300000, value))
        : 0;
    } catch {
      restoreOffset.current = 0;
    }
  }, [positionKey]);
  useEffect(() => {
    const element = container.current,
      wanted = restoreOffset.current;
    if (!element || wanted === null || !rows.length) return;
    element.scrollTop = wanted;
    if (wanted > rows.length * 44 - 480 && hasMore) loadMore();
    else restoreOffset.current = null;
  }, [rows.length, positionKey, loadMore, hasMore]);
  const columns = useMemo<ColumnDef<RecordRow>[]>(
    () =>
      fields.map((f) => ({
        id: f.id,
        header: f.name,
        size: view.config?.column_widths?.[f.id] ?? 180,
      })),
    [fields, view.config?.column_widths],
  );
  const grid = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => r.id,
  });
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => container.current,
    estimateSize: (index) => (startsGroup(index) ? 72 : 44),
    overscan: 8,
  });
  const range =
    anchor && end
      ? {
          left: Math.min(anchor[0], end[0]),
          right: Math.max(anchor[0], end[0]),
          top: Math.min(anchor[1], end[1]),
          bottom: Math.max(anchor[1], end[1]),
        }
      : null;
  return (
    <div
      ref={container}
      className="multitable-grid-scroll"
      role="region"
      aria-label="表格记录"
      tabIndex={0}
      onScroll={(e) => {
        const element = e.currentTarget;
        if (restoreOffset.current === null) {
          try {
            localStorage.setItem(
              `fpl-table-scroll/${positionKey}`,
              String(element.scrollTop),
            );
          } catch {
            /* Personal position is optional. */
          }
        }
        if (
          hasMore &&
          element.scrollTop + element.clientHeight >= element.scrollHeight - 400
        )
          loadMore();
      }}
      onCopy={(e) => {
        if (
          !range ||
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement
        )
          return;
        e.preventDefault();
        e.clipboardData.setData(
          "text/plain",
          writeTsv(
            rows
              .slice(range.top, range.bottom + 1)
              .map((r) =>
                fields
                  .slice(range.left, range.right + 1)
                  .map((f) => display(f, r.values[f.id])),
              ),
          ),
        );
      }}
      onPaste={(e) => {
        if (
          readOnly ||
          !anchor ||
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement
        )
          return;
        e.preventDefault();
        try {
          const lines = readTsv(e.clipboardData.getData("text/plain"));
          if (hasMore && anchor[1] + lines.length > rows.length)
            throw new Error("请先加载粘贴范围内的记录，再整体粘贴");
          const updates = lines.map((cells, i) => {
            const index = anchor[1] + i;
            if (anchor[0] + cells.length > fields.length)
              throw new Error("粘贴内容超过可见列数");
            const r =
                rows[index] ?? emptyRow((rows.at(-1)?.position ?? -1) + i + 1),
              values = { ...r.values };
            cells.forEach((v, j) => {
              const f = fields[anchor[0] + j];
              values[f.id] = parseCell(f, v);
            });
            return { ...r, values };
          });
          change(updates);
        } catch (e) {
          error(e instanceof Error ? e.message : "粘贴失败");
        }
      }}
    >
      <div
        role="grid"
        aria-rowcount={rows.length + 1}
        aria-colcount={fields.length + 1}
        style={{
          minWidth: fields.reduce(
            (n, f) => n + (view.config?.column_widths?.[f.id] ?? 180),
            48,
          ),
        }}
      >
        <div role="row" className="multitable-grid-header">
          <div className="multitable-row-number" role="columnheader">
            #
          </div>
          {grid.getHeaderGroups()[0]?.headers.map((h, i) => (
            <div key={h.id} role="columnheader" style={{ width: h.getSize() }}>
              <span>
                {flexRender(h.column.columnDef.header, h.getContext())}
              </span>
              {configure && (
                <input
                  type="range"
                  aria-label={`${fields[i].name}列宽`}
                  min={80}
                  max={800}
                  step={20}
                  value={h.getSize()}
                  onChange={(e) =>
                    configure({
                      ...view,
                      config: {
                        filter_mode: view.config?.filter_mode ?? "all",
                        ...view.config,
                        column_widths: {
                          ...view.config?.column_widths,
                          [h.id]: Number(e.target.value),
                        },
                      },
                    })
                  }
                />
              )}
            </div>
          ))}
        </div>
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {virtual.getVirtualItems().map((item) => {
            const row = grid.getRowModel().rows[item.index];
            return (
              <div
                key={row.id}
                role="row"
                aria-rowindex={item.index + 2}
                className="multitable-grid-row"
                style={{
                  position: "absolute",
                  top: item.start,
                  height: item.size,
                  paddingTop: startsGroup(item.index) ? 28 : 0,
                }}
              >
                {startsGroup(item.index) && groupField && (
                  <div className="multitable-group-heading">
                    {groupField.name}：
                    {display(groupField, row.original.values[groupField.id]) ||
                      "未分配"}
                  </div>
                )}
                <button
                  className="multitable-row-number"
                  aria-label={`打开记录 ${item.index + 1}`}
                  onClick={() => open(row.original)}
                >
                  {item.index + 1}
                </button>
                {row.getVisibleCells().map((c, col) => (
                  <div
                    role="gridcell"
                    key={c.id}
                    tabIndex={0}
                    data-cell={`${col}:${item.index}`}
                    aria-selected={
                      !!range &&
                      col >= range.left &&
                      col <= range.right &&
                      item.index >= range.top &&
                      item.index <= range.bottom
                    }
                    style={{ width: c.column.getSize() }}
                    onMouseDown={(e) => {
                      if (e.shiftKey && anchor) setEnd([col, item.index]);
                      else {
                        setAnchor([col, item.index]);
                        setEnd([col, item.index]);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return;
                      if (
                        e.target !== e.currentTarget ||
                        e.nativeEvent.isComposing
                      )
                        return;
                      const dx =
                          e.key === "ArrowRight"
                            ? 1
                            : e.key === "ArrowLeft"
                              ? -1
                              : 0,
                        dy =
                          e.key === "ArrowDown"
                            ? 1
                            : e.key === "ArrowUp"
                              ? -1
                              : 0;
                      if (dx || dy) {
                        e.preventDefault();
                        const target: [number, number] = [
                          Math.max(0, Math.min(fields.length - 1, col + dx)),
                          Math.max(
                            0,
                            Math.min(rows.length - 1, item.index + dy),
                          ),
                        ];
                        if (e.shiftKey) setEnd(target);
                        else {
                          setAnchor(target);
                          setEnd(target);
                        }
                        virtual.scrollToIndex(target[1]);
                        requestAnimationFrame(() =>
                          container.current
                            ?.querySelector<HTMLElement>(
                              `[data-cell="${target.join(":")}"]`,
                            )
                            ?.focus(),
                        );
                      }
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget
                          .querySelector<HTMLButtonElement>("button")
                          ?.click();
                      }
                    }}
                  >
                    <CellEditor
                      field={fields[col]}
                      value={row.original.values[fields[col].id]}
                      readOnly={readOnly}
                      scope={scope}
                      noteId={noteId}
                      change={(value) =>
                        change([
                          {
                            ...row.original,
                            values: {
                              ...row.original.values,
                              [fields[col].id]: value,
                            },
                          },
                        ])
                      }
                    />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
