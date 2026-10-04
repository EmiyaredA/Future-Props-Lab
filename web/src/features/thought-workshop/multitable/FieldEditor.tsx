import { useState } from "react";
import type { components } from "@generated/api";
import type { Field, Table } from "./api";
import { FieldForm } from "./FieldForm";
import { needsFieldPreview } from "./fieldChanges";
import { Modal } from "./Modal";

export function FieldEditor({
  field,
  table,
  anchor,
  close,
  preview,
  save,
}: {
  field: Field;
  table: Table;
  anchor: HTMLElement;
  close: () => void;
  preview: (
    draft: Table,
    base: Table,
  ) => Promise<components["schemas"]["ConversionOut"]>;
  save: (draft: Table, base: Table) => Promise<void>;
}) {
  const [base] = useState(() => structuredClone(table));
  const [draft, setDraft] = useState(() => structuredClone(field));
  const [result, setResult] = useState<
    components["schemas"]["ConversionOut"] | null
  >(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const next = {
    ...base,
    fields: base.fields.map((f) => (f.id === field.id ? draft : f)),
  };
  const needsPreview = needsFieldPreview(base, next);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (needsPreview && !result?.valid) setResult(await preview(next, base));
      else {
        await save(next, base);
        close();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "字段保存失败，草稿已保留");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="字段配置" variant="field" anchor={anchor} close={close}>
      <div className="multitable-field-editor-body">
        <FieldForm
          field={draft}
          primary={field.position === 0}
          change={(value) => {
            setDraft(value);
            setResult(null);
            setError("");
          }}
        />
        {error && <p role="alert">{error}</p>}
        {result && (
          <div className="multitable-field-example" role="status">
            <p>
              已校验 {result.affected_records} 条记录。
              {result.valid
                ? "变更有效，请确认保存。"
                : "存在无法转换的值，源表未修改。"}
            </p>
            {result.errors.map((e, i) => (
              <p key={i}>
                记录 {String(e.record_id)}：{String(e.message)}
              </p>
            ))}
            {(result.samples ?? []).map((s, i) => (
              <p key={i}>
                {JSON.stringify(s.before)} → {JSON.stringify(s.after)}
              </p>
            ))}
          </div>
        )}
      </div>
      <div className="multitable-actions multitable-field-editor-footer">
        <button className="btn" disabled={busy} onClick={close}>
          取消
        </button>
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy
            ? "处理中…"
            : needsPreview && !result?.valid
              ? "预览字段变更"
              : "保存字段"}
        </button>
      </div>
    </Modal>
  );
}
