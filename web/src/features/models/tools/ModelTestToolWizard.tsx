import { useMemo, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import type { ModelTestTool, ModelTestToolInput } from "@features/models/api";
import "./model-test-tool-form-controls.css";

type ParameterRow = {
  name: string;
  type: "string" | "integer" | "number" | "boolean";
  description: string;
  required: boolean;
};

const EMPTY_SCHEMA = { type: "object", properties: {} };

function rowsFromSchema(
  schema: Record<string, unknown>,
): ParameterRow[] | null {
  const properties = schema.properties;
  if (
    !properties ||
    typeof properties !== "object" ||
    Array.isArray(properties)
  )
    return [];
  const required = new Set(
    Array.isArray(schema.required) ? schema.required : [],
  );
  const rows: ParameterRow[] = [];
  for (const [name, raw] of Object.entries(properties)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    if (
      !["string", "integer", "number", "boolean"].includes(String(value.type))
    )
      return null;
    rows.push({
      name,
      type: value.type as ParameterRow["type"],
      description: String(value.description || ""),
      required: required.has(name),
    });
  }
  return rows;
}

function schemaFromRows(rows: ParameterRow[]) {
  const properties = Object.fromEntries(
    rows
      .filter((row) => row.name.trim())
      .map((row) => [
        row.name.trim(),
        {
          type: row.type,
          ...(row.description ? { description: row.description } : {}),
        },
      ]),
  );
  const required = rows
    .filter((row) => row.required && row.name.trim())
    .map((row) => row.name.trim());
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
  };
}

function initial(tool?: ModelTestTool): ModelTestToolInput {
  return {
    name: tool?.name ?? "",
    description: tool?.description ?? "",
    input_schema: tool?.input_schema ?? EMPTY_SCHEMA,
    mock_kind: tool?.mock_kind ?? "success",
    mock_result: tool?.mock_result ?? {},
    error_code: tool?.error_code || "mock_failure",
    error_message: tool?.error_message || "模拟工具执行失败",
    delay_ms: tool?.delay_ms ?? 0,
    enabled: tool?.enabled ?? true,
  };
}

export function ModelTestToolWizard({
  tool,
  saving,
  onClose,
  onSave,
}: {
  tool?: ModelTestTool;
  saving: boolean;
  onClose: () => void;
  onSave: (input: ModelTestToolInput) => Promise<void>;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState(() => initial(tool));
  const [schemaText, setSchemaText] = useState(() =>
    JSON.stringify(tool?.input_schema ?? EMPTY_SCHEMA, null, 2),
  );
  const [resultText, setResultText] = useState(() =>
    JSON.stringify(tool?.mock_result ?? {}, null, 2),
  );
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState("");
  const rows = useMemo(
    () => rowsFromSchema(form.input_schema as Record<string, unknown>),
    [form.input_schema],
  );

  const setRows = (next: ParameterRow[]) => {
    const schema = schemaFromRows(next);
    setForm((current) => ({ ...current, input_schema: schema }));
    setSchemaText(JSON.stringify(schema, null, 2));
  };
  const validateDefinition = () => {
    if (!/^[A-Za-z0-9_]{1,64}$/.test(form.name.trim())) {
      setError("工具名称只能包含字母、数字和下划线。");
      return false;
    }
    try {
      const parsed = JSON.parse(schemaText) as Record<string, unknown>;
      if (parsed.type !== "object") throw new Error("根类型必须是 object");
      setForm((current) => ({ ...current, input_schema: parsed }));
    } catch (cause) {
      setError(
        `JSON Schema 无效：${cause instanceof Error ? cause.message : String(cause)}`,
      );
      return false;
    }
    setError("");
    return true;
  };
  const save = async () => {
    let result: unknown = form.mock_result;
    if (form.mock_kind === "success") {
      try {
        result = JSON.parse(resultText);
      } catch (cause) {
        setError(
          `固定返回 JSON 无效：${cause instanceof Error ? cause.message : String(cause)}`,
        );
        return;
      }
    }
    setError("");
    await onSave({ ...form, name: form.name.trim(), mock_result: result });
  };

  return (
    <div
      className="test-tool-modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="test-tool-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="test-tool-wizard-title"
        onKeyDown={(event) => event.key === "Escape" && onClose()}
      >
        <header>
          <h2 id="test-tool-wizard-title">
            {tool ? "编辑测试工具" : "新建测试工具"}
          </h2>
          <button
            type="button"
            className="test-tool-icon-button"
            aria-label="关闭"
            onClick={onClose}
          >
            <X aria-hidden />
          </button>
        </header>
        <div className="test-tool-steps" aria-label="创建步骤">
          <span className={step === 1 ? "active" : "done"}>
            {step === 2 ? <Check aria-hidden /> : "1"} 工具定义
          </span>
          <i />
          <span className={step === 2 ? "active" : ""}>2 模拟返回</span>
        </div>
        {step === 1 ? (
          <div className="test-tool-wizard-body">
            <label>
              <span>工具名称</span>
              <input
                aria-label="工具名称"
                autoFocus
                value={form.name}
                placeholder="get_weather"
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
              <small>仅支持字母、数字和下划线</small>
            </label>
            <label>
              <span>工具说明</span>
              <textarea
                aria-label="工具说明"
                rows={3}
                value={form.description}
                placeholder="告诉模型这个工具何时使用"
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
              />
            </label>
            <div className="test-tool-parameter-head">
              <strong>输入参数</strong>
            </div>
            {rows === null ? (
              <p className="test-tool-schema-warning">
                当前 Schema 含嵌套或高级结构，请在高级 JSON Schema 中修改。
              </p>
            ) : (
              <div className="test-tool-parameters">
                {rows.map((row, index) => (
                  <div
                    className="test-tool-parameter"
                    key={`${index}-${row.name}`}
                  >
                    <input
                      aria-label="参数名称"
                      value={row.name}
                      placeholder="参数名称"
                      onChange={(event) =>
                        setRows(
                          rows.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, name: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    <CustomSelect
                      ariaLabel="参数类型"
                      value={row.type}
                      options={[
                        { value: "string", label: "字符串" },
                        { value: "integer", label: "整数" },
                        { value: "number", label: "数字" },
                        { value: "boolean", label: "布尔值" },
                      ]}
                      onChange={(value) =>
                        setRows(
                          rows.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, type: value as ParameterRow["type"] }
                              : item,
                          ),
                        )
                      }
                    />
                    <input
                      aria-label="参数描述"
                      value={row.description}
                      placeholder="参数描述"
                      onChange={(event) =>
                        setRows(
                          rows.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, description: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    <label className="test-tool-required">
                      <input
                        type="checkbox"
                        checked={row.required}
                        onChange={(event) =>
                          setRows(
                            rows.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, required: event.target.checked }
                                : item,
                            ),
                          )
                        }
                      />
                      <span className="test-tool-checkbox" aria-hidden>
                        {row.required ? <Check /> : null}
                      </span>
                      <span>必填</span>
                    </label>
                    <button
                      type="button"
                      className="test-tool-icon-button"
                      aria-label="删除参数"
                      onClick={() =>
                        setRows(
                          rows.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      <Trash2 aria-hidden />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="test-tool-add-parameter"
                  onClick={() =>
                    setRows([
                      ...rows,
                      {
                        name: "",
                        type: "string",
                        description: "",
                        required: false,
                      },
                    ])
                  }
                >
                  <Plus aria-hidden /> 添加参数
                </button>
              </div>
            )}
            <button
              type="button"
              className="test-tool-advanced-toggle"
              aria-expanded={advanced}
              onClick={() => setAdvanced(!advanced)}
            >
              高级 JSON Schema <span>{advanced ? "−" : "+"}</span>
            </button>
            {advanced ? (
              <textarea
                className="test-tool-code"
                aria-label="高级 JSON Schema"
                rows={9}
                value={schemaText}
                onChange={(event) => setSchemaText(event.target.value)}
                onBlur={validateDefinition}
              />
            ) : null}
          </div>
        ) : (
          <div className="test-tool-wizard-body">
            <strong>返回方式</strong>
            <div className="test-tool-outcomes">
              <button
                type="button"
                className={form.mock_kind === "success" ? "active" : ""}
                onClick={() => setForm({ ...form, mock_kind: "success" })}
              >
                <Check aria-hidden />
                <span>
                  <b>固定成功</b>
                  <small>固定返回成功的 JSON 结果</small>
                </span>
              </button>
              <button
                type="button"
                className={
                  form.mock_kind === "failure" ? "active failure" : "failure"
                }
                onClick={() => setForm({ ...form, mock_kind: "failure" })}
              >
                <X aria-hidden />
                <span>
                  <b>模拟失败</b>
                  <small>返回可观察的错误结果</small>
                </span>
              </button>
            </div>
            {form.mock_kind === "success" ? (
              <label>
                <span>固定返回 JSON</span>
                <textarea
                  className="test-tool-code"
                  rows={10}
                  value={resultText}
                  onChange={(event) => setResultText(event.target.value)}
                />
              </label>
            ) : (
              <div className="test-tool-error-fields">
                <label>
                  <span>错误码</span>
                  <input
                    value={form.error_code}
                    onChange={(event) =>
                      setForm({ ...form, error_code: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>错误说明</span>
                  <textarea
                    rows={4}
                    value={form.error_message}
                    onChange={(event) =>
                      setForm({ ...form, error_message: event.target.value })
                    }
                  />
                </label>
              </div>
            )}
            <label>
              <span>
                模拟延迟 <output>{form.delay_ms} ms</output>
              </span>
              <input
                type="range"
                min="0"
                max="10000"
                step="100"
                value={form.delay_ms}
                onChange={(event) =>
                  setForm({ ...form, delay_ms: Number(event.target.value) })
                }
              />
            </label>
            <label className="test-tool-enable">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) =>
                  setForm({ ...form, enabled: event.target.checked })
                }
              />
              <span className="test-tool-checkbox" aria-hidden>
                {form.enabled ? <Check /> : null}
              </span>
              <span>保存后启用</span>
            </label>
          </div>
        )}
        {error ? (
          <p className="test-tool-form-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer>
          <button
            type="button"
            className="test-tool-button"
            onClick={() => (step === 1 ? onClose() : setStep(1))}
          >
            {step === 1 ? "取消" : "上一步"}
          </button>
          <button
            type="button"
            className="test-tool-button primary"
            disabled={saving}
            onClick={() => {
              if (step === 1) {
                if (validateDefinition()) setStep(2);
              } else void save();
            }}
          >
            {step === 1
              ? "下一步：模拟返回"
              : saving
                ? "保存中…"
                : "保存测试工具"}
          </button>
        </footer>
      </section>
    </div>
  );
}
