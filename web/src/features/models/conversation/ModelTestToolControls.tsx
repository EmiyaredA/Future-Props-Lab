import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Search,
  Wrench,
  X,
} from "lucide-react";
import {
  getModelTestTools,
  type ModelTestToolCall,
  type ModelTestToolSummary,
} from "@features/models/api";
import { modelQueryKeys } from "@features/models/queryKeys";
import "./model-test-tool-controls.css";

export type ModelTestToolCallView = Pick<
  ModelTestToolCall,
  | "id"
  | "tool_name"
  | "arguments"
  | "status"
  | "success"
  | "result"
  | "error_code"
  | "error_message"
  | "duration_ms"
>;

export function ModelTestToolCallList({
  calls,
}: {
  calls: ModelTestToolCallView[];
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  if (!calls.length) return null;
  return (
    <div className="model-test-tool-calls" aria-label="工具调用步骤">
      {calls.map((call) => {
        const open = expanded.includes(call.id);
        return (
          <article
            className={`model-test-tool-call ${call.status}`}
            key={call.id}
          >
            <button
              type="button"
              aria-expanded={open}
              onClick={() =>
                setExpanded((current) =>
                  open
                    ? current.filter((id) => id !== call.id)
                    : [...current, call.id],
                )
              }
            >
              <Wrench aria-hidden />
              <span>
                <strong>{call.tool_name}</strong>
                <small>
                  {call.status === "proposed"
                    ? "等待执行"
                    : call.status === "running"
                      ? "正在执行"
                      : call.status === "completed"
                        ? `已完成 · ${call.duration_ms} ms`
                        : call.status === "cancelled"
                          ? "已取消"
                          : `失败 · ${call.duration_ms} ms`}
                </small>
              </span>
              <ChevronDown className={open ? "open" : ""} aria-hidden />
            </button>
            {open ? (
              <div className="model-test-tool-call-detail">
                <span>调用参数</span>
                <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
                {call.success ? (
                  <>
                    <span>模拟结果</span>
                    <pre>{JSON.stringify(call.result, null, 2)}</pre>
                  </>
                ) : call.error_message ? (
                  <p>
                    <CircleAlert aria-hidden />{" "}
                    {call.error_code ? `${call.error_code}：` : ""}
                    {call.error_message}
                  </p>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

export function ModelTestToolWarnings({
  selected,
  supported,
}: {
  selected: ModelTestToolSummary[];
  supported: boolean;
}) {
  return (
    <>
      {selected.length && !supported ? (
        <p className="model-warning">
          当前会话已选择测试工具，请切换到支持 tools 的模型或移除工具。
        </p>
      ) : null}
      {selected.some((tool) => !tool.enabled) ? (
        <p className="model-warning">
          当前会话包含已停用的测试工具，请移除或重新启用后再发送。
        </p>
      ) : null}
    </>
  );
}

export function ModelTestToolSelector({
  selected,
  supported,
  disabled,
  pickerDescription = "本次会话将在下一次发送时使用工具的最新定义。",
  onSave,
}: {
  selected: ModelTestToolSummary[];
  supported: boolean;
  disabled: boolean;
  pickerDescription?: string;
  onSave: (toolIds: string[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const query = useQuery({
    queryKey: modelQueryKeys.tools,
    queryFn: getModelTestTools,
    enabled: supported,
  });
  useEffect(() => setDraft(selected.map((tool) => tool.id)), [selected]);
  const tools = (query.data?.items ?? []).filter(
    (tool) =>
      tool.enabled &&
      `${tool.name} ${tool.description}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  return (
    <div className="model-test-tools-setting">
      <div className="model-test-tools-setting-head">
        <span>
          <Wrench aria-hidden />
          <strong>测试工具</strong>
        </span>
        <small>
          {selected.length ? `已选择 ${selected.length} 个` : "可选"}
        </small>
      </div>
      {!supported ? (
        <p className="model-test-tools-unavailable">
          <CircleAlert aria-hidden /> 当前模型不支持工具调用
        </p>
      ) : (
        <>
          <div className="model-test-selected-tools">
            {selected.length ? (
              selected.map((tool) => (
                <span className={tool.enabled ? "" : "disabled"} key={tool.id}>
                  {tool.name}
                  {!tool.enabled ? "（已停用）" : ""}
                </span>
              ))
            ) : (
              <p>尚未选择测试工具</p>
            )}
          </div>
          <button
            type="button"
            className="model-test-tool-select-button"
            disabled={disabled}
            onClick={() => setOpen(true)}
          >
            选择测试工具
          </button>
        </>
      )}
      {open ? (
        <div
          className="model-test-tool-picker-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setOpen(false)
          }
        >
          <section
            className="model-test-tool-picker"
            role="dialog"
            aria-modal="true"
            aria-labelledby="model-test-tool-picker-title"
            onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
          >
            <header>
              <div>
                <h2 id="model-test-tool-picker-title">选择测试工具</h2>
                <p>{pickerDescription}</p>
              </div>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setOpen(false)}
              >
                <X aria-hidden />
              </button>
            </header>
            <label className="model-test-tool-search">
              <Search aria-hidden />
              <input
                autoFocus
                value={search}
                aria-label="搜索可用测试工具"
                placeholder="搜索工具"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="model-test-tool-options">
              {tools.length ? (
                tools.map((tool) => {
                  const checked = draft.includes(tool.id);
                  return (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      className={checked ? "selected" : ""}
                      key={tool.id}
                      onClick={() =>
                        setDraft((current) =>
                          checked
                            ? current.filter((id) => id !== tool.id)
                            : current.length < 20
                              ? [...current, tool.id]
                              : current,
                        )
                      }
                    >
                      <span className="model-test-tool-check">
                        {checked ? <Check aria-hidden /> : null}
                      </span>
                      <span>
                        <strong>{tool.name}</strong>
                        <small>
                          {tool.description ||
                            `${tool.parameter_count} 个输入参数`}
                        </small>
                      </span>
                      <em>
                        {tool.mock_kind === "success" ? "固定成功" : "模拟失败"}
                      </em>
                    </button>
                  );
                })
              ) : (
                <p className="model-test-tool-picker-empty">
                  没有可选择的测试工具
                </p>
              )}
            </div>
            <footer>
              <span>最多选择 20 个工具</span>
              <div>
                <button type="button" onClick={() => setOpen(false)}>
                  取消
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={saving}
                  onClick={() => {
                    setSaving(true);
                    void onSave(draft)
                      .then(() => setOpen(false))
                      .finally(() => setSaving(false));
                  }}
                >
                  {saving ? "保存中…" : "保存选择"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
