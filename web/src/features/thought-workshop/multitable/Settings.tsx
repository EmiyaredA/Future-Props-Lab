import { useEffect, useState } from "react";
import type { Field, Table } from "./api";
import type { components } from "@generated/api";
import { Modal } from "./Modal";
import { FieldForm } from "./FieldForm";
import { FieldCatalog } from "./FieldCatalog";
import { needsFieldPreview } from "./fieldChanges";
import "./field-catalog.css";

export function FieldSettings({
  table,
  viewId,
  save,
  preview,
  close,
}: {
  table: Table;
  viewId?: string;
  save: (table: Table, base: Table) => Promise<void>;
  preview: (
    table: Table,
    base: Table,
  ) => Promise<components["schemas"]["ConversionOut"]>;
  close: () => void;
}) {
  const [base] = useState(() => structuredClone(table));
  const [draft, setDraft] = useState(structuredClone(table)),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [deleted, setDeleted] = useState(false);
  const [conversion, setConversion] = useState<
    components["schemas"]["ConversionOut"] | null
  >(null);
  const [selected, setSelected] = useState(draft.fields[0]?.id ?? "");
  useEffect(() => setConversion(null), [draft]);
  useEffect(() => {
    if (!draft.fields.some((field) => field.id === selected))
      setSelected(draft.fields[0]?.id ?? "");
  }, [draft.fields, selected]);
  const update = (field: Field) =>
    setDraft({
      ...draft,
      fields: draft.fields.map((item) => (item.id === field.id ? field : item)),
    });
  const current =
    draft.fields.find((field) => field.id === selected) ?? draft.fields[0];
  return (
    <Modal title="字段设置" close={close}>
      <label>
        数据表名称
        <input
          aria-label="数据表名称"
          maxLength={120}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      <p>类型转换会先校验所有记录。删除字段及其值后，可在表格历史中恢复。</p>
      {error && <p role="alert">{error}</p>}
      <div className="multitable-field-workspace">
        <FieldCatalog
          table={draft}
          viewId={viewId}
          selectedId={current?.id ?? ""}
          onSelect={setSelected}
          onChange={setDraft}
          onError={setError}
          onRemoved={() => setDeleted(true)}
        />
        {current && (
          <FieldForm
            field={current}
            primary={current.position === 0}
            change={update}
          />
        )}
      </div>
      {deleted && (
        <p className="multitable-warning">
          将删除选中的字段及所有记录中的对应值。确认后保存。
        </p>
      )}
      {conversion && (
        <div className="multitable-history-preview" role="status">
          <p>
            已校验 {conversion.affected_records} 条记录。
            {conversion.valid
              ? "转换有效，确认后保存。"
              : "存在无法转换的值，未修改源表。"}
          </p>
          {conversion.errors.map((e, i) => (
            <p key={i}>
              记录 {String(e.record_id)} / 字段 {String(e.field_id)}：
              {String(e.message)}
            </p>
          ))}
          {(conversion.samples ?? []).map((s, i) => (
            <p key={i}>
              {String(s.record_id)}：{JSON.stringify(s.before)} →{" "}
              {JSON.stringify(s.after)}
            </p>
          ))}
        </div>
      )}
      <div className="multitable-actions">
        <button className="btn" onClick={close}>
          取消
        </button>
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void (
              conversion?.valid || !needsFieldPreview(base, draft)
                ? save(draft, base).then(close)
                : preview(draft, base).then(setConversion)
            )
              .catch((e) =>
                setError(e instanceof Error ? e.message : "保存失败"),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy
            ? "校验中…"
            : conversion?.valid || !needsFieldPreview(base, draft)
              ? "确认保存字段"
              : "预览字段变更"}
        </button>
      </div>
    </Modal>
  );
}
