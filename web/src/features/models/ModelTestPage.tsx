import {
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  Bot,
  CircleAlert,
  Code2,
  Copy,
  MessageSquareText,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Square,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import {
  createModelTestConversation,
  deleteModelTestConversation,
  getCatalog,
  getModelTestConversation,
  getModelTestConversations,
  patchModelTestConversation,
  streamModelTest,
  type ModelStreamEvent,
  type ModelTestConversation,
  type ModelTestMessage,
} from "@features/models/api";
import { CustomSelect, type SelectOption } from "@shared/ui/CustomSelect";

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<{ children?: ReactNode }>(node))
    return extractText(node.props.children);
  return "";
}

function languageLabel(language?: string) {
  if (!language) return "Code";
  const labels: Record<string, string> = {
    bash: "Bash",
    css: "CSS",
    html: "HTML",
    javascript: "JavaScript",
    js: "JavaScript",
    json: "JSON",
    python: "Python",
    py: "Python",
    shell: "Shell",
    sql: "SQL",
    ts: "TypeScript",
    typescript: "TypeScript",
  };
  return labels[language.toLowerCase()] || language;
}

function MarkdownCodeBlock({ children }: ComponentPropsWithoutRef<"pre">) {
  const code = isValidElement<{
    className?: string;
    children?: ReactNode;
  }>(children)
    ? children
    : null;
  const language = code?.props.className?.match(/language-([^\s]+)/)?.[1];
  const source = extractText(code?.props.children).replace(/\n$/, "");
  return (
    <div className="markdown-code-block">
      <div className="markdown-code-head">
        <span>
          <Code2 aria-hidden /> {languageLabel(language)}
        </span>
        <button
          type="button"
          aria-label="复制代码"
          onClick={() => void navigator.clipboard.writeText(source)}
        >
          <Copy aria-hidden />
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function errorPresentation(raw: string) {
  if (/401|unauthori[sz]ed|invalid.{0,12}(api|key)|authentication/i.test(raw)) {
    return {
      code: "401 Unauthorized",
      title: "认证失败",
      message: "请检查 API Key 或网关地址后重新生成。",
    };
  }
  if (/timeout|timed out|超时/i.test(raw)) {
    return {
      code: "请求超时",
      title: "模型响应超时",
      message: "请稍后重试，或适当降低最大输出 Token。",
    };
  }
  return {
    code: "调用失败",
    title: "模型调用失败",
    message: "请检查供应商配置和模型状态后重试。",
  };
}

function formatConversationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function EmptyChat() {
  return (
    <div className="playground-empty">
      <span className="playground-empty-icon">
        <Sparkles aria-hidden />
      </span>
      <h2>开始一次模型测试</h2>
      <p>选择一个已启用的文本模型，输入问题后即可查看流式回复效果。</p>
    </div>
  );
}

function MessageCard({
  message,
  contentOverride,
  isLastAssistant,
  generating,
  onRegenerate,
  onShowError,
}: {
  message: ModelTestMessage;
  contentOverride?: string;
  isLastAssistant: boolean;
  generating: boolean;
  onRegenerate: () => void;
  onShowError: (error: string) => void;
}) {
  const content = contentOverride ?? message.content;
  const statusLabel = {
    pending: "生成中",
    completed: "",
    error: "生成失败",
    cancelled: "已停止",
    superseded: "已替换",
  }[message.status];
  const errorInfo = message.error_message
    ? errorPresentation(message.error_message)
    : null;
  return (
    <article className={`chat-message ${message.role} ${message.status}`}>
      <div className="chat-avatar">
        {message.role === "user" ? (
          <UserRound aria-hidden />
        ) : (
          <Bot aria-hidden />
        )}
      </div>
      <div className="chat-message-body">
        <div className="chat-message-meta">
          <strong>{message.role === "user" ? "你" : "模型回复"}</strong>
          {message.model_slug ? <span>{message.model_slug}</span> : null}
          {statusLabel ? <em>{statusLabel}</em> : null}
        </div>
        {message.role === "assistant" ? (
          content ? (
            <div className="markdown-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{ pre: MarkdownCodeBlock }}
              >
                {content}
              </ReactMarkdown>
              {message.status === "pending" ? (
                <i className="stream-caret" />
              ) : null}
            </div>
          ) : (
            <div className="typing-indicator" aria-label="正在生成">
              <i />
              <i />
              <i />
            </div>
          )
        ) : (
          <p className="user-copy">{content}</p>
        )}
        {errorInfo && message.error_message ? (
          <div className="model-error-card" role="alert">
            <div className="model-error-icon">
              <CircleAlert aria-hidden />
            </div>
            <div className="model-error-copy">
              <div>
                <strong>{errorInfo.title}</strong>
                <span>{errorInfo.code}</span>
              </div>
              <p>{errorInfo.message}</p>
              <div className="model-error-actions">
                <button
                  type="button"
                  onClick={() => onShowError(message.error_message as string)}
                >
                  查看详情
                </button>
                {isLastAssistant ? (
                  <button
                    type="button"
                    disabled={generating}
                    onClick={onRegenerate}
                  >
                    重新生成
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
        {message.role === "assistant" && content ? (
          <div className="message-actions">
            <button
              type="button"
              aria-label="复制原始输出"
              onClick={() => void navigator.clipboard.writeText(content)}
            >
              <Copy aria-hidden /> 复制原始输出
            </button>
            {isLastAssistant && !errorInfo ? (
              <button
                type="button"
                disabled={generating}
                onClick={onRegenerate}
              >
                重新生成
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function ModelTestPage() {
  const queryClient = useQueryClient();
  const catalogQuery = useQuery({
    queryKey: ["model-catalog"],
    queryFn: getCatalog,
  });
  const conversationsQuery = useQuery({
    queryKey: ["model-test-conversations"],
    queryFn: getModelTestConversations,
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [streamedContent, setStreamedContent] = useState("");
  const [conversationSearch, setConversationSearch] = useState("");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [temperatureDraft, setTemperatureDraft] = useState(0.7);
  const [mobilePanel, setMobilePanel] = useState<
    "conversations" | "settings" | null
  >(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoCreated = useRef(false);

  const availableModels = useMemo(
    () =>
      (catalogQuery.data?.providers ?? []).flatMap((provider) =>
        provider.enabled
          ? provider.models
              .filter(
                (model) => model.enabled && model.capabilities.includes("chat"),
              )
              .map((model) => ({
                value: model.id,
                label: model.label || model.slug,
                description: `${provider.name} · ${model.slug}`,
              }))
          : [],
      ),
    [catalogQuery.data],
  );
  const modelOptions: SelectOption[] = availableModels.length
    ? availableModels
    : [{ value: "", label: "暂无可用文本模型", disabled: true }];

  const createMutation = useMutation({
    mutationFn: () => createModelTestConversation(availableModels[0]?.value),
    onSuccess: async (conversation) => {
      setActiveId(conversation.id);
      await queryClient.invalidateQueries({
        queryKey: ["model-test-conversations"],
      });
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
  });

  useEffect(() => {
    const items = conversationsQuery.data?.items;
    if (!items) return;
    if (
      items.length &&
      (!activeId || !items.some((item) => item.id === activeId))
    ) {
      setActiveId(items[0].id);
    } else if (
      !items.length &&
      !autoCreated.current &&
      !createMutation.isPending
    ) {
      autoCreated.current = true;
      createMutation.mutate();
    }
  }, [activeId, conversationsQuery.data?.items, createMutation]);

  const detailQuery = useQuery({
    queryKey: ["model-test-conversation", activeId],
    queryFn: () => getModelTestConversation(activeId as string),
    enabled: Boolean(activeId),
  });
  const conversation = detailQuery.data;

  useEffect(() => {
    if (conversation && !streamingId)
      setTemperatureDraft(conversation.temperature);
  }, [conversation, streamingId]);

  const updateLocal = (next: ModelTestConversation) => {
    queryClient.setQueryData(["model-test-conversation", next.id], next);
    void queryClient.invalidateQueries({
      queryKey: ["model-test-conversations"],
    });
  };
  const patch = async (
    changes: Partial<
      Pick<
        ModelTestConversation,
        "title" | "model_id" | "system_prompt" | "temperature" | "max_tokens"
      >
    >,
  ) => {
    if (!conversation || streamingId) return;
    setError("");
    try {
      updateLocal(
        await patchModelTestConversation(
          conversation.id,
          conversation.revision,
          changes,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await detailQuery.refetch();
    }
  };

  const remove = async () => {
    if (!conversation || streamingId) return;
    if (!confirm(`删除对话「${conversation.title}」？`)) return;
    try {
      await deleteModelTestConversation(conversation.id, conversation.revision);
      setActiveId(null);
      autoCreated.current = false;
      await conversationsQuery.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const run = async (regenerate: boolean) => {
    if (!conversation || streamingId || (!regenerate && !input.trim())) return;
    setError("");
    setStreamedContent("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamModelTest(
        conversation.id,
        {
          expected_revision: conversation.revision,
          ...(regenerate ? {} : { content: input.trim() }),
        },
        regenerate,
        controller.signal,
        (event: ModelStreamEvent) => {
          if (event.type === "start") {
            setStreamingId(String(event.payload.assistant_message_id));
            if (!regenerate) setInput("");
            void detailQuery.refetch();
          } else if (event.type === "delta") {
            setStreamedContent(
              (current) => current + String(event.payload.text || ""),
            );
          } else if (event.type === "error") {
            const raw = String(event.payload.message || "模型调用失败");
            const friendly = errorPresentation(raw);
            setError(`${friendly.title}：${friendly.message}`);
          }
        },
      );
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        const raw = cause instanceof Error ? cause.message : String(cause);
        const friendly = errorPresentation(raw);
        setError(`${friendly.title}：${friendly.message}`);
      }
    } finally {
      abortRef.current = null;
      setStreamingId(null);
      setStreamedContent("");
      await Promise.all([
        detailQuery.refetch(),
        queryClient.invalidateQueries({
          queryKey: ["model-test-conversations"],
        }),
        queryClient.invalidateQueries({ queryKey: ["model-logs"] }),
      ]);
    }
  };

  const visibleMessages = (conversation?.messages ?? []).filter(
    (message) => message.status !== "superseded",
  );
  const lastAssistantId = [...visibleMessages]
    .reverse()
    .find((message) => message.role === "assistant")?.id;
  const selectedModelAvailable = availableModels.some(
    (model) => model.value === conversation?.model_id,
  );
  const conversationItems = conversationsQuery.data?.items ?? [];
  const normalizedSearch = conversationSearch.trim().toLowerCase();
  const filteredConversations = normalizedSearch
    ? conversationItems.filter((item) =>
        `${item.title} ${item.model_slug || ""}`
          .toLowerCase()
          .includes(normalizedSearch),
      )
    : conversationItems;

  return (
    <section className="model-test-page">
      <header className="playground-header">
        <div>
          <h1>模型测试</h1>
          <p>通过多轮对话测试模型连通性与回复效果。</p>
        </div>
        <div className="mobile-panel-actions">
          <button
            className="btn"
            onClick={() => setMobilePanel("conversations")}
          >
            对话
          </button>
          <button className="btn" onClick={() => setMobilePanel("settings")}>
            参数
          </button>
        </div>
      </header>
      {error ? (
        <div className="inline-alert danger playground-alert" role="alert">
          {error}
          <button aria-label="关闭提示" onClick={() => setError("")}>
            <X aria-hidden />
          </button>
        </div>
      ) : null}
      <div className="playground-grid">
        <aside
          className={`conversation-panel${mobilePanel === "conversations" ? " mobile-open" : ""}`}
        >
          <div className="panel-heading">
            <strong>历史对话</strong>
          </div>
          <div className="conversation-tools">
            <button
              type="button"
              className="new-conversation-button"
              disabled={createMutation.isPending || Boolean(streamingId)}
              onClick={() => createMutation.mutate()}
            >
              <Plus aria-hidden /> 新建对话
            </button>
            <label className="conversation-search">
              <Search aria-hidden />
              <input
                value={conversationSearch}
                onChange={(event) => setConversationSearch(event.target.value)}
                placeholder="搜索对话"
                aria-label="搜索对话"
              />
            </label>
          </div>
          <div className="conversation-list">
            {filteredConversations.map((item) => (
              <button
                className={item.id === activeId ? "active" : ""}
                key={item.id}
                onClick={() => {
                  setActiveId(item.id);
                  setMobilePanel(null);
                }}
              >
                <span className="conversation-item-icon">
                  <MessageSquareText aria-hidden />
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    <span>{item.model_slug || "未选择模型"}</span>
                    <time>{formatConversationTime(item.updated_at)}</time>
                  </small>
                </span>
              </button>
            ))}
            {!filteredConversations.length && normalizedSearch ? (
              <p className="conversation-empty">没有匹配的对话</p>
            ) : null}
          </div>
          <div className="conversation-count">
            共 {conversationItems.length} 个对话
          </div>
          <button
            className="mobile-panel-close"
            onClick={() => setMobilePanel(null)}
          >
            收起
          </button>
        </aside>

        <main className="chat-panel">
          {conversation ? (
            <>
              <div className="chat-titlebar">
                <div className="chat-title-copy">
                  <input
                    key={`${conversation.id}-${conversation.title}`}
                    defaultValue={conversation.title}
                    aria-label="对话标题"
                    disabled={Boolean(streamingId)}
                    onBlur={(event) => {
                      const title = event.target.value.trim();
                      if (title && title !== conversation.title)
                        void patch({ title });
                    }}
                  />
                  {conversation.model_slug ? (
                    <span>{conversation.model_slug}</span>
                  ) : null}
                </div>
                <button
                  className="chat-delete-button"
                  aria-label="删除当前对话"
                  disabled={Boolean(streamingId)}
                  onClick={() => void remove()}
                >
                  <Trash2 aria-hidden />
                </button>
              </div>
              <div className="chat-scroll">
                {visibleMessages.length ? (
                  visibleMessages.map((message) => (
                    <MessageCard
                      key={message.id}
                      message={message}
                      contentOverride={
                        message.id === streamingId ? streamedContent : undefined
                      }
                      isLastAssistant={message.id === lastAssistantId}
                      generating={Boolean(streamingId)}
                      onRegenerate={() => void run(true)}
                      onShowError={setErrorDetail}
                    />
                  ))
                ) : (
                  <EmptyChat />
                )}
              </div>
              <div className="composer-wrap">
                {!selectedModelAvailable ? (
                  <p className="model-warning">
                    当前模型不可用，请在右侧重新选择已启用的 chat 模型。
                  </p>
                ) : null}
                <div className="composer">
                  <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void run(false);
                      }
                    }}
                    disabled={Boolean(streamingId)}
                    placeholder="输入要测试的问题"
                    rows={3}
                  />
                  <span className="composer-hint">
                    Enter 发送 · Shift + Enter 换行
                  </span>
                  {streamingId ? (
                    <button
                      className="send-button stop"
                      aria-label="停止生成"
                      onClick={() => abortRef.current?.abort()}
                    >
                      <Square aria-hidden fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      className="send-button"
                      aria-label="发送"
                      disabled={!input.trim() || !selectedModelAvailable}
                      onClick={() => void run(false)}
                    >
                      <ArrowUp aria-hidden />
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <EmptyChat />
          )}
        </main>

        <aside
          className={`settings-panel${mobilePanel === "settings" ? " mobile-open" : ""}`}
        >
          <div className="panel-heading">
            <strong>测试参数</strong>
          </div>
          {conversation ? (
            <div className="settings-form">
              <label>
                <span>模型</span>
                <CustomSelect
                  ariaLabel="测试模型"
                  value={conversation.model_id ?? ""}
                  options={modelOptions}
                  disabled={Boolean(streamingId)}
                  onChange={(model_id) => void patch({ model_id })}
                />
              </label>
              <label>
                <span>System Prompt</span>
                <textarea
                  key={`${conversation.id}-system-${conversation.revision}`}
                  defaultValue={conversation.system_prompt}
                  rows={7}
                  disabled={Boolean(streamingId)}
                  placeholder="可选，用于定义模型角色和回答要求"
                  onBlur={(event) => {
                    if (event.target.value !== conversation.system_prompt)
                      void patch({ system_prompt: event.target.value });
                  }}
                />
              </label>
              <label>
                <span>
                  Temperature <em>{temperatureDraft}</em>
                </span>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={temperatureDraft}
                  disabled={Boolean(streamingId)}
                  onChange={(event) =>
                    setTemperatureDraft(Number(event.target.value))
                  }
                  onPointerUp={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (value !== conversation.temperature)
                      void patch({ temperature: value });
                  }}
                  onKeyUp={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (value !== conversation.temperature)
                      void patch({ temperature: value });
                  }}
                />
                <small>数值越高，回复越有创造性。</small>
              </label>
              <label>
                <span>最大输出 Token</span>
                <input
                  type="number"
                  min="1"
                  max="8192"
                  key={`${conversation.id}-tokens-${conversation.max_tokens}`}
                  defaultValue={conversation.max_tokens}
                  disabled={Boolean(streamingId)}
                  onBlur={(event) => {
                    const value = Math.min(
                      8192,
                      Math.max(1, Number(event.target.value)),
                    );
                    if (value !== conversation.max_tokens)
                      void patch({ max_tokens: value });
                  }}
                />
              </label>
              <div className="parameter-note">
                <strong>上下文策略</strong>
                <p>
                  仅已成功完成的轮次会进入下一次请求；失败或停止的回复只保留展示。
                </p>
              </div>
              <button
                type="button"
                className="reset-parameters"
                disabled={Boolean(streamingId)}
                onClick={() => {
                  setTemperatureDraft(0.7);
                  void patch({
                    system_prompt: "",
                    temperature: 0.7,
                    max_tokens: 1024,
                  });
                }}
              >
                <RotateCcw aria-hidden /> 恢复默认参数
              </button>
            </div>
          ) : null}
          <button
            className="mobile-panel-close"
            onClick={() => setMobilePanel(null)}
          >
            收起
          </button>
        </aside>
      </div>
      {errorDetail ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setErrorDetail(null);
          }}
        >
          <div
            className="modal-card error-detail-modal"
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">调用错误</span>
                <h2>错误详情</h2>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="关闭错误详情"
                onClick={() => setErrorDetail(null)}
              >
                <X aria-hidden />
              </button>
            </div>
            <pre>{errorDetail}</pre>
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => void navigator.clipboard.writeText(errorDetail)}
              >
                复制完整错误
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => setErrorDetail(null)}
              >
                完成
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
