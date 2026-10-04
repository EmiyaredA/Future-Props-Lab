import { useEffect, useState } from "react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { CustomDateInput } from "@shared/ui/CustomDateInput";
import type { Config, Field, Table, View } from "./api";
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
          className="btn btn-primary"
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

export function ViewSettings({
  table,
  view,
  save,
  close,
}: {
  table: Table;
  view: View;
  save: (view: View) => Promise<void>;
  close: () => void;
}) {
  const [draft, setDraft] = useState(structuredClone(view)),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const config = draft.config ?? { filter_mode: "all" };
  const setConfig = (patch: Partial<Config>) =>
    setDraft({ ...draft, config: { ...config, ...patch } });
  const options = table.fields.map((f) => ({ value: f.id, label: f.name }));
  const filters = config.filters ?? [],
    sorts = config.sorts ?? [];
  const order = config.column_order?.length
    ? config.column_order
        .map((id) => table.fields.find((f) => f.id === id))
        .filter((f): f is Field => !!f)
    : [...table.fields].sort((a, b) => a.position - b.position);
  const move = (index: number, delta: number) => {
    const fields = [...order];
    [fields[index], fields[index + delta]] = [
      fields[index + delta],
      fields[index],
    ];
    setConfig({ column_order: fields.map((f) => f.id) });
  };
  return (
    <Modal title="视图设置" close={close}>
      <label>
        视图名称
        <input
          aria-label="视图名称"
          value={draft.name}
          maxLength={120}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      <CustomSelect
        ariaLabel="视图类型"
        value={draft.type ?? "grid"}
        options={[
          { value: "grid", label: "表格" },
          { value: "kanban", label: "看板" },
          { value: "calendar", label: "日历" },
        ]}
        onChange={(v) => setDraft({ ...draft, type: v as View["type"] })}
      />
      {draft.type === "kanban" && (
        <CustomSelect
          ariaLabel="看板分栏字段"
          value={config.stack_field_id ?? ""}
          options={[
            { value: "", label: "选择单选字段" },
            ...table.fields
              .filter((f) => f.type === "single")
              .map((f) => ({ value: f.id, label: f.name })),
          ]}
          onChange={(v) => setConfig({ stack_field_id: v || null })}
        />
      )}
      {draft.type === "calendar" && (
        <CustomSelect
          ariaLabel="日历日期字段"
          value={config.date_field_id ?? ""}
          options={[
            { value: "", label: "选择日期字段" },
            ...table.fields
              .filter((f) => f.type === "date")
              .map((f) => ({ value: f.id, label: f.name })),
          ]}
          onChange={(v) => setConfig({ date_field_id: v || null })}
        />
      )}
      <h3>筛选</h3>
      <CustomSelect
        ariaLabel="筛选组合"
        value={config.filter_mode ?? "all"}
        options={[
          { value: "all", label: "全部满足" },
          { value: "any", label: "任一满足" },
        ]}
        onChange={(v) => setConfig({ filter_mode: v as Config["filter_mode"] })}
      />
      {filters.map((f, i) => {
        const field = table.fields.find((x) => x.id === f.field_id)!;
        const operators = [
          { value: "eq", label: "等于" },
          { value: "ne", label: "不等于" },
          { value: "empty", label: "为空" },
          { value: "not_empty", label: "不为空" },
          ...(["text", "url", "single", "multi", "attachment", "note"].includes(
            field.type,
          )
            ? [{ value: "contains", label: "包含" }]
            : []),
          ...(["number", "date"].includes(field.type)
            ? [
                { value: "gt", label: "大于" },
                { value: "gte", label: "大于等于" },
                { value: "lt", label: "小于" },
                { value: "lte", label: "小于等于" },
              ]
            : []),
        ];
        const patch = (v: Partial<typeof f>) =>
          setConfig({
            filters: filters.map((x, j) => (j === i ? { ...x, ...v } : x)),
          });
        return (
          <div key={i} className="multitable-setting-rule">
            <CustomSelect
              ariaLabel={`筛选 ${i + 1} 字段`}
              value={f.field_id}
              options={options}
              onChange={(v) =>
                patch({ field_id: v, operator: "empty", value: null })
              }
            />
            <CustomSelect
              ariaLabel={`筛选 ${i + 1} 条件`}
              value={f.operator}
              options={operators}
              onChange={(v) => patch({ operator: v as typeof f.operator })}
            />
            {!["empty", "not_empty"].includes(f.operator) &&
              (field.type === "single" ? (
                <CustomSelect
                  ariaLabel={`筛选 ${i + 1} 值`}
                  value={String(f.value ?? "")}
                  options={[
                    { value: "", label: "选择值" },
                    ...(field.options ?? []).map((o) => ({
                      value: o.id,
                      label: o.label,
                    })),
                  ]}
                  onChange={(value) => patch({ value: value || null })}
                />
              ) : field.type === "date" ? (
                <CustomDateInput
                  ariaLabel={`筛选 ${i + 1} 值`}
                  value={String(f.value ?? "")}
                  onChange={(value) => patch({ value: value || null })}
                />
              ) : field.type === "checkbox" ? (
                <CustomSelect
                  ariaLabel={`筛选 ${i + 1} 值`}
                  value={
                    f.value === true ? "true" : f.value === false ? "false" : ""
                  }
                  options={[
                    { value: "", label: "未设置" },
                    { value: "true", label: "已勾选" },
                    { value: "false", label: "未勾选" },
                  ]}
                  onChange={(value) =>
                    patch({ value: value ? value === "true" : null })
                  }
                />
              ) : field.type === "multi" ? (
                f.operator === "contains" ? (
                  <CustomSelect
                    ariaLabel={`筛选 ${i + 1} 值`}
                    value={String(f.value ?? "")}
                    options={[
                      { value: "", label: "选择选项" },
                      ...(field.options ?? []).map((o) => ({
                        value: o.id,
                        label: o.label,
                      })),
                    ]}
                    onChange={(value) => patch({ value })}
                  />
                ) : (
                  <fieldset aria-label={`筛选 ${i + 1} 值`}>
                    {(field.options ?? []).map((o) => {
                      const selected = Array.isArray(f.value) ? f.value : [];
                      return (
                        <label key={o.id}>
                          <input
                            type="checkbox"
                            checked={selected.includes(o.id)}
                            onChange={(e) =>
                              patch({
                                value: e.target.checked
                                  ? [...selected, o.id]
                                  : selected.filter((id) => id !== o.id),
                              })
                            }
                          />
                          {o.label}
                        </label>
                      );
                    })}
                  </fieldset>
                )
              ) : (
                <input
                  aria-label={`筛选 ${i + 1} 值`}
                  value={String(f.value ?? "")}
                  onChange={(e) =>
                    patch({
                      value:
                        field.type === "number"
                          ? Number(e.target.value)
                          : field.type === "checkbox"
                            ? e.target.value === "true"
                            : ["multi", "note", "attachment"].includes(
                                  field.type,
                                ) && f.operator !== "contains"
                              ? e.target.value
                                  .split(";")
                                  .map((v) => v.trim())
                                  .filter(Boolean)
                              : e.target.value,
                    })
                  }
                />
              ))}
            <button
              className="btn"
              onClick={() =>
                setConfig({ filters: filters.filter((_, j) => j !== i) })
              }
            >
              移除
            </button>
          </div>
        );
      })}
      <button
        className="btn"
        onClick={() =>
          setConfig({
            filters: [
              ...filters,
              { field_id: table.fields[0].id, operator: "contains", value: "" },
            ],
          })
        }
      >
        增加筛选
      </button>
      <h3>排序与分组</h3>
      {sorts.map((s, i) => (
        <div key={i} className="multitable-setting-rule">
          <CustomSelect
            ariaLabel={`排序 ${i + 1} 字段`}
            value={s.field_id}
            options={options}
            onChange={(v) =>
              setConfig({
                sorts: sorts.map((x, j) =>
                  j === i ? { ...x, field_id: v } : x,
                ),
              })
            }
          />
          <CustomSelect
            ariaLabel={`排序 ${i + 1} 方向`}
            value={s.direction ?? "asc"}
            options={[
              { value: "asc", label: "升序" },
              { value: "desc", label: "降序" },
            ]}
            onChange={(v) =>
              setConfig({
                sorts: sorts.map((x, j) =>
                  j === i ? { ...x, direction: v as "asc" | "desc" } : x,
                ),
              })
            }
          />
          <button
            className="btn"
            onClick={() =>
              setConfig({ sorts: sorts.filter((_, j) => j !== i) })
            }
          >
            移除
          </button>
        </div>
      ))}
      <button
        className="btn"
        onClick={() =>
          setConfig({
            sorts: [
              ...sorts,
              { field_id: table.fields[0].id, direction: "asc" },
            ],
          })
        }
      >
        增加排序
      </button>
      <CustomSelect
        ariaLabel="分组字段"
        value={config.group_field_id ?? ""}
        options={[{ value: "", label: "不分组" }, ...options]}
        onChange={(v) => setConfig({ group_field_id: v || null })}
      />
      <h3>列显示与顺序</h3>
      {order.map((f, i) => (
        <div className="multitable-setting-rule" key={f.id}>
          <label>
            <input
              type="checkbox"
              checked={!(config.hidden_fields ?? []).includes(f.id)}
              onChange={(e) =>
                setConfig({
                  hidden_fields: e.target.checked
                    ? (config.hidden_fields ?? []).filter((id) => id !== f.id)
                    : [...(config.hidden_fields ?? []), f.id],
                })
              }
            />
            {f.name}
          </label>
          <button
            className="btn"
            disabled={i === 0}
            onClick={() => move(i, -1)}
          >
            ↑
          </button>
          <button
            className="btn"
            disabled={i === order.length - 1}
            onClick={() => move(i, 1)}
          >
            ↓
          </button>
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
      <div className="multitable-actions">
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() => {
            if (
              (draft.type === "kanban" && !config.stack_field_id) ||
              (draft.type === "calendar" && !config.date_field_id)
            ) {
              setError("请选择视图所需字段");
              return;
            }
            setBusy(true);
            void save(draft)
              .then(close)
              .catch((e) =>
                setError(e instanceof Error ? e.message : "视图配置无效"),
              )
              .finally(() => setBusy(false));
          }}
        >
          保存视图
        </button>
      </div>
    </Modal>
  );
}
