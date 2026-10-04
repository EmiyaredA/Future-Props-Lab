import { useEffect, useState } from "react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import type { Field, Table } from "./api";
import type { components } from "@generated/api";
import { cleanConfig, fieldTypes, uid } from "./model";
import { Modal } from "./Modal";

export function FieldSettings({
  table,
  save,
  preview,
  close,
}: {
  table: Table;
  save: (table: Table) => Promise<void>;
  preview: (table: Table) => Promise<components["schemas"]["ConversionOut"]>;
  close: () => void;
}) {
  const [draft, setDraft] = useState(structuredClone(table)),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [deleted, setDeleted] = useState(false);
  const [conversion, setConversion] = useState<
    components["schemas"]["ConversionOut"] | null
  >(null);
  useEffect(() => setConversion(null), [draft]);
  const update = (field: Field) =>
    setDraft({
      ...draft,
      fields: draft.fields.map((f) => (f.id === field.id ? field : f)),
    });
  const remove = (field: Field) => {
    const ids = new Set(
      draft.fields.filter((f) => f.id !== field.id).map((f) => f.id),
    );
    if (
      draft.views.some(
        (v) =>
          v.config?.stack_field_id === field.id ||
          v.config?.date_field_id === field.id,
      )
    ) {
      setError("请先更改使用该字段的看板或日历配置");
      return;
    }
    setDraft({
      ...draft,
      fields: draft.fields
        .filter((f) => f.id !== field.id)
        .map((f, i) => ({ ...f, position: i })),
      views: draft.views.map((v) => ({
        ...v,
        config: cleanConfig(v.config ?? { filter_mode: "all" }, ids),
      })),
    });
    setDeleted(true);
  };
  const reorder = (index: number, delta: number) => {
    const fields = [...draft.fields],
      next = index + delta;
    if (index === 0 || next <= 0 || next >= fields.length) return;
    [fields[index], fields[next]] = [fields[next], fields[index]];
    setDraft({
      ...draft,
      fields: fields.map((f, i) => ({ ...f, position: i })),
    });
  };
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
      {draft.fields.map((f, i) => (
        <section className="multitable-field-setting" key={f.id}>
          <div>
            <input
              aria-label={`字段 ${i + 1} 名称`}
              value={f.name}
              maxLength={120}
              onChange={(e) => update({ ...f, name: e.target.value })}
            />
            <CustomSelect
              ariaLabel={`${f.name}类型`}
              options={fieldTypes}
              disabled={i === 0}
              value={f.type}
              onChange={(type) =>
                update({
                  ...f,
                  type: type as Field["type"],
                  options:
                    type === "single" || type === "multi"
                      ? (f.options ?? [])
                      : [],
                })
              }
            />
            <button
              className="btn"
              disabled={i <= 1}
              onClick={() => reorder(i, -1)}
              aria-label={`上移 ${f.name}`}
            >
              ↑
            </button>
            <button
              className="btn"
              disabled={i === 0 || i === draft.fields.length - 1}
              onClick={() => reorder(i, 1)}
              aria-label={`下移 ${f.name}`}
            >
              ↓
            </button>
            <button
              className="btn"
              disabled={i === 0}
              onClick={() => remove(f)}
            >
              删除
            </button>
          </div>
          {["single", "multi"].includes(f.type) && (
            <div className="multitable-options">
              {(f.options ?? []).map((o) => (
                <div key={o.id}>
                  <CustomColorPicker
                    compact
                    ariaLabel={`${f.name} ${o.label}颜色`}
                    value={o.color}
                    onChange={(color) =>
                      update({
                        ...f,
                        options: f.options?.map((x) =>
                          x.id === o.id ? { ...x, color } : x,
                        ),
                      })
                    }
                  />
                  <input
                    aria-label={`${f.name}选项名称`}
                    value={o.label}
                    maxLength={120}
                    onChange={(e) =>
                      update({
                        ...f,
                        options: (f.options ?? []).map((x) =>
                          x.id === o.id ? { ...x, label: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <button
                    className="btn"
                    onClick={() =>
                      update({
                        ...f,
                        options: (f.options ?? []).filter((x) => x.id !== o.id),
                      })
                    }
                  >
                    移除选项
                  </button>
                </div>
              ))}
              <button
                className="btn"
                onClick={() =>
                  update({
                    ...f,
                    options: [
                      ...(f.options ?? []),
                      { id: uid(), label: "新选项", color: "#7c89c9" },
                    ],
                  })
                }
              >
                新增选项
              </button>
            </div>
          )}
        </section>
      ))}
      <button
        className="btn"
        disabled={draft.fields.length >= 50}
        onClick={() =>
          setDraft({
            ...draft,
            fields: [
              ...draft.fields,
              {
                id: uid(),
                name: "新字段",
                type: "text",
                position: draft.fields.length,
                options: [],
              },
            ],
          })
        }
      >
        新增字段（{draft.fields.length}/50）
      </button>
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
              conversion?.valid
                ? save(draft).then(close)
                : preview(draft).then(setConversion)
            )
              .catch((e) =>
                setError(e instanceof Error ? e.message : "保存失败"),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy
            ? "校验中…"
            : conversion?.valid
              ? "确认保存字段"
              : "预览字段变更"}
        </button>
      </div>
    </Modal>
  );
}
