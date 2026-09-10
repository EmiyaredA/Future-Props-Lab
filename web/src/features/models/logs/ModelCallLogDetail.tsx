import { useWorkspacePermission } from "@platform/auth/WorkspacePermissions";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Braces, ChevronDown, Copy, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getLog } from "@features/models/api";
import { providerLabels } from "@features/models/logs/logOptions";
import { LogReproductionButton } from "@features/models/logs/LogReproductionButton";
import { modelQueryKeys } from "@features/models/queryKeys";
import {
  formatNumber,
  sourceLabels,
} from "@features/models/logs/modelCallLogPresentation";

type JsonRecord = Record<string, unknown>;
type TraceRole = "system" | "user" | "assistant" | "tool";
type DisplayMode = "readable" | "json";
type TextMode = "markdown" | "raw";

type TraceMessage = {
  id: string;
  role: TraceRole;
  label: string;
  content: string;
  attachments?: JsonRecord[];
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

function requestMessages(request: JsonRecord): TraceMessage[] {
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

  return result;
}

function firstChoice(response: JsonRecord): JsonRecord | null {
  const choices = Array.isArray(response.choices)
    ? response.choices.filter(isRecord)
    : [];
  return choices[0] ?? null;
}

function responseMessage(response: JsonRecord): JsonRecord | null {
  if (isRecord(response.message)) return response.message;
  const choice = firstChoice(response);
  return choice && isRecord(choice.message) ? choice.message : null;
}

function responseContent(response: JsonRecord): string {
  const message = responseMessage(response);
  if (message) return contentText(message.content ?? message.text);
  return contentText(response.content ?? response.output ?? response.text);
}

function responseFinishReason(response: JsonRecord): string {
  const choice = firstChoice(response);
  return String(
    response.finish_reason ??
      choice?.finish_reason ??
      response.run_status ??
      "—",
  );
}

function responseTools(response: JsonRecord): JsonRecord[] {
  if (Array.isArray(response.actions)) return response.actions.filter(isRecord);
  const message = responseMessage(response);
  const source = message?.tool_calls ?? response.tool_calls;
  return Array.isArray(source) ? source.filter(isRecord) : [];
}

function integerValue(...values: unknown[]): number | null {
  const match = values.find((value) => typeof value === "number");
  return typeof match === "number" ? match : null;
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
              <strong>
                {message.role === "user" &&
                !messages.slice(index + 1).some((item) => item.role === "user")
                  ? "用户 · 本轮"
                  : message.label}
              </strong>
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

function InspectorSection({
  tone,
  title,
  children,
}: {
  tone: "request" | "response" | "metrics";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className={`log-inspector-section ${tone}`} open>
      <summary>
        <strong>{title}</strong>
        <ChevronDown aria-hidden />
      </summary>
      <div className="log-inspector-section-body">{children}</div>
    </details>
  );
}

function RawJson({ value }: { value: JsonRecord }) {
  return (
    <div className="log-json-view">
      <CopyButton label="复制 JSON" value={JSON.stringify(value, null, 2)} />
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

export function LogDetail({
  id,
  onClose,
  onDelete,
}: {
  id: string;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const canDelete = useWorkspacePermission("configuration.manage");
  const query = useQuery({
    queryKey: modelQueryKeys.log(id),
    queryFn: () => getLog(id),
  });
  const log = query.data;
  const diagnostics = useWorkspacePermission("diagnostics.model");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("readable");
  const [textMode, setTextMode] = useState<TextMode>("markdown");
  const messages = useMemo(
    () => (log ? requestMessages(log.request_payload) : []),
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
            <dl className="log-meta-card">
              {[
                ["时间", new Date(log.created_at).toLocaleString("zh-CN")],
                ["调用源", sourceLabels[log.call_source] ?? log.call_source],
                ["模型", log.model],
                [
                  "Provider",
                  providerLabels[log.provider_kind] ?? log.provider_kind,
                ],
                ["会话", String(log.request_payload.conversation_id ?? "—")],
                ["状态", log.status === "success" ? "成功" : "失败"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {diagnostics ? (
              <>
                <div className="log-display-toolbar">
                  <span>内容展示</span>
                  <div className="log-segmented" aria-label="内容展示模式">
                    <button
                      className={displayMode === "readable" ? "active" : ""}
                      onClick={() => setDisplayMode("readable")}
                    >
                      可读
                    </button>
                    <button
                      className={displayMode === "json" ? "active" : ""}
                      onClick={() => setDisplayMode("json")}
                    >
                      JSON
                    </button>
                  </div>
                  <div
                    className="log-segmented text-mode"
                    aria-label="回复文本模式"
                  >
                    <button
                      className={textMode === "markdown" ? "active" : ""}
                      onClick={() => setTextMode("markdown")}
                    >
                      MD
                    </button>
                    <button
                      className={textMode === "raw" ? "active" : ""}
                      onClick={() => setTextMode("raw")}
                    >
                      原文
                    </button>
                  </div>
                </div>
                {log.error_message ? (
                  <div className="inline-alert danger">{log.error_message}</div>
                ) : null}
                <InspectorSection tone="request" title="请求上下文">
                  {displayMode === "json" ? (
                    <RawJson value={log.request_payload} />
                  ) : messages.length ? (
                    <div className="log-history-card">
                      <header>
                        <strong>对话历史 ({messages.length})</strong>
                        <CopyButton
                          label="复制请求上下文"
                          value={JSON.stringify(log.request_payload, null, 2)}
                        />
                      </header>
                      <MessageTrace messages={messages} />
                    </div>
                  ) : (
                    <div className="log-empty-block">
                      该日志没有保存可读请求上下文。
                    </div>
                  )}
                </InspectorSection>
                <InspectorSection tone="response" title="模型回复">
                  {displayMode === "json" ? (
                    <RawJson value={log.response_payload} />
                  ) : (
                    <div className="log-response-stack">
                      <div className="log-response-card">
                        <header>
                          <span>文本</span>
                          <CopyButton
                            label="复制模型回复"
                            value={responseContent(log.response_payload)}
                          />
                        </header>
                        <div className="log-response-content">
                          {responseContent(log.response_payload) ? (
                            textMode === "markdown" ? (
                              <div className="markdown-body">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {responseContent(log.response_payload)}
                                </ReactMarkdown>
                              </div>
                            ) : (
                              <pre>{responseContent(log.response_payload)}</pre>
                            )
                          ) : (
                            <span>无文本回复</span>
                          )}
                        </div>
                      </div>
                      <details
                        className="log-response-meta"
                        open={responseTools(log.response_payload).length > 0}
                      >
                        <summary>
                          <span>TOOL_CALLS</span>
                          <small>
                            {responseTools(log.response_payload).length || "—"}
                          </small>
                          <ChevronDown aria-hidden />
                        </summary>
                        <pre>
                          {JSON.stringify(
                            responseTools(log.response_payload),
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                      <div className="log-response-meta static">
                        <span>FINISH_REASON</span>
                        <code>
                          {responseFinishReason(log.response_payload)}
                        </code>
                        <CopyButton
                          label="复制结束原因"
                          value={responseFinishReason(log.response_payload)}
                        />
                      </div>
                    </div>
                  )}
                </InspectorSection>
              </>
            ) : (
              <p className="log-detail-state">
                当前身份可查看调用概况，完整请求与响应需要诊断权限。
              </p>
            )}
            <InspectorSection tone="metrics" title="Token 与耗时">
              <dl className="log-metrics-grid">
                {[
                  ["Prompt Tokens", formatNumber(log.prompt_tokens)],
                  ["Completion Tokens", formatNumber(log.completion_tokens)],
                  ["Total Tokens", formatNumber(log.total_tokens)],
                  ["总耗时", `${formatNumber(log.latency_ms)} ms`],
                  [
                    "首 Token",
                    integerValue(log.response_payload.first_token_latency_ms) ==
                    null
                      ? "—"
                      : `${formatNumber(integerValue(log.response_payload.first_token_latency_ms))} ms`,
                  ],
                  [
                    "轮次",
                    formatNumber(
                      integerValue(
                        log.response_payload.rounds,
                        log.request_payload.rounds,
                      ),
                    ),
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </InspectorSection>
            <div className="log-identifiers">
              <div>
                <span>日志 ID</span>
                <code>{log.id}</code>
              </div>
              <CopyButton label="复制日志 ID" value={log.id} />
              <div>
                <span>Trace ID</span>
                <code>{log.trace_id}</code>
              </div>
              <CopyButton label="复制 Trace ID" value={log.trace_id} />
              <Braces aria-hidden />
            </div>
          </div>
        ) : (
          <p className="log-detail-state">日志不存在。</p>
        )}
        <div className="drawer-footer">
          {log ? <LogReproductionButton log={log} /> : null}
          {canDelete && (
            <button className="btn danger" onClick={() => onDelete(id)}>
              删除日志
            </button>
          )}
          <button className="btn primary" onClick={onClose}>
            完成
          </button>
        </div>
      </aside>
    </div>
  );
}
