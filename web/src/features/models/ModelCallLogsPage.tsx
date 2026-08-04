import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Braces, Copy, X } from "lucide-react";
import {
  batchDeleteLogs,
  deleteLog,
  getCatalog,
  getLog,
  getLogs,
  getLogStats,
  type CallLogItem,
  type LogFilters,
} from "@features/models/api";
import { CustomSelect } from "@shared/ui/CustomSelect";

function formatNumber(value: number | null | undefined): string {
  return value == null ? "—" : new Intl.NumberFormat("zh-CN").format(value);
}

type JsonRecord = Record<string, unknown>;
type TraceRole = "system" | "user" | "assistant" | "tool";

type TraceMessage = {
  id: string;
  role: TraceRole;
  label: string;
  content: string;
  attachments?: JsonRecord[];
};

const sourceLabels: Record<string, string> = {
  model_diagnostic: "快速诊断",
  model_playground: "模型测试",
  visual_workshop_assistant: "视觉助手",
  visual_workshop_generation: "视觉生成",
};

const providerLabels: Record<string, string> = {
  openai: "OpenAI 兼容",
  anthropic: "Anthropic",
  senseaudio_image: "SenseAudio 图片",
  senseaudio_video: "SenseAudio 视频",
};

const roleLabels: Record<TraceRole, string> = {
  system: "系统指令",
  user: "用户",
  assistant: "助手",
  tool: "工具",
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readableJson(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return JSON.stringify(value, null, 2);
}

function contentText(value: unknown): string {
  if (!Array.isArray(value)) return readableJson(value);
  return value
    .map((part) => {
      if (!isRecord(part)) return readableJson(part);
      if (typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
      if (part.type === "image" || part.type === "image_url") return "[图片]";
      return readableJson(part);
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeRole(value: unknown): TraceRole {
  if (value === "system" || value === "user" || value === "assistant")
    return value;
  return "tool";
}

function toolMessages(value: unknown, prefix: string): TraceMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((call, index) => {
    const fn = isRecord(call.function) ? call.function : call;
    const name = typeof fn.name === "string" ? fn.name : "未命名工具";
    const args = fn.arguments ?? fn.input ?? call.arguments ?? call.input ?? {};
    return {
      id: `${prefix}-tool-${index}`,
      role: "tool",
      label: `工具调用 · ${name}`,
      content: readableJson(args),
    };
  });
}

function parseMessage(value: unknown, id: string): TraceMessage[] {
  if (!isRecord(value)) return [];
  const role = normalizeRole(value.role);
  const content = contentText(value.content ?? value.text ?? value.output);
  const name = typeof value.name === "string" ? value.name : "";
  const attachments = Array.isArray(value.attachments)
    ? value.attachments.filter(isRecord)
    : undefined;
  const message =
    content || attachments?.length
      ? [
          {
            id,
            role,
            label: name ? `${roleLabels[role]} · ${name}` : roleLabels[role],
            content,
            attachments,
          },
        ]
      : [];
  return [...message, ...toolMessages(value.tool_calls, id)];
}

function traceMessages(
  request: JsonRecord,
  response: JsonRecord,
): TraceMessage[] {
  const result: TraceMessage[] = [];
  const system = contentText(request.system ?? request.system_prompt);
  if (system) {
    result.push({
      id: "system",
      role: "system",
      label: "系统指令",
      content: system,
    });
  }
  if (Array.isArray(request.messages)) {
    request.messages.forEach((message, index) => {
      result.push(...parseMessage(message, `request-${index}`));
    });
  } else {
    const prompt = contentText(request.prompt ?? request.input);
    if (prompt)
      result.push({
        id: "prompt",
        role: "user",
        label: "用户",
        content: prompt,
      });
  }

  const responseMessage = isRecord(response.message) ? response.message : null;
  if (responseMessage)
    result.push(...parseMessage(responseMessage, "response-message"));
  const choices = Array.isArray(response.choices) ? response.choices : [];
  choices.filter(isRecord).forEach((choice, index) => {
    result.push(
      ...parseMessage(
        choice.message ?? choice.delta,
        `response-choice-${index}`,
      ),
    );
  });
  if (!responseMessage && choices.length === 0) {
    const content = contentText(
      response.content ?? response.output ?? response.text,
    );
    if (content) {
      result.push({
        id: "response",
        role: "assistant",
        label: "助手",
        content,
      });
    }
    result.push(...toolMessages(response.tool_calls, "response"));
  }
  return result;
}

function approximateTokens(value: string): number {
  if (!value) return 0;
  let tokens = 0;
  for (const character of value) {
    tokens += /[\u3400-\u9fff]/.test(character) ? 1 : 0.25;
  }
  return Math.max(1, Math.ceil(tokens));
}

function copyText(value: string) {
  return navigator.clipboard.writeText(value);
}

function CopyButton({
  label,
  value,
  text = "",
}: {
  label: string;
  value: string;
  text?: string;
}) {
  return (
    <button
      type="button"
      className={text ? "text-btn log-copy-text" : "log-copy-button"}
      aria-label={label}
      title={label}
      onClick={() => void copyText(value)}
    >
      <Copy aria-hidden />
      {text}
    </button>
  );
}

function MessageTrace({ messages }: { messages: TraceMessage[] }) {
  return (
    <section className="log-trace" aria-label="消息链">
      <div className="log-section-heading">
        <div>
          <span className="log-section-kicker">PROMPT TRACE</span>
          <h3>消息链</h3>
        </div>
        <span>{messages.length} 条消息</span>
      </div>
      <div className="trace-message-list">
        {messages.map((message, index) => (
          <article className={`trace-message ${message.role}`} key={message.id}>
            <header>
              <strong>{message.label}</strong>
              <div>
                <span>
                  {Array.from(message.content).length.toLocaleString("zh-CN")}{" "}
                  字符 · ≈
                  {approximateTokens(message.content).toLocaleString("zh-CN")}{" "}
                  Token
                </span>
                <CopyButton
                  label={`复制第 ${index + 1} 条${message.label}消息`}
                  value={message.content}
                />
              </div>
            </header>
            {message.content ? <pre>{message.content}</pre> : null}
            {message.attachments?.length ? (
              <div className="trace-attachments">
                {message.attachments.map((attachment, attachmentIndex) => (
                  <span key={`${message.id}-attachment-${attachmentIndex}`}>
                    附件 {attachmentIndex + 1} ·{" "}
                    {String(attachment.mime_type ?? "文件")}
                    {typeof attachment.byte_size === "number"
                      ? ` · ${formatNumber(attachment.byte_size)} B`
                      : ""}
                  </span>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function LogDetail({
  id,
  onClose,
  onDelete,
}: {
  id: string;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const query = useQuery({
    queryKey: ["model-log", id],
    queryFn: () => getLog(id),
  });
  const log = query.data;
  const messages = useMemo(
    () => (log ? traceMessages(log.request_payload, log.response_payload) : []),
    [log],
  );
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);
  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="log-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="log-detail-title"
      >
        <div className="drawer-head">
          <div>
            <span className="eyebrow">CALL DETAIL</span>
            <h2 id="log-detail-title">调用详情</h2>
            <div className="log-detail-id">
              <code>{id}</code>
              <CopyButton label="复制日志 ID" value={id} />
            </div>
          </div>
          <button
            className="icon-btn log-close-button"
            aria-label="关闭调用详情"
            onClick={onClose}
          >
            <X aria-hidden />
          </button>
        </div>
        {query.isLoading ? (
          <p className="log-detail-state">加载中…</p>
        ) : log ? (
          <div className="drawer-content">
            <dl className="detail-grid">
              <div>
                <dt>状态</dt>
                <dd>
                  <span className={`status ${log.status}`}>
                    {log.status === "success" ? "成功" : "失败"}
                  </span>
                </dd>
              </div>
              <div>
                <dt>模型</dt>
                <dd>{log.model}</dd>
              </div>
              <div>
                <dt>调用源</dt>
                <dd>{sourceLabels[log.call_source] ?? log.call_source}</dd>
              </div>
              <div>
                <dt>供应商</dt>
                <dd>
                  {providerLabels[log.provider_kind] ?? log.provider_kind}
                </dd>
              </div>
              <div>
                <dt>耗时</dt>
                <dd>{log.latency_ms} ms</dd>
              </div>
              <div>
                <dt>输入 Token</dt>
                <dd>{formatNumber(log.prompt_tokens)}</dd>
              </div>
              <div>
                <dt>输出 Token</dt>
                <dd>{formatNumber(log.completion_tokens)}</dd>
              </div>
              <div>
                <dt>总 Token</dt>
                <dd>{formatNumber(log.total_tokens)}</dd>
              </div>
              <div className="wide">
                <dt>时间</dt>
                <dd>{new Date(log.created_at).toLocaleString("zh-CN")}</dd>
              </div>
            </dl>
            {log.error_message ? (
              <div className="inline-alert danger">{log.error_message}</div>
            ) : null}
            {messages.length ? <MessageTrace messages={messages} /> : null}
            <details className="raw-payloads" open={!messages.length}>
              <summary>
                <span>
                  <Braces aria-hidden /> 原始数据
                </span>
                <small>用于排查供应商响应与参数</small>
              </summary>
              <section className="payload-card">
                <div>
                  <h3>请求</h3>
                  <CopyButton
                    label="复制原始请求"
                    value={JSON.stringify(log.request_payload, null, 2)}
                    text="复制"
                  />
                </div>
                <pre>{JSON.stringify(log.request_payload, null, 2)}</pre>
              </section>
              <section className="payload-card">
                <div>
                  <h3>响应</h3>
                  <CopyButton
                    label="复制原始响应"
                    value={JSON.stringify(log.response_payload, null, 2)}
                    text="复制"
                  />
                </div>
                <pre>{JSON.stringify(log.response_payload, null, 2)}</pre>
              </section>
            </details>
            <section className="trace-card">
              <div>
                <span>Trace ID</span>
                <code>{log.trace_id}</code>
              </div>
              <CopyButton label="复制 Trace ID" value={log.trace_id} />
            </section>
          </div>
        ) : (
          <p className="log-detail-state">日志不存在。</p>
        )}
        <div className="drawer-footer">
          <button className="btn danger" onClick={() => onDelete(id)}>
            删除日志
          </button>
          <button className="btn primary" onClick={onClose}>
            完成
          </button>
        </div>
      </aside>
    </div>
  );
}

export function ModelCallLogsPage() {
  const queryClient = useQueryClient();
  const [draftSearch, setDraftSearch] = useState("");
  const [filters, setFilters] = useState<LogFilters>({
    q: "",
    callSource: "",
    providerKind: "",
    model: "",
    status: "",
    from: "",
    to: "",
    page: 1,
    pageSize: 25,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const listQuery = useQuery({
    queryKey: ["model-logs", filters],
    queryFn: () => getLogs(filters),
  });
  const catalogQuery = useQuery({
    queryKey: ["model-catalog"],
    queryFn: getCatalog,
  });
  const statsQuery = useQuery({
    queryKey: ["model-log-stats"],
    queryFn: getLogStats,
  });
  const models = useMemo(
    () => [
      ...new Set(
        (catalogQuery.data?.providers ?? []).flatMap((provider) =>
          provider.models.map((model) => model.slug),
        ),
      ),
    ],
    [catalogQuery.data],
  );
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["model-logs"] }),
      queryClient.invalidateQueries({ queryKey: ["model-log-stats"] }),
    ]);
  };
  const removeOne = useMutation({
    mutationFn: deleteLog,
    onSuccess: async (_, id) => {
      setSelected((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      setDetailId(null);
      await invalidate();
    },
  });
  const removeMany = useMutation({
    mutationFn: batchDeleteLogs,
    onSuccess: async () => {
      setSelected(new Set());
      await invalidate();
    },
  });
  const setFilter = <K extends keyof LogFilters>(
    key: K,
    value: LogFilters[K],
  ) =>
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: key === "page" ? (value as number) : 1,
    }));
  const rows = listQuery.data?.items ?? [];
  const pages = Math.max(
    1,
    Math.ceil((listQuery.data?.total ?? 0) / filters.pageSize),
  );
  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const confirmOne = (id: string) => {
    if (confirm("确定删除这条调用日志？")) removeOne.mutate(id);
  };

  return (
    <section className="page logs-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">OBSERVABILITY</span>
          <h1>模型调用日志</h1>
          <p>查看各类模型调用的消息链、Token 用量、耗时与原始数据。</p>
        </div>
      </header>
      <div className="stat-grid">
        {[
          ["今日调用", statsQuery.data?.calls_today, "次"],
          ["今日 Token", statsQuery.data?.total_tokens_today, ""],
          ["平均耗时", statsQuery.data?.avg_latency_ms_today, "ms"],
          ["今日失败", statsQuery.data?.errors_today, "次"],
        ].map(([label, value, unit], index) => (
          <div
            className={`stat-card${index === 3 ? " danger-stat" : ""}`}
            key={String(label)}
          >
            <span>{label}</span>
            <strong>
              {formatNumber(value as number | undefined)} <small>{unit}</small>
            </strong>
          </div>
        ))}
      </div>
      <div className="logs-card card">
        <div className="logs-toolbar">
          <form
            className="search-box"
            onSubmit={(event) => {
              event.preventDefault();
              setFilter("q", draftSearch.trim());
            }}
          >
            <span>⌕</span>
            <input
              value={draftSearch}
              onChange={(event) => setDraftSearch(event.target.value)}
              placeholder="搜索模型、日志 ID 或 Trace ID"
            />
            <button className="btn" type="submit">
              搜索
            </button>
          </form>
          <div className="filter-row">
            <CustomSelect
              ariaLabel="调用源筛选"
              value={filters.callSource}
              onChange={(value) => setFilter("callSource", value)}
              options={[
                { value: "", label: "全部调用源" },
                { value: "model_diagnostic", label: "快速诊断" },
                { value: "model_playground", label: "模型测试" },
                { value: "visual_workshop_assistant", label: "视觉助手" },
              ]}
            />
            <CustomSelect
              ariaLabel="供应商筛选"
              value={filters.providerKind}
              onChange={(value) => setFilter("providerKind", value)}
              options={[
                { value: "", label: "全部供应商" },
                { value: "openai", label: "OpenAI 兼容" },
                { value: "anthropic", label: "Anthropic" },
              ]}
            />
            <CustomSelect
              ariaLabel="模型筛选"
              value={filters.model}
              onChange={(value) => setFilter("model", value)}
              options={[
                { value: "", label: "全部模型" },
                ...models.map((model) => ({ value: model, label: model })),
              ]}
            />
            <CustomSelect
              ariaLabel="状态筛选"
              value={filters.status}
              onChange={(value) => setFilter("status", value)}
              options={[
                { value: "", label: "全部状态" },
                { value: "success", label: "成功" },
                { value: "error", label: "失败" },
              ]}
            />
            <label className="date-filter">
              <span>从</span>
              <input
                type="date"
                value={filters.from}
                onChange={(event) => setFilter("from", event.target.value)}
              />
            </label>
            <label className="date-filter">
              <span>至</span>
              <input
                type="date"
                value={filters.to}
                onChange={(event) => setFilter("to", event.target.value)}
              />
            </label>
            <button
              className="text-btn"
              onClick={() => {
                setDraftSearch("");
                setFilters({
                  q: "",
                  callSource: "",
                  providerKind: "",
                  model: "",
                  status: "",
                  from: "",
                  to: "",
                  page: 1,
                  pageSize: 25,
                });
              }}
            >
              重置
            </button>
          </div>
        </div>
        <div className="table-meta">
          <p>
            共 <strong>{listQuery.data?.total ?? 0}</strong> 条日志
          </p>
          <button
            className="btn danger"
            disabled={!selected.size || removeMany.isPending}
            onClick={() => {
              if (confirm(`确定删除选中的 ${selected.size} 条日志？`))
                removeMany.mutate([...selected]);
            }}
          >
            批量删除{selected.size ? ` (${selected.size})` : ""}
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="全选当前页"
                    checked={
                      rows.length > 0 &&
                      rows.every((row) => selected.has(row.id))
                    }
                    onChange={(event) =>
                      rows.forEach((row) =>
                        toggle(row.id, event.target.checked),
                      )
                    }
                  />
                </th>
                <th>时间</th>
                <th>供应商</th>
                <th>调用源</th>
                <th>模型</th>
                <th>Token</th>
                <th>耗时</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.isLoading ? (
                <tr>
                  <td colSpan={9} className="table-empty">
                    加载中…
                  </td>
                </tr>
              ) : rows.length ? (
                rows.map((row: CallLogItem) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={(event) =>
                          toggle(row.id, event.target.checked)
                        }
                      />
                    </td>
                    <td>
                      <time>
                        {new Date(row.created_at).toLocaleString("zh-CN")}
                      </time>
                    </td>
                    <td>
                      {providerLabels[row.provider_kind] ?? row.provider_kind}
                    </td>
                    <td>
                      <span className="source-badge">
                        {sourceLabels[row.call_source] ?? row.call_source}
                      </span>
                    </td>
                    <td>
                      <strong>{row.model}</strong>
                      <small className="row-sub">
                        {row.trace_id.slice(0, 8)}…
                      </small>
                    </td>
                    <td>{formatNumber(row.total_tokens)}</td>
                    <td>{row.latency_ms} ms</td>
                    <td>
                      <span className={`status ${row.status}`}>
                        {row.status === "success" ? "成功" : "失败"}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="text-btn"
                          onClick={() => setDetailId(row.id)}
                        >
                          详情
                        </button>
                        <button
                          className="text-btn danger-text"
                          onClick={() => confirmOne(row.id)}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="table-empty">
                    <span>◇</span>
                    <strong>暂无调用日志</strong>
                    <small>
                      快速诊断、模型测试与视觉助手产生的结果会显示在这里。
                    </small>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <span>每页</span>
          <CustomSelect
            ariaLabel="每页条数"
            className="page-size-select"
            value={String(filters.pageSize)}
            onChange={(value) => setFilter("pageSize", Number(value))}
            options={[
              { value: "25", label: "25" },
              { value: "50", label: "50" },
              { value: "100", label: "100" },
            ]}
          />
          <button
            className="btn"
            disabled={filters.page <= 1}
            onClick={() => setFilter("page", filters.page - 1)}
          >
            上一页
          </button>
          <span>
            {filters.page} / {pages}
          </span>
          <button
            className="btn"
            disabled={filters.page >= pages}
            onClick={() => setFilter("page", filters.page + 1)}
          >
            下一页
          </button>
        </div>
      </div>
      {detailId ? (
        <LogDetail
          id={detailId}
          onClose={() => setDetailId(null)}
          onDelete={confirmOne}
        />
      ) : null}
    </section>
  );
}
