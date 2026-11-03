import { LoadingScene } from "@shared/ui/LoadingScene";
import {
  isValidElement,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  RefreshCw,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  VisualAssistantAction,
  VisualAssistantMessage,
} from "@features/visual-workshop/api";
import { AssistantAssetPreview } from "@features/visual-workshop/assistant/AssistantComposer";

export type PendingApproval = {
  runId: string;
  approvalId: string;
  canvasRevision: number;
};

const TOOL_LABELS: Record<string, string> = {
  read_canvas: "读取画布",
  list_project_assets: "查找项目素材",
  list_generation_options: "读取生成选项",
  inspect_generation_task: "检查生成任务",
  apply_canvas_changes: "更新画布",
  start_generation_on_canvas: "创建生成任务与占位节点",
};

const ACTION_STATUS_LABELS: Record<VisualAssistantAction["status"], string> = {
  proposed: "已规划",
  waiting_approval: "等待确认",
  running: "执行中",
  completed: "已完成",
  rejected: "已拒绝",
  failed: "失败",
  cancelled: "已取消",
};

function compactPayload(value: Record<string, unknown>) {
  const text = JSON.stringify(value, null, 2);
  return text.length > 2400 ? `${text.slice(0, 2400)}\n…` : text;
}

function AssistantActions({
  actions,
  pendingApproval,
  approvalBusy,
  onResolve,
}: {
  actions: VisualAssistantAction[];
  pendingApproval?: PendingApproval;
  approvalBusy: boolean;
  onResolve: (decision: "approve" | "reject") => void;
}) {
  if (!actions.length) return null;
  const waiting = pendingApproval
    ? actions.some(
        (action) =>
          action.approval_group_id === pendingApproval.approvalId &&
          action.status === "waiting_approval",
      )
    : false;
  const completed = actions.filter(
    (action) => action.status === "completed",
  ).length;
  return (
    <section className="project-assistant-steps" aria-label="Agent 执行步骤">
      <header>
        <span>
          <Wrench aria-hidden />
          <strong>执行步骤</strong>
        </span>
        <small>
          {completed}/{actions.length}
        </small>
      </header>
      <div>
        {actions.map((action) => {
          const hasDetails =
            Object.keys(action.display_payload).length > 0 ||
            Object.keys(action.result_payload).length > 0 ||
            Boolean(action.error_message);
          return (
            <details
              key={action.id || action.action_id}
              className={`status-${action.status}`}
            >
              <summary>
                <span className="project-assistant-step-mark">
                  {action.status === "completed" ? (
                    <Check aria-hidden />
                  ) : action.status === "running" ? (
                    <LoadingScene />
                  ) : action.status === "failed" ||
                    action.status === "rejected" ||
                    action.status === "cancelled" ? (
                    <X aria-hidden />
                  ) : (
                    <Wrench aria-hidden />
                  )}
                </span>
                <span>
                  <strong>
                    {TOOL_LABELS[action.tool_name] || action.tool_name}
                  </strong>
                  <small>{ACTION_STATUS_LABELS[action.status]}</small>
                </span>
                {hasDetails ? <ChevronDown aria-hidden /> : null}
              </summary>
              {hasDetails ? (
                <div className="project-assistant-step-detail">
                  {Object.keys(action.display_payload).length ? (
                    <>
                      <b>计划</b>
                      <pre>{compactPayload(action.display_payload)}</pre>
                    </>
                  ) : null}
                  {Object.keys(action.result_payload).length ? (
                    <>
                      <b>结果</b>
                      <pre>{compactPayload(action.result_payload)}</pre>
                    </>
                  ) : null}
                  {action.error_message ? <p>{action.error_message}</p> : null}
                </div>
              ) : null}
            </details>
          );
        })}
      </div>
      {waiting && pendingApproval ? (
        <footer className="project-assistant-approval">
          <p>
            Agent 已准备好上述操作。确认后会以画布 revision{" "}
            {pendingApproval.canvasRevision}{" "}
            执行；若画布已变化，将安全停止并重新规划。
          </p>
          <div>
            <button
              type="button"
              disabled={approvalBusy}
              onClick={() => onResolve("reject")}
            >
              拒绝
            </button>
            <button
              type="button"
              className="primary"
              disabled={approvalBusy}
              onClick={() => onResolve("approve")}
            >
              {approvalBusy ? <LoadingScene /> : <Check aria-hidden />}
              确认执行
            </button>
          </div>
        </footer>
      ) : null}
    </section>
  );
}

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<{ children?: ReactNode }>(node))
    return extractText(node.props.children);
  return "";
}

function AssistantCodeBlock({ children }: ComponentPropsWithoutRef<"pre">) {
  const source = extractText(children).replace(/\n$/, "");
  return (
    <div className="assistant-code-block">
      <button
        type="button"
        aria-label="复制代码"
        onClick={() => void navigator.clipboard.writeText(source)}
      >
        <Copy aria-hidden />
      </button>
      <pre>{children}</pre>
    </div>
  );
}

function InlineMessageContent({
  message,
}: {
  message: VisualAssistantMessage;
}) {
  const assets = new Map(
    (message.assets ?? []).map((asset) => [asset.id, asset]),
  );
  return (
    <p className="project-assistant-inline-content">
      {message.content_parts?.map((part, index) => {
        if (part.type === "text")
          return <span key={`text-${index}`}>{part.text}</span>;
        const asset = assets.get(part.asset_id);
        return asset ? (
          <span
            key={`asset-${index}`}
            className="project-assistant-inline-asset"
            title={asset.display_name}
          >
            <span className="project-assistant-inline-asset-preview">
              <AssistantAssetPreview asset={asset} />
            </span>
            <span>{asset.display_name}</span>
          </span>
        ) : null;
      })}
    </p>
  );
}

export function AssistantMessageView({
  message,
  content,
  streaming,
  actions,
  pendingApproval,
  approvalBusy,
  onResolveApproval,
  onRetry,
}: {
  message: VisualAssistantMessage;
  content: string;
  streaming: boolean;
  actions: VisualAssistantAction[];
  pendingApproval?: PendingApproval;
  approvalBusy: boolean;
  onResolveApproval: (decision: "approve" | "reject") => void;
  onRetry: () => void;
}) {
  return (
    <article
      className={`project-assistant-message ${message.role} ${message.status}`}
    >
      <span className="project-assistant-avatar">
        {message.role === "user" ? (
          <UserRound aria-hidden />
        ) : (
          <Bot aria-hidden />
        )}
      </span>
      <div>
        <header>
          <strong>{message.role === "user" ? "你" : "创作助手"}</strong>
          {message.model_slug ? <small>{message.model_slug}</small> : null}
        </header>
        {message.assets?.length && !message.content_parts?.length ? (
          <div className="project-assistant-message-assets">
            {message.assets.map((asset) => (
              <span key={asset.id} title={asset.display_name}>
                <AssistantAssetPreview asset={asset} />
              </span>
            ))}
          </div>
        ) : null}
        {message.role === "assistant" ? (
          content ? (
            <div className="project-assistant-markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{ pre: AssistantCodeBlock }}
              >
                {content}
              </ReactMarkdown>
              {streaming ? (
                <i className="project-assistant-stream-caret" />
              ) : null}
            </div>
          ) : streaming ? (
            <span className="project-assistant-typing" aria-label="正在回复">
              <i />
              <i />
              <i />
            </span>
          ) : null
        ) : message.content_parts?.length ? (
          <InlineMessageContent message={message} />
        ) : content ? (
          <p>{content}</p>
        ) : null}
        {message.role === "assistant" ? (
          <AssistantActions
            actions={actions}
            pendingApproval={pendingApproval}
            approvalBusy={approvalBusy}
            onResolve={onResolveApproval}
          />
        ) : null}
        {message.status === "error" ? (
          <div className="project-assistant-error-card" role="alert">
            <span>{message.error_message || "生成失败，请稍后重试"}</span>
            <button type="button" onClick={onRetry}>
              <RefreshCw aria-hidden /> 重试
            </button>
          </div>
        ) : null}
        {message.role === "assistant" && content && !streaming ? (
          <button
            type="button"
            className="project-assistant-copy"
            aria-label="复制回复"
            onClick={() => void navigator.clipboard.writeText(content)}
          >
            <Copy aria-hidden />
          </button>
        ) : null}
      </div>
    </article>
  );
}
