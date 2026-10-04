import type { Field } from "./api";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { fieldTypes, uid } from "./model";
import { FieldValue } from "./FieldValue";
import { dateFormats, formatFieldValue } from "./formatting";
import "./field-settings.css";

export function FieldForm({
  field,
  primary,
  change,
  nameLabel = "字段名称",
}: {
  field: Field;
  primary: boolean;
  change: (field: Field) => void;
  nameLabel?: string;
}) {
  const options = field.options ?? [];
  const updateOption = (id: string, patch: Partial<(typeof options)[number]>) =>
    change({
      ...field,
      options: options.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    });
  const move = (index: number, delta: number) => {
    const next = [...options];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    change({ ...field, options: next });
  };
  const example =
    field.type === "date"
      ? "2026-10-04"
      : field.type === "number"
        ? 12345.6789
        : null;
  return (
    <div className="multitable-field-form">
      <label>
        字段名称
        <input
          aria-label={nameLabel}
          maxLength={120}
          value={field.name}
          onChange={(e) => change({ ...field, name: e.target.value })}
        />
      </label>
      <label>
        字段类型
        <CustomSelect
          ariaLabel={`${field.name}类型`}
          options={fieldTypes}
          disabled={primary}
          value={field.type}
          onChange={(type) =>
            change({
              ...field,
              type: type as Field["type"],
              config: {},
              options: type === "single" || type === "multi" ? options : [],
            })
          }
        />
      </label>
      {primary && <p>名称字段保持文本类型。</p>}
      {(field.type === "single" || field.type === "multi") && (
        <div className="multitable-field-options">
          <strong>选项与标签颜色</strong>
          {options.map((option, index) => (
            <div className="multitable-field-option" key={option.id}>
              <CustomColorPicker
                compact
                ariaLabel={`${field.name} ${option.label}颜色`}
                value={option.color}
                onChange={(color) => updateOption(option.id, { color })}
              />
              <input
                aria-label={`${field.name}选项名称`}
                maxLength={120}
                value={option.label}
                onChange={(e) =>
                  updateOption(option.id, { label: e.target.value })
                }
              />
              <button
                className="multitable-icon-button"
                aria-label={`上移选项 ${option.label}`}
                disabled={!index}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                className="multitable-icon-button"
                aria-label={`下移选项 ${option.label}`}
                disabled={index === options.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              <button
                className="multitable-icon-button"
                aria-label={`移除选项 ${option.label}`}
                onClick={() =>
                  change({
                    ...field,
                    options: options.filter((o) => o.id !== option.id),
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
          <button
            className="btn"
            disabled={options.length >= 100}
            onClick={() =>
              change({
                ...field,
                options: [
                  ...options,
                  { id: uid(), label: "新选项", color: "#E59B3D" },
                ],
              })
            }
          >
            新增选项
          </button>
          <div className="multitable-field-example" aria-label="标签展示示例">
            <FieldValue
              field={field}
              value={
                field.type === "single"
                  ? options[0]?.id
                  : options.map((o) => o.id)
              }
            />
          </div>
        </div>
      )}
      {field.type === "date" && (
        <label>
          日期显示格式
          <CustomSelect
            ariaLabel="日期显示格式"
            value={field.config?.date_format ?? "YYYY-MM-DD"}
            options={dateFormats.map((format) => ({
              value: format,
              label: `${format} · ${formatFieldValue({ ...field, config: { date_format: format } }, example)}`,
            }))}
            onChange={(date_format) =>
              change({
                ...field,
                config: {
                  date_format: date_format as (typeof dateFormats)[number],
                },
              })
            }
          />
        </label>
      )}
      {field.type === "number" && (
        <>
          <label>
            小数位数
            <CustomSelect
              ariaLabel="小数位数"
              value={String(field.config?.decimal_places ?? "auto")}
              options={[
                { value: "auto", label: "自动（保留原始精度）" },
                ...Array.from({ length: 9 }, (_, i) => ({
                  value: String(i),
                  label: `${i} 位小数`,
                })),
              ]}
              onChange={(value) =>
                change({
                  ...field,
                  config: {
                    ...field.config,
                    decimal_places: value === "auto" ? null : Number(value),
                  },
                })
              }
            />
          </label>
          <label className="multitable-field-check">
            <input
              type="checkbox"
              checked={field.config?.use_grouping ?? false}
              aria-label="千位分隔"
              onChange={(e) =>
                change({
                  ...field,
                  config: { ...field.config, use_grouping: e.target.checked },
                })
              }
            />
            千位分隔
          </label>
        </>
      )}
      {example !== null && (
        <div className="multitable-field-example" role="status">
          展示示例：{formatFieldValue(field, example)}
          <small>仅改变显示，原始值保持不变。</small>
        </div>
      )}
      {!["single", "multi", "date", "number"].includes(field.type) && (
        <p>
          {
            (
              {
                text: "保存文本内容。",
                checkbox: "标记完成或未完成。",
                url: "保存网页或邮件链接。",
                attachment: "引用有权访问的托管素材。",
                note: "引用有权访问的笔记。",
              } as Partial<Record<Field["type"], string>>
            )[field.type]
          }
        </p>
      )}
    </div>
  );
}
