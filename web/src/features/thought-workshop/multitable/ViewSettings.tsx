import { useState, type KeyboardEvent, type ReactNode } from "react";
import {
  ArrowDownUp,
  ChevronDown,
  ChevronUp,
  Columns3,
  Filter,
  Group,
  PaintBucket,
  Plus,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { CustomDateInput } from "@shared/ui/CustomDateInput";
import type { Config, Field, Table, View } from "./api";
import type { ViewSection } from "./Toolbar";
import { ColorRuleEditor } from "./ColorRuleEditor";
import { PersonChoices } from "./PersonField";
import { Modal } from "./Modal";
import "./view-settings.css";

const sections: [ViewSection, string, LucideIcon][] = [
  ["basic", "基本", SlidersHorizontal],
  ["filters", "筛选", Filter],
  ["sorts", "排序", ArrowDownUp],
  ["group", "分组", Group],
  ["colors", "填色", PaintBucket],
  ["columns", "列显示", Columns3],
];

function moveFocus(event: KeyboardEvent<HTMLElement>, role: string) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(`[role="${role}"]`),
  );
  const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
          tabs.length;
  tabs[next]?.focus();
  tabs[next]?.click();
}

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div
      className="multitable-choice"
      role="radiogroup"
      aria-label={label}
      onKeyDown={(event) => moveFocus(event, "radio")}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SectionLead({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="multitable-view-lead">
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
      {children}
    </div>
  );
}

export function ViewSettings({
  table,
  view,
  save,
  close,
  initialSection = "basic",
}: {
  table: Table;
  view: View;
  save: (view: View) => Promise<void>;
  close: () => void;
  initialSection?: ViewSection;
}) {
  const [draft, setDraft] = useState(structuredClone(view)),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [section, setSection] = useState<ViewSection>(initialSection);
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
  order.sort((a, b) => (a.position === 0 ? -1 : b.position === 0 ? 1 : 0));
  const move = (index: number, delta: number) => {
    if (index === 0 || index + delta <= 0 || index + delta >= order.length)
      return;
    const fields = [...order];
    [fields[index], fields[index + delta]] = [
      fields[index + delta],
      fields[index],
    ];
    setConfig({ column_order: fields.map((f) => f.id) });
  };
  return (
    <Modal
      title={section === "colors" ? "设置填色条件" : "视图设置"}
      close={close}
      className="is-view-settings"
    >
      <div
        className="multitable-settings-tabs"
        role="tablist"
        aria-label="视图配置分区"
        onKeyDown={(event) => moveFocus(event, "tab")}
      >
        {sections.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            tabIndex={section === id ? 0 : -1}
            onClick={() => setSection(id)}
          >
            <Icon size={14} aria-hidden />
            {label}
          </button>
        ))}
      </div>
      <div
        hidden={section !== "basic"}
        className="multitable-settings-section"
        role="tabpanel"
        aria-label="基本"
      >
        <SectionLead
          title="基本信息"
          text="名称显示在上方页签。看板和日历还需要指定对应字段。"
        />
        <label>
          视图名称
          <input
            aria-label="视图名称"
            value={draft.name}
            maxLength={120}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <div className="multitable-view-field">
          <span>视图类型</span>
          <Choice
            label="视图类型"
            value={draft.type ?? "grid"}
            options={[
              { value: "grid", label: "表格" },
              { value: "kanban", label: "看板" },
              { value: "calendar", label: "日历" },
            ]}
            onChange={(v) => setDraft({ ...draft, type: v as View["type"] })}
          />
        </div>
        {draft.type === "kanban" && (
          <div className="multitable-view-field">
            <span>看板分栏字段</span>
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
          </div>
        )}
        {draft.type === "calendar" && (
          <div className="multitable-view-field">
            <span>日历日期字段</span>
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
          </div>
        )}
      </div>
      <div
        hidden={section !== "filters"}
        className="multitable-settings-section"
        role="tabpanel"
        aria-label="筛选"
      >
        <SectionLead
          title="筛选条件"
          text="可以要求全部条件成立，或只要其中一条成立。"
        >
          <Choice
            label="筛选组合"
            value={config.filter_mode ?? "all"}
            options={[
              { value: "all", label: "全部满足" },
              { value: "any", label: "任一满足" },
            ]}
            onChange={(v) =>
              setConfig({ filter_mode: v as Config["filter_mode"] })
            }
          />
        </SectionLead>
        {filters.length === 0 ? (
          <p className="multitable-view-note">
            还没有筛选条件，当前显示全部记录。
          </p>
        ) : (
          <div className="multitable-rule-list">
            {filters.map((f, i) => {
              const field = table.fields.find((x) => x.id === f.field_id)!;
              const operators = [
                { value: "eq", label: "等于" },
                { value: "ne", label: "不等于" },
                { value: "empty", label: "为空" },
                { value: "not_empty", label: "不为空" },
                ...([
                  "text",
                  "url",
                  "single",
                  "multi",
                  "attachment",
                  "note",
                  "person",
                ].includes(field.type)
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
                  filters: filters.map((x, j) =>
                    j === i ? { ...x, ...v } : x,
                  ),
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
                    onChange={(v) =>
                      patch({ operator: v as typeof f.operator })
                    }
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
                    ) : field.type === "person" ? (
                      <PersonChoices
                        label={`筛选 ${i + 1} 值`}
                        multiple={
                          !!field.config?.allow_multiple &&
                          f.operator !== "contains"
                        }
                        value={f.value}
                        editable
                        onChange={(value) => patch({ value })}
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
                          f.value === true
                            ? "true"
                            : f.value === false
                              ? "false"
                              : ""
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
                            const selected = Array.isArray(f.value)
                              ? f.value
                              : [];
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
                    type="button"
                    className="multitable-icon-button multitable-rule-remove"
                    aria-label={`移除筛选 ${i + 1}`}
                    onClick={() =>
                      setConfig({ filters: filters.filter((_, j) => j !== i) })
                    }
                  >
                    <X size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <button
          type="button"
          className="multitable-view-add"
          onClick={() =>
            setConfig({
              filters: [
                ...filters,
                {
                  field_id: table.fields[0].id,
                  operator: "contains",
                  value: "",
                },
              ],
            })
          }
        >
          <Plus size={15} aria-hidden />
          增加筛选
        </button>
      </div>
      <div
        hidden={section !== "sorts"}
        className="multitable-settings-section"
        role="tabpanel"
        aria-label="排序"
      >
        <SectionLead
          title="排序规则"
          text="有多条规则时，靠前的规则优先比较。"
        />
        {sorts.length === 0 ? (
          <p className="multitable-view-note">
            还没有排序规则，记录保持原有顺序。
          </p>
        ) : (
          <div className="multitable-rule-list">
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
                  type="button"
                  className="multitable-icon-button multitable-rule-remove"
                  aria-label={`移除排序 ${i + 1}`}
                  onClick={() =>
                    setConfig({ sorts: sorts.filter((_, j) => j !== i) })
                  }
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          className="multitable-view-add"
          onClick={() =>
            setConfig({
              sorts: [
                ...sorts,
                { field_id: table.fields[0].id, direction: "asc" },
              ],
            })
          }
        >
          <Plus size={15} aria-hidden />
          增加排序
        </button>
      </div>
      <div
        hidden={section !== "group"}
        className="multitable-settings-section"
        role="tabpanel"
        aria-label="分组"
      >
        <SectionLead
          title="分组方式"
          text="按字段取值把记录分成若干组。不需要分组时选择「不分组」。"
        />
        <div className="multitable-view-field">
          <span>分组字段</span>
          <CustomSelect
            ariaLabel="分组字段"
            value={config.group_field_id ?? ""}
            options={[{ value: "", label: "不分组" }, ...options]}
            onChange={(v) => setConfig({ group_field_id: v || null })}
          />
        </div>
      </div>
      <div
        hidden={section !== "colors"}
        className="multitable-settings-section"
        role="tabpanel"
        aria-label="填色"
      >
        <SectionLead
          title="设置填色条件"
          text="自上而下，第一条命中的条件给整行上色。表格和看板使用同一套规则。"
        />
        <ColorRuleEditor
          table={table}
          rules={config.color_rules ?? []}
          onChange={(color_rules) => setConfig({ color_rules })}
        />
      </div>
      <div
        hidden={section !== "columns"}
        className="multitable-settings-section"
        role="tabpanel"
        aria-label="列显示"
      >
        <SectionLead
          title="列显示与顺序"
          text="取消勾选即可隐藏列。第一列保持在最前，其余列可用箭头调整顺序。"
        />
        <ul className="multitable-column-list">
          {order.map((f, i) => {
            const visible = !(config.hidden_fields ?? []).includes(f.id);
            return (
              <li
                className={
                  visible
                    ? "multitable-column-row"
                    : "multitable-column-row is-hidden"
                }
                key={f.id}
              >
                <label>
                  <input
                    type="checkbox"
                    checked={visible}
                    onChange={(e) =>
                      setConfig({
                        hidden_fields: e.target.checked
                          ? (config.hidden_fields ?? []).filter(
                              (id) => id !== f.id,
                            )
                          : [...(config.hidden_fields ?? []), f.id],
                      })
                    }
                  />
                  <span>{f.name}</span>
                </label>
                <div className="multitable-column-moves">
                  <button
                    type="button"
                    className="multitable-icon-button"
                    aria-label={`上移 ${f.name}`}
                    disabled={i <= 1}
                    onClick={() => move(i, -1)}
                  >
                    <ChevronUp size={15} />
                  </button>
                  <button
                    type="button"
                    className="multitable-icon-button"
                    aria-label={`下移 ${f.name}`}
                    disabled={i === 0 || i === order.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ChevronDown size={15} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="multitable-actions">
        <button className="btn" onClick={close}>
          取消
        </button>
        <button
          className="btn primary"
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
