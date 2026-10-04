import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { thoughtKeys } from "../queryKeys";
import {
  csvImport,
  csvPreview,
  historySnapshot,
  restoreTable,
  tableHistory,
  type Table,
} from "./api";
import { newTable, uid, fieldTypes } from "./model";
import { Modal } from "./Modal";
import type { TableController } from "./useTableDocument";

export function CsvDialog({
  recordCount,
  noteId,
  table,
  controller,
  close,
}: {
  recordCount: number;
  noteId: string;
  table: Table;
  controller: TableController;
  close: () => void;
}) {
  const [csv, setCsv] = useState(""),
    [header, setHeader] = useState(true),
    [mode, setMode] = useState("append"),
    [preview, setPreview] = useState<Awaited<
      ReturnType<typeof csvPreview>
    > | null>(null),
    [mapping, setMapping] = useState<(string | null)[]>([]),
    [target, setTarget] = useState(table),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const inspect = async () => {
    setBusy(true);
    setError("");
    try {
      const p = await csvPreview(noteId, csv, header);
      const t =
        mode === "new"
          ? {
              ...newTable(controller.structure.data?.tables.length ?? 0),
              fields: (p.headers.length
                ? p.headers
                : (p.rows[0]?.map((_, i) => `字段 ${i + 1}`) ?? ["名称"])
              ).map((name, position) => ({
                id: uid(),
                name: name || `字段 ${position + 1}`,
                type: "text" as const,
                position,
                options: [],
              })),
            }
          : table;
      setTarget(t);
      setPreview(p);
      setMapping(
        (p.headers.length ? p.headers : (p.rows[0] ?? [])).map((name, i) =>
          mode === "new"
            ? (t.fields[i]?.id ?? null)
            : (t.fields.find((f) => f.name === name)?.id ??
              t.fields[i]?.id ??
              null),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "预览失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="导入 CSV" close={close}>
      <p>
        每张表最多 5,000 条记录、50 个字段。导入先校验全部行，失败时不写入。
      </p>
      <label className="btn">
        选择 CSV
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="选择 CSV"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              if (f.size > 8 * 1024 * 1024) {
                setError("文件不能超过 8 MiB");
                return;
              }
              void f.text().then((text) => {
                setCsv(text);
                setPreview(null);
              });
            }
          }}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={header}
          onChange={(e) => {
            setHeader(e.target.checked);
            setPreview(null);
          }}
        />
        第一行为表头
      </label>
      <CustomSelect
        ariaLabel="导入方式"
        value={mode}
        options={[
          { value: "append", label: "追加到当前表" },
          { value: "new", label: "创建新数据表" },
        ]}
        onChange={(v) => {
          setMode(v);
          setPreview(null);
        }}
      />
      <button
        className="btn"
        disabled={!csv || busy}
        onClick={() => void inspect()}
      >
        预览和字段映射
      </button>
      {error && <p role="alert">{error}</p>}
      {preview && (
        <>
          <p>
            共 {preview.total} 条记录，预览前 {preview.rows.length} 条。
          </p>
          {mapping.map((value, i) => (
            <div className="multitable-setting-rule" key={i}>
              <span>{preview.headers[i] || `第 ${i + 1} 列`}</span>
              <span>
                {target.fields.find((f) => f.id === value)?.type ?? "忽略"}
              </span>
              <CustomSelect
                ariaLabel={`第 ${i + 1} 列映射`}
                value={value ?? ""}
                options={[
                  { value: "", label: "忽略" },
                  ...target.fields.map((f) => ({ value: f.id, label: f.name })),
                ]}
                onChange={(v) => {
                  setMapping(mapping.map((x, j) => (j === i ? v || null : x)));
                  setPreview({ ...preview, errors: [] });
                }}
              />
              {mode === "new" && i > 0 && value && (
                <CustomSelect
                  ariaLabel={`第 ${i + 1} 列类型`}
                  value={
                    target.fields.find((f) => f.id === value)?.type ?? "text"
                  }
                  options={fieldTypes.filter(
                    (f) =>
                      !["single", "multi", "attachment", "note"].includes(
                        f.value,
                      ),
                  )}
                  onChange={(type) =>
                    setTarget({
                      ...target,
                      fields: target.fields.map((f) =>
                        f.id === value
                          ? { ...f, type: type as typeof f.type }
                          : f,
                      ),
                    })
                  }
                />
              )}
            </div>
          ))}
          <div className="multitable-csv-preview">
            <table>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <td key={j}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="btn"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void csvPreview(noteId, csv, header, target, mapping)
                .then(setPreview)
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            校验类型与映射
          </button>
          {preview.errors.map((e, i) => (
            <p role="alert" key={i}>
              第 {String(e.row)} 行 / 第 {String(e.column ?? "—")} 列：
              {String(e.message)}
            </p>
          ))}
          <button
            className="btn primary"
            disabled={
              busy ||
              preview.errors.length > 0 ||
              preview.total + (mode === "append" ? recordCount : 0) > 5000
            }
            onClick={() => {
              setBusy(true);
              void (async () => {
                await controller.flush();
                const s = (await controller.structure.refetch()).data!;
                const checked = await csvPreview(
                  noteId,
                  csv,
                  header,
                  target,
                  mapping,
                );
                if (checked.errors.length) {
                  setPreview(checked);
                  throw new Error("请修正预览中的类型或映射错误");
                }
                await csvImport(noteId, target.id, {
                  expected_revision: s.revision,
                  csv,
                  header,
                  mapping,
                  table: mode === "new" ? target : null,
                });
                await controller.resume();
                close();
              })()
                .catch((e) =>
                  setError(e instanceof Error ? e.message : "导入失败"),
                )
                .finally(() => setBusy(false));
            }}
          >
            确认导入
          </button>
        </>
      )}
    </Modal>
  );
}

export function HistoryDialog({
  readOnly,
  noteId,
  controller,
  close,
}: {
  readOnly: boolean;
  noteId: string;
  controller: TableController;
  close: () => void;
}) {
  const [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<number | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  const history = useQuery({
    queryKey: thoughtKeys.multitableHistory(controller.context, noteId, offset),
    queryFn: () => tableHistory(noteId, offset),
    retry: false,
  });
  const detail = useQuery({
    queryKey: thoughtKeys.multitableSnapshot(
      controller.context,
      noteId,
      selected,
    ),
    queryFn: () => historySnapshot(noteId, selected!),
    enabled: selected !== null,
    retry: false,
  });
  return (
    <Modal title="表格历史" close={close}>
      <p>还原会恢复所有表、字段、视图和记录，并产生新的历史版本。</p>
      {history.data?.map((h) => (
        <button
          className="btn multitable-history-row"
          key={h.id}
          onClick={() => {
            setSelected(h.revision);
            setConfirm(false);
          }}
        >
          版本 {h.revision} · {new Date(h.created_at).toLocaleString()}
        </button>
      ))}
      <div className="multitable-actions">
        <button
          className="btn"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 30))}
        >
          上一页
        </button>
        <button
          className="btn"
          disabled={(history.data?.length ?? 0) < 30}
          onClick={() => setOffset(offset + 30)}
        >
          下一页
        </button>
      </div>
      {detail.data && (
        <div className="multitable-history-preview">
          {detail.data.tables.map((t) => (
            <section key={t.id}>
              <h3>{t.name}</h3>
              <p>
                {t.fields.map((f) => f.name).join(" · ")} ·{" "}
                {detail.data.records[t.id]?.length ?? 0} 条记录
              </p>
              <table>
                <tbody>
                  {(detail.data.records[t.id] ?? []).slice(0, 10).map((r) => (
                    <tr key={r.id}>
                      {t.fields.slice(0, 5).map((f) => (
                        <td key={f.id}>{String(r.values[f.id] ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
      {!readOnly && selected !== null && (
        <button
          className="btn"
          disabled={busy}
          onClick={() => {
            if (!confirm) {
              setConfirm(true);
              return;
            }
            setBusy(true);
            void (async () => {
              await controller.flush();
              const s = (await controller.structure.refetch()).data!;
              await restoreTable(noteId, selected, s.revision);
              await controller.resume();
              close();
            })()
              .catch((e) =>
                setError(e instanceof Error ? e.message : "还原失败"),
              )
              .finally(() => setBusy(false));
          }}
        >
          {confirm ? "确认还原此版本" : "还原此版本"}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}
