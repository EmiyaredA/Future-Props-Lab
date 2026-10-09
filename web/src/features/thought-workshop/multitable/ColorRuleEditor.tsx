import { Plus, X } from "lucide-react";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { CustomDateInput } from "@shared/ui/CustomDateInput";
import { CustomSelect } from "@shared/ui/CustomSelect";
import type { Config, Field, Table } from "./api";
import { uid } from "./model";
import { PersonChoices } from "./PersonField";

type Rule = NonNullable<Config["color_rules"]>[number];

function operators(field: Field) {
  return [
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
}

export function ColorRuleEditor({
  table,
  rules,
  onChange,
}: {
  table: Table;
  rules: Rule[];
  onChange: (rules: Rule[]) => void;
}) {
  const fields = table.fields.map((field) => ({
    value: field.id,
    label: field.name,
  }));
  return (
    <>
      {rules.length === 0 ? (
        <p className="multitable-view-note">
          还没有填色条件，记录保持原有底色。
        </p>
      ) : (
        <div className="multitable-rule-list">
          {rules.map((rule, index) => {
            const field = table.fields.find(
              (item) => item.id === rule.field_id,
            )!;
            const patch = (next: Partial<Rule>) =>
              onChange(
                rules.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, ...next } : item,
                ),
              );
            return (
              <div key={rule.id} className="multitable-setting-rule">
                <CustomSelect
                  ariaLabel={`填色 ${index + 1} 字段`}
                  value={rule.field_id}
                  options={fields}
                  onChange={(field_id) =>
                    patch({ field_id, operator: "empty", value: null })
                  }
                />
                <CustomSelect
                  ariaLabel={`填色 ${index + 1} 条件`}
                  value={rule.operator}
                  options={operators(field)}
                  onChange={(operator) =>
                    patch({ operator: operator as Rule["operator"] })
                  }
                />
                {!["empty", "not_empty"].includes(rule.operator) &&
                  (field.type === "single" ||
                  (field.type === "multi" && rule.operator === "contains") ? (
                    <CustomSelect
                      ariaLabel={`填色 ${index + 1} 值`}
                      value={String(rule.value ?? "")}
                      options={[
                        { value: "", label: "选择值" },
                        ...(field.options ?? []).map((option) => ({
                          value: option.id,
                          label: option.label,
                          swatch: option.color,
                        })),
                      ]}
                      onChange={(value) => patch({ value: value || null })}
                    />
                  ) : field.type === "person" ? (
                    <PersonChoices
                      label={`填色 ${index + 1} 值`}
                      multiple={
                        !!field.config?.allow_multiple &&
                        rule.operator !== "contains"
                      }
                      value={rule.value}
                      editable
                      onChange={(value) => patch({ value })}
                    />
                  ) : field.type === "date" ? (
                    <CustomDateInput
                      ariaLabel={`填色 ${index + 1} 值`}
                      value={String(rule.value ?? "")}
                      onChange={(value) => patch({ value: value || null })}
                    />
                  ) : (
                    <input
                      aria-label={`填色 ${index + 1} 值`}
                      value={String(rule.value ?? "")}
                      onChange={(event) =>
                        patch({
                          value:
                            field.type === "number"
                              ? Number(event.target.value)
                              : event.target.value,
                        })
                      }
                    />
                  ))}
                <CustomColorPicker
                  compact
                  ariaLabel={`填色 ${index + 1} 颜色`}
                  value={rule.color}
                  onChange={(color) => patch({ color })}
                />
                <button
                  type="button"
                  className="multitable-icon-button multitable-rule-remove"
                  aria-label={`移除填色 ${index + 1}`}
                  onClick={() =>
                    onChange(
                      rules.filter((_, itemIndex) => itemIndex !== index),
                    )
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
        disabled={rules.length >= 20}
        onClick={() =>
          onChange([
            ...rules,
            {
              id: uid(),
              field_id: table.fields[0].id,
              operator: "contains",
              value: "",
              color: "#E59B3D",
            },
          ])
        }
      >
        <Plus size={15} aria-hidden />
        添加条件
      </button>
    </>
  );
}
