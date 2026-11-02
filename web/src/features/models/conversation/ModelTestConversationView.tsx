import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import {
  isValidElement,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import {
  Bot,
  CircleAlert,
  Code2,
  Copy,
  Image as ImageIcon,
  RotateCcw,
  Sparkles,
  UserRound,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type {
  ModelTestAttachment,
  ModelTestMessage,
} from "@features/models/api";
import { ModelTestToolCallList } from "@features/models/conversation/ModelTestToolControls";
import { useImagePreviewUrl } from "@platform/api/useImagePreviewUrl";
import { errorPresentation } from "@features/models/conversation/modelTestPresentation";

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

export function EmptyChat() {
  return (
    <div className="playground-empty">
      <span className="playground-empty-icon">
        <Sparkles aria-hidden />
      </span>
      <h2>开始一次模型测试</h2>
      <p>选择一个已启用的模型，输入问题或上传图片后即可查看流式回复效果。</p>
    </div>
  );
}

export function AttachmentImage({
  conversationId,
  attachment,
  onOpen,
}: {
  conversationId: string;
  attachment: ModelTestAttachment;
  onOpen: (url: string, name: string) => void;
}) {
  const { ref, url } = useImagePreviewUrl(
    `/v1/model-test/conversations/${encodeURIComponent(conversationId)}` +
      `/attachments/${encodeURIComponent(attachment.id)}/content`,
  );
  return (
    <span ref={ref}>
      <button
        type="button"
        className="attachment-image"
        aria-label={`查看图片 ${attachment.original_filename}`}
        disabled={!url}
        onClick={() =>
          onOpen(
            `/v1/model-test/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(attachment.id)}/content`,
            attachment.original_filename,
          )
        }
      >
        {url ? (
          <ResponsiveImage src={url} alt={attachment.original_filename} />
        ) : (
          <ImageIcon aria-hidden />
        )}
      </button>
    </span>
  );
}

export function MessageCard({
  conversationId,
  message,
  contentOverride,
  isLastAssistant,
  generating,
  onRegenerate,
  onShowError,
  onPreviewAttachment,
}: {
  conversationId: string;
  message: ModelTestMessage;
  contentOverride?: string;
  isLastAssistant: boolean;
  generating: boolean;
  onRegenerate: () => void;
  onShowError: (error: string) => void;
  onPreviewAttachment: (url: string, name: string) => void;
}) {
  const content = contentOverride ?? message.content;
  const statusLabel = {
    pending: "",
    completed: "",
    error: "生成失败",
    cancelled: "",
    superseded: "已替换",
  }[message.status];
  const replyStatus =
    message.role === "assistant" && message.status === "pending"
      ? { label: "正在回复", tone: "active" }
      : message.role === "assistant" && message.status === "cancelled"
        ? { label: "已停止", tone: "interrupt" }
        : null;
  const errorInfo =
    message.status === "error" && message.error_message
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
        {message.attachments?.length ? (
          <div className="message-attachments">
            {message.attachments.map((attachment) => (
              <AttachmentImage
                key={attachment.id}
                conversationId={conversationId}
                attachment={attachment}
                onOpen={onPreviewAttachment}
              />
            ))}
          </div>
        ) : null}
        <ModelTestToolCallList calls={message.tool_calls ?? []} />
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
          ) : message.status === "pending" ? (
            <div className="typing-indicator" aria-label="正在生成">
              <i />
              <i />
              <i />
            </div>
          ) : null
        ) : content ? (
          <p className="user-copy">{content}</p>
        ) : null}
        {replyStatus ? (
          <div className="reply-status-row" role="status" aria-live="polite">
            <span className={`reply-status-pill ${replyStatus.tone}`}>
              {replyStatus.tone === "active" ? (
                <i className="reply-status-dot" aria-hidden />
              ) : null}
              {replyStatus.label}
            </span>
          </div>
        ) : null}
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
              title="复制原始输出"
              onClick={() => void navigator.clipboard.writeText(content)}
            >
              <Copy aria-hidden />
            </button>
            {isLastAssistant && !errorInfo ? (
              <button
                type="button"
                aria-label="重新生成"
                title="重新生成"
                disabled={generating}
                onClick={onRegenerate}
              >
                <RotateCcw aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
