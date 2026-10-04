import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import {
  useWorkspacePermission,
  useAccountId,
} from "@platform/auth/WorkspacePermissions";
import { thoughtKeys } from "../queryKeys";
import { download } from "../download";
import type { NavigationGuard } from "../NoteEditorPane";
import type { Note } from "../api";
import {
  conversionPreview,
  csvExport,
  tableRecords,
  type RecordRow,
  type Table,
  type View,
  type Scope,
} from "./api";
import { display, emptyRow, newTable, uid } from "./model";
import { useTableDocument } from "./useTableDocument";
import { GridView } from "./GridView";
import { KanbanView, CalendarView } from "./BoardViews";
import { FieldSettings, ViewSettings } from "./Settings";
import { CellEditor } from "./CellEditor";
import { Modal } from "./Modal";
import { CsvDialog, HistoryDialog } from "./ExchangeDialogs";
import "./multitable.css";

export function TableEditor({
  noteId,
  note,
  readOnly = false,
  scope = {},
  embedded,
  guard,
}: {
  noteId: string;
  note?: Note;
  readOnly?: boolean;
  scope?: Scope;
  embedded?: { tableId: string; viewId: string };
  guard?: NavigationGuard;
}) {
  const controller = useTableDocument(noteId, scope, guard),
    client = useQueryClient();
  const workspaceWrite = useWorkspacePermission("content.write"),
    user = useAccountId();
  const cellScope = {
    ...scope,
    publication: controller.structure.data?.publication_id ?? scope.publication,
  };
  const [tableId, setTableId] = useState(embedded?.tableId ?? ""),
    [viewId, setViewId] = useState(embedded?.viewId ?? ""),
    [search, setSearch] = useState("");
  const [fieldsOpen, setFieldsOpen] = useState(false),
    [conflictOpen, setConflictOpen] = useState(false),
    [viewOpen, setViewOpen] = useState(false),
    [csvOpen, setCsvOpen] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false),
    [detailId, setDetailId] = useState<string | null>(null),
    [remove, setRemove] = useState<"record" | "table" | "view" | null>(null);
  const tables = useMemo(() => {
    let result = [...(controller.structure.data?.tables ?? [])];
    for (const op of controller.pending) {
      if (op.op === "table.put")
        result = [...result.filter((t) => t.id !== op.table.id), op.table];
      if (op.op === "table.delete")
        result = result.filter((t) => t.id !== op.table_id);
    }
    return result.sort((a, b) => a.position - b.position);
  }, [controller.structure.data, controller.pending]);
  const table =
    tables.find((t) => t.id === tableId) ?? (!embedded ? tables[0] : undefined);
  const view =
    table?.views.find((v) => v.id === viewId) ??
    (!embedded ? table?.views[0] : undefined);
  const canEdit =
    !readOnly &&
    (!!scope.publication || workspaceWrite) &&
    (controller.structure.data?.can_edit ?? false) &&
    !controller.disabled;
  const results = useInfiniteQuery({
    queryKey: thoughtKeys.multitableRecords(
      controller.context,
      noteId,
      table?.id,
      view?.id,
      search,
    ),
    queryFn: ({ pageParam, signal }) =>
      tableRecords(
        noteId,
        table!.id,
        { view_id: view!.id, search, offset: pageParam, limit: 100 },
        scope,
        signal,
      ),
    initialPageParam: 0,
    getNextPageParam: (page, pages) =>
      pages.flatMap((p) => p.items).length < page.total
        ? pages.flatMap((p) => p.items).length
        : undefined,
    enabled: !!table && !!view,
    retry: false,
  });
  const rows = useMemo(() => {
    const all = new Map(
      (results.data?.pages.flatMap((p) => p.items) ?? []).map((r) => [r.id, r]),
    );
    for (const op of controller.pending) {
      if (op.op === "records.put" && op.table_id === table?.id)
        for (const r of op.records) all.set(r.id, r);
      if (op.op === "records.delete" && op.table_id === table?.id)
        for (const id of op.ids) all.delete(id);
    }
    return [...all.values()];
  }, [results.data, controller.pending, table?.id]);
  const detail = rows.find((r) => r.id === detailId);
  const change = (records: RecordRow[]) => {
    if (canEdit && table)
      controller.enqueue({ op: "records.put", table_id: table.id, records });
  };
  const add = (values: RecordRow["values"] = {}) => {
    const r = emptyRow(
      Math.max(
        results.data?.pages[0].total ?? 0,
        Math.max(-1, ...rows.map((r) => r.position)) + 1,
      ),
      values,
    );
    change([r]);
    setDetailId(r.id);
  };
  const putTable = (t: Table) => {
    if (canEdit) controller.enqueue({ op: "table.put", table: t });
  };
  const putView = (v: View) => {
    if (table)
      putTable({
        ...table,
        views: table.views.map((x) => (x.id === v.id ? v : x)),
      });
  };
  const move = (r: RecordRow, field: string, value: string) =>
    change([{ ...r, values: { ...r.values, [field]: value || null } }]);
  const preference = `${user}/${controller.context}/${noteId}`;
  useEffect(() => {
    if (embedded) return;
    try {
      const stored = JSON.parse(
        localStorage.getItem(`fpl-table-view/${preference}`) ?? "null",
      );
      if (stored) {
        setTableId(stored.table);
        setViewId(stored.view);
      }
    } catch {
      /* Reading preferences are optional. */
    }
  }, [preference, embedded]);
  const choose = (t: string, v: string) => {
    setTableId(t);
    setViewId(v);
    try {
      localStorage.setItem(
        `fpl-table-view/${preference}`,
        JSON.stringify({ table: t, view: v }),
      );
    } catch {
      /* Reading preferences do not block editing. */
    }
  };
  const run = (work: () => Promise<unknown>) =>
    void work().catch((e) =>
      controller.setError(e instanceof Error ? e.message : "操作失败"),
    );
  if (controller.structure.isPending)
    return <p role="status">正在加载多维表格…</p>;
  if (controller.structure.isError)
    return (
      <div className="multitable-unavailable">
        <p>多维表格不存在或不可访问。</p>
        <button
          className="btn"
          onClick={() => void controller.structure.refetch()}
        >
          重新加载
        </button>
      </div>
    );
  if (!table || !view)
    return (
      <div className="multitable-unavailable">
        <p>引用的数据表或视图已删除。</p>
        <button
          className="btn"
          onClick={() => void controller.structure.refetch()}
        >
          重新加载
        </button>
      </div>
    );
  return (
    <section
      className={`multitable-editor${embedded ? " is-embedded" : ""}`}
      aria-label="多维表格"
    >
      {!embedded && (
        <header className="multitable-heading">
          <div>
            <span>多维表格</span>
            <h1>{note?.title ?? "多维表格"}</h1>
          </div>
          <span role="status">
            {
              {
                saved: "已保存",
                dirty: "待保存",
                saving: "保存中…",
                recovering: "正在恢复草稿…",
                error: "保存失败",
                conflict: "保存冲突",
              }[controller.state]
            }
          </span>
        </header>
      )}
      {controller.error && (
        <div className="multitable-warning" role="alert">
          <p>{controller.error}</p>
          {["error", "conflict"].includes(controller.state) && (
            <>
              <p>
                待保存操作已保留。重新提交会基于最新版本应用这些操作，请先核对源表。
              </p>
              {controller.conflict && (
                <button className="btn" onClick={() => setConflictOpen(true)}>
                  核对服务器版本
                </button>
              )}
              <button className="btn" onClick={() => run(controller.resume)}>
                读取最新版本并重新提交
              </button>
              <button className="btn" onClick={() => run(controller.discard)}>
                丢弃本机修改
              </button>
            </>
          )}
        </div>
      )}
      {controller.recovery.length > 0 && (
        <div className="multitable-warning">
          <p>
            发现 {controller.recovery.length}{" "}
            份未保存草稿。选择恢复后会按原修订号提交，冲突时保留修改。
          </p>
          {controller.recovery.map((d) => (
            <button
              className="btn"
              key={d.key}
              onClick={() => run(() => controller.recover(d))}
            >
              恢复 {new Date(d.time).toLocaleString()}
            </button>
          ))}
          <button className="btn" onClick={() => run(controller.discard)}>
            丢弃草稿
          </button>
        </div>
      )}
      {!embedded && (
        <div className="multitable-tabs" role="tablist" aria-label="数据表">
          {tables.map((t) => (
            <button
              role="tab"
              aria-selected={table.id === t.id}
              key={t.id}
              onClick={() => choose(t.id, t.views[0].id)}
            >
              {t.name}
            </button>
          ))}
          {canEdit && (
            <button
              className="btn"
              disabled={tables.length >= 30}
              onClick={() => {
                const t = newTable(tables.length);
                putTable(t);
                choose(t.id, t.views[0].id);
              }}
            >
              ＋ 数据表
            </button>
          )}
        </div>
      )}
      <div className="multitable-toolbar">
        {embedded ? (
          <strong>
            {table.name} · {view.name}
          </strong>
        ) : (
          <CustomSelect
            ariaLabel="当前视图"
            value={view.id}
            options={table.views.map((v) => ({ value: v.id, label: v.name }))}
            onChange={(v) => choose(table.id, v)}
          />
        )}
        <input
          aria-label="搜索记录"
          placeholder="搜索记录…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {canEdit && (
          <button
            className="btn btn-primary"
            disabled={(results.data?.pages[0].total ?? 0) >= 5000}
            onClick={() => add()}
          >
            ＋ 记录
          </button>
        )}
        {!embedded && canEdit && (
          <>
            <button className="btn" onClick={() => setFieldsOpen(true)}>
              字段
            </button>
            <button className="btn" onClick={() => setViewOpen(true)}>
              视图设置
            </button>
            <button
              className="btn"
              disabled={table.views.length >= 30}
              onClick={() => {
                const v: View = {
                  id: uid(),
                  name: "新视图",
                  type: "grid",
                  position: table.views.length,
                  config: { filter_mode: "all" },
                };
                putTable({ ...table, views: [...table.views, v] });
                setViewId(v.id);
              }}
            >
              ＋ 视图
            </button>
            <button
              className="btn"
              disabled={table.views.length <= 1}
              onClick={() => setRemove("view")}
            >
              删除视图
            </button>
            <button
              className="btn"
              disabled={tables.length <= 1}
              onClick={() => setRemove("table")}
            >
              删除表
            </button>
          </>
        )}
        {!embedded && !scope.publication && (
          <>
            <button className="btn" onClick={() => setHistoryOpen(true)}>
              历史
            </button>
            {canEdit && (
              <button className="btn" onClick={() => setCsvOpen(true)}>
                导入 CSV
              </button>
            )}
            <CustomSelect
              ariaLabel="导出 CSV"
              value=""
              options={[
                { value: "", label: "导出 CSV" },
                { value: "all", label: "全部记录" },
                { value: "view", label: "当前筛选结果" },
              ]}
              onChange={(v) => {
                if (v)
                  run(async () => {
                    await controller.flush();
                    download(
                      await csvExport(noteId, table.id, {
                        view_id: v === "view" ? view.id : null,
                        search: v === "view" ? search : "",
                        limit: 100,
                        offset: 0,
                      }),
                      `${table.name}.csv`,
                    );
                  });
              }}
            />
          </>
        )}
        {canEdit && controller.state !== "saved" && (
          <button className="btn" onClick={() => run(controller.flush)}>
            保存
          </button>
        )}
      </div>
      {view.config?.group_field_id && results.data?.pages[0].groups && (
        <div className="multitable-group-summary">
          {Object.entries(results.data.pages[0].groups).map(([key, count]) => (
            <span key={key}>
              {table.fields
                .find((f) => f.id === view.config?.group_field_id)
                ?.options?.find((o) => o.id === key)?.label ??
                (key || "未分配")}
              ：{count}
            </span>
          ))}
        </div>
      )}
      {results.isError ? (
        <p role="alert">
          记录读取失败。
          <button className="btn" onClick={() => void results.refetch()}>
            重试
          </button>
        </p>
      ) : view.type === "kanban" ? (
        <KanbanView
          table={table}
          view={view}
          rows={rows}
          readOnly={!canEdit}
          move={move}
          open={(r) => setDetailId(r.id)}
        />
      ) : view.type === "calendar" ? (
        <CalendarView
          table={table}
          view={view}
          rows={rows}
          readOnly={!canEdit}
          move={move}
          open={(r) => setDetailId(r.id)}
          add={add}
        />
      ) : (
        <GridView
          positionKey={`${preference}/${table.id}/${view.id}`}
          hasMore={!!results.hasNextPage}
          loadMore={() => {
            if (!results.isFetchingNextPage && results.hasNextPage)
              void results.fetchNextPage();
          }}
          table={table}
          view={view}
          rows={rows}
          readOnly={!canEdit}
          change={change}
          open={(r) => setDetailId(r.id)}
          error={controller.setError}
          scope={cellScope}
          noteId={noteId}
          configure={!embedded && canEdit ? putView : undefined}
        />
      )}
      <footer className="multitable-footer">
        <span>
          已加载 {rows.length} / {results.data?.pages[0].total ?? 0} 条记录 ·
          每表最多 5,000 条
        </span>
        {results.hasNextPage && (
          <button
            className="btn"
            disabled={results.isFetchingNextPage}
            onClick={() => void results.fetchNextPage()}
          >
            {results.isFetchingNextPage ? "加载中…" : "加载更多"}
          </button>
        )}
      </footer>
      {detail && (
        <Modal title="记录详情" close={() => setDetailId(null)}>
          {table.fields.map((f) => (
            <div className="multitable-detail-field" key={f.id}>
              <strong>{f.name}</strong>
              <CellEditor
                field={f}
                value={detail.values[f.id]}
                readOnly={!canEdit}
                scope={cellScope}
                noteId={noteId}
                change={(value) =>
                  change([
                    { ...detail, values: { ...detail.values, [f.id]: value } },
                  ])
                }
              />
            </div>
          ))}
          {canEdit && (
            <button className="btn" onClick={() => setRemove("record")}>
              删除记录
            </button>
          )}
        </Modal>
      )}
      {fieldsOpen && (
        <FieldSettings
          table={table}
          close={() => setFieldsOpen(false)}
          preview={async (t) => {
            await controller.flush();
            return conversionPreview(noteId, t, scope);
          }}
          save={async (t) => {
            putTable(t);
          }}
        />
      )}
      {viewOpen && (
        <ViewSettings
          table={table}
          view={view}
          close={() => setViewOpen(false)}
          save={async (v) => {
            await controller.flush();
            await conversionPreview(
              noteId,
              {
                ...table,
                views: table.views.map((x) => (x.id === v.id ? v : x)),
              },
              scope,
            );
            putView(v);
          }}
        />
      )}
      {csvOpen && (
        <CsvDialog
          recordCount={results.data?.pages[0].total ?? 0}
          noteId={noteId}
          table={table}
          controller={controller}
          close={() => {
            setCsvOpen(false);
            void client.invalidateQueries({
              queryKey: thoughtKeys.multitableRecords(
                controller.context,
                noteId,
              ),
            });
          }}
        />
      )}
      {historyOpen && (
        <HistoryDialog
          readOnly={!canEdit}
          noteId={noteId}
          controller={controller}
          close={() => {
            setHistoryOpen(false);
            void client.invalidateQueries({
              queryKey: thoughtKeys.multitableRecords(
                controller.context,
                noteId,
              ),
            });
          }}
        />
      )}
      {conflictOpen && controller.conflict && (
        <Modal title="服务器表格版本" close={() => setConflictOpen(false)}>
          <p>
            版本 {controller.conflict.structure.revision}
            。下面显示服务器记录；本机待保存操作仍保留，未重新提交。
          </p>
          <div className="multitable-csv-preview">
            {controller.conflict.structure.tables.map((t) => (
              <section key={t.id}>
                <h3>{t.name}</h3>
                <p>
                  {t.fields.length} 个字段 ·{" "}
                  {(controller.conflict!.records[t.id] ?? []).length}{" "}
                  条记录，预览前 20 条。
                </p>
                <table>
                  <thead>
                    <tr>
                      {t.fields.map((f) => (
                        <th key={f.id}>{f.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(controller.conflict!.records[t.id] ?? [])
                      .slice(0, 20)
                      .map((r) => (
                        <tr key={r.id}>
                          {t.fields.map((f) => (
                            <td key={f.id}>
                              {["note", "attachment"].includes(f.type) &&
                              Array.isArray(r.values[f.id])
                                ? `${(r.values[f.id] as string[]).length} 项引用`
                                : display(f, r.values[f.id])}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        </Modal>
      )}
      <ConfirmDialog
        open={!!remove}
        title={
          remove === "record"
            ? "删除记录？"
            : remove === "view"
              ? "删除视图？"
              : "删除数据表？"
        }
        description="删除后可通过表格历史恢复。引用被删除视图的笔记会显示不可用状态。"
        confirmLabel="删除"
        onCancel={() => setRemove(null)}
        onConfirm={() => {
          if (remove === "record" && detail) {
            controller.enqueue({
              op: "records.delete",
              table_id: table.id,
              ids: [detail.id],
            });
            setDetailId(null);
          }
          if (remove === "view") {
            putTable({
              ...table,
              views: table.views.filter((v) => v.id !== view.id),
            });
            setViewId("");
          }
          if (remove === "table") {
            controller.enqueue({ op: "table.delete", table_id: table.id });
            setTableId("");
          }
          setRemove(null);
        }}
      />
    </section>
  );
}
