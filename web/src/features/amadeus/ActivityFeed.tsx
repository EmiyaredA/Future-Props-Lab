import { AttachmentReference } from "./AttachmentReference";
import { MessageActionRow } from "./MessageActions";
import { messageAnchors, type MessageActions } from "./useMessageActions";
import { usageFields } from "./conversationUsage";
import { CustomSelect } from "@shared/ui/CustomSelect";
import {
  Brain,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  FileCode,
  Layers,
  LoaderCircle,
  Wrench,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  buildDisplayTimeline,
  type DisplayItem,
  type ToolStep,
} from "./displayTimeline";
import { ArtifactCard, ApprovalCard } from "./RevisionCards";
import { TranscriptMarkdown } from "./TranscriptMarkdown";
import type {
  Detail,
  Reference,
  Run,
  RunDetail,
  SavedQuestion,
} from "./protocol";

function safeJson(value: unknown) {
  return JSON.stringify(
    value,
    (key, item) =>
      /password|token|secret|api.?key|authorization/i.test(key) ? "••••" : item,
    2,
  );
}

function toolLabel(name: string) {
  if (name.startsWith("fpl_operation:"))
    return `更新业务资源 · ${name.slice("fpl_operation:".length)}`;
  const labels: Record<string, string> = {
    fpl_read: "读取应用数据",
    operations: "查找可用操作",
    fpl_operations: "查找可用操作",
    fpl_operation_read: "读取业务信息",
    video_timeline_batch: "调整视频时间线",
    delegate_readonly: "并行调查",
    run_script: "运行脚本",
    write_script: "创建脚本",
    inspect_video_reference: "检查参考视频帧",
  };
  return labels[name] || name;
}

function feedbackTitle(content: string) {
  if (content.startsWith("请根据我修订的计划重新思考"))
    return "你提交了计划修订";
  if (content.startsWith("请根据我修订的草稿重新思考"))
    return "你提交了草稿修订";
  if (content.startsWith("旧提案已撤回。请重新读取目标"))
    return "你修改了写入参数，旧提案已撤回";
  return null;
}

function stepTarget(step: ToolStep) {
  const arguments_ = step.action?.arguments || step.arguments;
  const pathParams = arguments_.path_params;
  const nested =
    pathParams && typeof pathParams === "object" && "project_id" in pathParams
      ? pathParams.project_id
      : undefined;
  return String(
    arguments_.project_id ||
      nested ||
      arguments_.operation ||
      arguments_.path ||
      "",
  );
}

function QuestionCard({
  question,
  onAnswer,
  onContinue,
  canContinue,
  mode,
}: {
  question: SavedQuestion;
  onAnswer: (
    question: SavedQuestion,
    answer: string,
    note: string,
  ) => Promise<void>;
  onContinue: (
    runId: string,
    mode: "agent" | "plan",
    prompt: string,
  ) => Promise<void>;
  canContinue: boolean;
  mode: "agent" | "plan";
}) {
  const [answer, setAnswer] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  if (question.status === "answered")
    return (
      <section className="amadeus-history-receipt" aria-label="Amadeus 提问">
        <details>
          <summary>
            <ChevronRight size={14} aria-hidden />
            <strong>已回答</strong>
            <span title={question.prompt}>{question.prompt}</span>
          </summary>
          <div className="amadeus-history-receipt-body">
            <p>{question.prompt}</p>
            <p>你的回答 · {question.answer?.answer}</p>
            {question.answer?.note && <p>{question.answer.note}</p>}
          </div>
        </details>
        {canContinue && (
          <button
            type="button"
            onClick={() =>
              void onContinue(question.run_id, mode, "根据已经回答的问题继续。")
            }
          >
            继续对话
          </button>
        )}
      </section>
    );
  return (
    <section className="amadeus-interaction-card" aria-label="Amadeus 提问">
      <strong>需要你的回答</strong>
      <p>{question.prompt}</p>
      {question.status === "pending" ? (
        <>
          {!!question.options.length && (
            <div
              className="amadeus-question-options"
              role="group"
              aria-label="可选答案"
            >
              {question.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={answer === option}
                  onClick={() => setAnswer(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          {question.allow_text && (
            <input
              aria-label="回答"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder={
                question.options.length ? "选择选项或输入其他答案" : "输入答案"
              }
            />
          )}
          <input
            aria-label="补充说明"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="补充说明（可选）"
          />
          {error && <small role="alert">{error}</small>}
          <button
            type="button"
            disabled={!answer.trim() || submitting}
            onClick={() => {
              setSubmitting(true);
              void onAnswer(question, answer.trim(), note.trim())
                .catch((cause) => setError(String(cause)))
                .finally(() => setSubmitting(false));
            }}
          >
            提交回答
          </button>
        </>
      ) : (
        <div>提问已结束</div>
      )}
    </section>
  );
}

function toolKey(step: ToolStep) {
  return `${step.runId}:${step.callId}`;
}

function InspectorFrame({
  name,
  title,
  icon,
  closeLabel,
  onClose,
  children,
}: {
  name: string;
  title: string;
  icon: ReactNode;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);
  return (
    <aside
      className="amadeus-execution-inspector"
      aria-label={name}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header>
        <div className="amadeus-detail-tab">
          {icon}
          <h2 title={title}>{title}</h2>
        </div>
        <button
          ref={close}
          type="button"
          aria-label={closeLabel}
          onClick={onClose}
        >
          <X size={16} aria-hidden />
        </button>
      </header>
      {children}
    </aside>
  );
}

export function ExecutionInspector({
  tools,
  selected,
  onSelect,
  onClose,
}: {
  tools: ToolStep[];
  selected: string | null;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const active =
    tools.find((step) => toolKey(step) === selected) || tools.at(-1);
  if (!active) return null;
  const target = stepTarget(active);
  const result = active.action?.result ?? active.result;
  const label = toolLabel(active.action?.tool_name || active.name);
  return (
    <InspectorFrame
      name="执行详情"
      title={label}
      icon={<Wrench size={15} aria-hidden />}
      closeLabel="收起执行详情"
      onClose={onClose}
    >
      <div className="amadeus-detail-toolbar">
        <CustomSelect
          ariaLabel="查看其他工具调用"
          className="amadeus-detail-tool-picker"
          value={toolKey(active)}
          onChange={onSelect}
          options={tools.map((step, index) => {
            const name = toolLabel(step.action?.tool_name || step.name);
            const target = stepTarget(step);
            return {
              value: toolKey(step),
              label: `${index + 1} · ${name}${target ? ` · ${target}` : ""}`,
            };
          })}
        />
        <span>
          {toolStatusLabel[active.displayStatus] || active.displayStatus}
        </span>
      </div>
      <div className="amadeus-inspector-scroll">
        {target && <p className="amadeus-detail-target">{target}</p>}
        {active.children.length > 0 && (
          <ul className="amadeus-detail-children">
            {active.children.map((child) => (
              <li key={child.id}>
                {child.task} ·{" "}
                {child.status === "done"
                  ? "完成"
                  : child.status === "failed"
                    ? "失败"
                    : "进行中"}
              </li>
            ))}
          </ul>
        )}
        <section aria-label="工具回执">
          <h3>回执</h3>
          {result === undefined ? (
            <p>暂无回执</p>
          ) : (
            <pre>{safeJson(result)}</pre>
          )}
        </section>
        <details>
          <summary>调用参数</summary>
          <pre>{safeJson(active.action?.arguments || active.arguments)}</pre>
        </details>
      </div>
    </InspectorFrame>
  );
}

// The FPL work file is read through the existing account-scoped preview API.
export function FileInspector({
  file,
  onClose,
}: {
  file: { name: string; text: string };
  onClose: () => void;
}) {
  const lineNumbers = useMemo(() => {
    const lineCount = file.text.split("\n").length;
    return lineCount <= 10_000
      ? Array.from({ length: lineCount }, (_, index) => index + 1).join("\n")
      : "";
  }, [file.text]);
  return (
    <InspectorFrame
      name="文件预览"
      title={file.name}
      icon={<FileCode size={15} aria-hidden />}
      closeLabel="关闭文件预览"
      onClose={onClose}
    >
      <div
        className="amadeus-detail-file"
        tabIndex={0}
        role="region"
        aria-label={file.name}
      >
        {lineNumbers && <pre aria-hidden="true">{lineNumbers}</pre>}
        <pre>{file.text}</pre>
      </div>
    </InspectorFrame>
  );
}

function readDisclosure(key?: string) {
  try {
    return (
      !!key &&
      (localStorage.getItem(key) ?? sessionStorage.getItem(key)) === "open"
    );
  } catch {
    return false;
  }
}

function saveDisclosure(key: string | undefined, open: boolean) {
  if (!key) return;
  try {
    localStorage.setItem(key, open ? "open" : "closed");
  } catch {
    // The disclosure also works without browser storage.
  }
}

// Adapted from Happier a2c45c86804b ToolCallsGroupView (MIT).
const collapsedToolPreviewCount = 3;

function ToolActivity({
  item,
  storageKey,
  selected,
  inspect,
}: {
  item: Extract<DisplayItem, { kind: "milestone" }>;
  storageKey?: string;
  selected?: string | null;
  inspect?: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(() => readDisclosure(storageKey));
  const contentId = useId();
  const header = useRef<HTMLButtonElement>(null);
  const setOpen = (next: boolean) => {
    setExpanded(next);
    saveDisclosure(storageKey, next);
  };
  const visibleSteps = expanded
    ? item.steps
    : item.steps.slice(-collapsedToolPreviewCount);
  const hiddenCount = item.count - visibleSteps.length;
  const statusLabel =
    item.status === "failed"
      ? "部分步骤失败"
      : item.status === "running"
        ? "进行中"
        : "已完成";
  const StatusIcon =
    item.status === "failed"
      ? CircleAlert
      : item.status === "running"
        ? LoaderCircle
        : CircleCheck;
  return (
    <section className="amadeus-tool-activity">
      <button
        type="button"
        aria-label={`工具调用 · ${item.count} · ${statusLabel}`}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setOpen(!expanded)}
        ref={header}
        className="amadeus-tool-group-header"
      >
        <Layers size={16} aria-hidden />
        <span>工具调用 · {item.count}</span>
        <StatusIcon
          size={15}
          aria-hidden
          className="amadeus-tool-group-status"
          data-status={item.status}
        />
        <ChevronRight
          size={15}
          aria-hidden
          className="amadeus-tool-group-chevron"
        />
      </button>
      <div id={contentId} className="amadeus-tool-group-body">
        {hiddenCount > 0 && (
          <button
            type="button"
            className="amadeus-tool-group-more"
            onClick={() => {
              setOpen(true);
              header.current?.focus();
            }}
          >
            +{hiddenCount} 更多…
          </button>
        )}
        <ul>
          {visibleSteps.map((step) => {
            const key = toolKey(step);
            const label = toolLabel(step.action?.tool_name || step.name);
            const target = stepTarget(step);
            const status =
              toolStatusLabel[step.displayStatus] || step.displayStatus;
            const content = (
              <>
                <Wrench size={14} aria-hidden />
                <span className="amadeus-tool-row-name">{label}</span>
                {target && (
                  <span className="amadeus-tool-row-target" title={target}>
                    {target}
                  </span>
                )}
                {step.displayStatus === "running" && (
                  <LoaderCircle size={12} aria-hidden />
                )}
              </>
            );
            return (
              <li key={key}>
                {inspect ? (
                  <button
                    type="button"
                    className="amadeus-tool-row"
                    aria-label={`${label}${target ? ` · ${target}` : ""} · ${status}`}
                    aria-pressed={selected === key}
                    onClick={() => inspect(key)}
                  >
                    {content}
                  </button>
                ) : (
                  <span className="amadeus-tool-row">{content}</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

const toolStatusLabel: Record<string, string> = {
  running: "进行中",
  completed: "完成",
  failed: "失败",
  cancelled: "取消",
  interrupted: "中断",
  unknown: "待核实",
  pending: "待批准",
  approved: "已批准",
  rejected: "已拒绝",
};

const runStatusLabel: Record<string, string> = {
  completed: "本轮已完成",
  failed: "运行失败",
  cancelled: "运行已取消",
  interrupted: "运行已中断",
  waiting_approval: "等待审批",
  waiting_question: "等待回答",
  running: "运行中",
  cancelling: "正在取消",
};

function RunSummary({ run, label }: { run: Run; label?: string }) {
  const format = (value: number) => value.toLocaleString("zh-CN");
  const usage = run.usage;
  const tokens = usageFields.flatMap(([key, label]) => {
    const value = usage?.[key];
    return value == null ? [] : [`${label} ${format(value)}`];
  });
  const { context_used: used, context_limit: limit } = usage || {};
  const context =
    used != null
      ? `上下文 ${format(used)}${limit != null ? ` / ${format(limit)}` : ""} Tokens`
      : limit != null
        ? `上下文上限 ${format(limit)} Tokens`
        : null;
  const isFailure = ["failed", "cancelled", "interrupted"].includes(run.status);
  const settings = [
    run.agent_model,
    run.reasoning_effort && `推理 ${run.reasoning_effort}`,
    run.model_variant && `变体 ${run.model_variant}`,
    run.harness_effort && `推理 ${run.harness_effort}`,
    run.service_tier === "fast" && "快档",
  ].filter(Boolean);
  return (
    <div className="amadeus-run-summary" aria-label="本轮状态与用量">
      <div
        className={isFailure ? "amadeus-run-status" : undefined}
        role={isFailure ? "status" : undefined}
      >
        {label || runStatusLabel[run.status] || run.status}
        {run.error_message && ` · ${run.error_message}`}
      </div>
      {!!settings.length && <span>{settings.join(" · ")}</span>}
      {!!tokens.length && <span>Token · {tokens.join(" · ")}</span>}
      {context && <span>{context}</span>}
      {!tokens.length && !context && <span>用量未记录</span>}
    </div>
  );
}

// Adapted from Happier a2c45c86804b ThinkingTimelineRow (MIT).
function ReasoningRow({
  text,
  storageKey,
}: {
  text: string;
  storageKey?: string;
}) {
  const [open, setOpen] = useState(() => readDisclosure(storageKey));
  const preview = text.trim().split(/\r?\n/, 1)[0];
  return (
    <details
      className="amadeus-reasoning-summary"
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        setOpen(next);
        saveDisclosure(storageKey, next);
      }}
    >
      <summary>
        <Brain size={14} aria-hidden="true" />
        <strong>思考</strong>
        {!open && <span aria-hidden="true">{preview}</span>}
        <ChevronRight size={14} aria-hidden="true" />
      </summary>
      <div className="amadeus-reasoning-content">
        <TranscriptMarkdown text={text} streaming={false} />
      </div>
    </details>
  );
}

const messageTime = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});
const compactMessageTime = new Intl.DateTimeFormat("zh-CN", {
  timeStyle: "short",
});

export function ActivityFeed({
  detail,
  owner,
  runs,
  onReference,
  onApproval,
  onAnswer,
  onContinue,
  onReviseArtifact = async () => undefined,
  onReviseApproval = async () => undefined,
  onInspect,
  selectedTool,
  display,
  messageActions,
}: {
  detail: Detail;
  owner?: string;
  runs: RunDetail[];
  onReference: (reference: Reference) => void;
  onApproval: (actionId: string, allow: boolean) => Promise<void>;
  onAnswer: (
    question: SavedQuestion,
    answer: string,
    note: string,
  ) => Promise<void>;
  onContinue: (
    runId: string,
    mode: "agent" | "plan",
    prompt: string,
  ) => Promise<void>;
  onReviseArtifact?: (
    runId: string,
    kind: "plan" | "draft",
    content: string,
    note: string,
  ) => Promise<void>;
  onReviseApproval?: (
    actionId: string,
    arguments_: Record<string, unknown>,
    note: string,
  ) => Promise<void>;
  onInspect?: (key: string) => void;
  selectedTool?: string | null;
  display?: ReturnType<typeof buildDisplayTimeline>;
  messageActions?: MessageActions;
}) {
  const { entries } = display || buildDisplayTimeline(detail, runs);
  const anchors = messageActions && messageAnchors(detail.messages, entries);
  const runById = new Map(runs.map((item) => [item.run.id, item.run]));
  const continued = new Set(
    runs.map((item) => item.run.source_run_id).filter(Boolean),
  );
  const latestArtifacts = new Map<string, string>();
  for (const item of entries)
    if (item.kind === "artifact")
      latestArtifacts.set(
        `${item.artifact.runId}:${item.artifact.kind}`,
        item.artifact.callId,
      );
  const artifactRuns = new Set(
    entries
      .filter((item) => item.kind === "artifact")
      .map((item) => item.artifact.runId),
  );
  return (
    <>
      {entries.map((item) => {
        if (item.kind === "run_error")
          return (
            <div
              className="amadeus-run-status"
              key={`error:${item.id}`}
              role="status"
            >
              {item.text}
            </div>
          );
        if (item.kind === "run_summary") {
          const { run } = item;
          let label: string | undefined;
          if (run.status === "waiting_approval") {
            const actions = detail.actions.filter(
              (action) => action.run_id === run.id,
            );
            if (
              actions.length &&
              actions.every((action) =>
                ["completed", "failed", "rejected", "cancelled"].includes(
                  action.status,
                ),
              )
            )
              label = "审批已处理";
          } else if (
            run.status === "waiting_question" &&
            detail.questions?.some(
              (question) =>
                question.run_id === run.id && question.status === "answered",
            )
          )
            label = "提问已回答";
          return (
            <RunSummary key={`summary:${run.id}`} run={run} label={label} />
          );
        }
        if (item.kind === "message") {
          const message = item.message;
          const actionAnchor = anchors?.get(message.id);
          const feedback =
            message.role === "user" ? feedbackTitle(message.content) : null;
          const run = message.run_id ? runById.get(message.run_id) : undefined;
          const streaming = item.streaming ?? message.id.startsWith("stream:");
          const responseKey =
            run &&
            message.role === "assistant" &&
            !message.id.startsWith("event:") &&
            !message.id.startsWith("chunk:") &&
            (streaming || run.partial_text === message.content)
              ? `reply:${run.id}`
              : `message:${message.id}`;
          const legacyPlan =
            run?.mode === "plan" &&
            run.status === "completed" &&
            !artifactRuns.has(run.id) &&
            (!message.id.startsWith("chunk:") ||
              run.partial_text === message.content);
          return (
            <article
              key={responseKey}
              className={`amadeus-message ${message.role}`}
              aria-label={message.role === "user" ? "你的消息" : "Amadeus 回复"}
              data-amadeus-message-id={actionAnchor?.id}
              tabIndex={actionAnchor ? -1 : undefined}
            >
              <div className="amadeus-message-content">
                {!!message.references?.length && (
                  <div className="amadeus-message-refs">
                    {message.references.map((reference, index) => (
                      <AttachmentReference
                        key={`${reference.id}-${index}`}
                        reference={reference}
                        conversationId={detail.conversation.id}
                        onOpen={onReference}
                      />
                    ))}
                  </div>
                )}
                {feedback ? (
                  <details className="amadeus-feedback-message">
                    <summary>{feedback} · 查看意见</summary>
                    <pre>{message.content}</pre>
                  </details>
                ) : legacyPlan ? (
                  <ArtifactCard
                    artifact={{
                      kind: "plan",
                      title: "执行计划",
                      body: message.content,
                      steps: [],
                      runId: run.id,
                      callId: message.id,
                    }}
                    current={!continued.has(run.id)}
                    onRevise={onReviseArtifact}
                    onExecute={(id) =>
                      onContinue(
                        id,
                        "agent",
                        "按照上一份计划执行。先重新读取当前项目状态和版本；修改前等待用户审批。",
                      )
                    }
                  />
                ) : (
                  <TranscriptMarkdown
                    text={message.content}
                    streaming={streaming}
                  />
                )}
              </div>
              {message.role === "user" &&
                Number.isFinite(Date.parse(message.created_at)) && (
                  <time
                    dateTime={message.created_at}
                    title={messageTime.format(new Date(message.created_at))}
                  >
                    {compactMessageTime.format(new Date(message.created_at))}
                  </time>
                )}
              {actionAnchor && messageActions && (
                <MessageActionRow
                  message={actionAnchor}
                  actions={messageActions}
                />
              )}
            </article>
          );
        }
        if (item.kind === "reasoning") {
          const key = `reasoning:${item.runId}:${item.sequence}`;
          return (
            <ReasoningRow
              key={key}
              text={item.text}
              storageKey={
                owner && `amadeus:${owner}:${detail.conversation.id}:${key}`
              }
            />
          );
        }
        if (item.kind === "question")
          return (
            <QuestionCard
              key={`question:${item.question.id}`}
              question={item.question}
              onAnswer={onAnswer}
              onContinue={onContinue}
              canContinue={
                item.question.status === "answered" &&
                !continued.has(item.question.run_id)
              }
              mode={runById.get(item.question.run_id)?.mode || "agent"}
            />
          );
        if (item.kind === "artifact")
          return (
            <ArtifactCard
              key={`artifact:${item.artifact.runId}:${item.artifact.callId}`}
              artifact={item.artifact}
              current={
                !continued.has(item.artifact.runId) &&
                latestArtifacts.get(
                  `${item.artifact.runId}:${item.artifact.kind}`,
                ) === item.artifact.callId &&
                runById.get(item.artifact.runId)?.status === "completed"
              }
              onRevise={onReviseArtifact}
              onExecute={(id) =>
                onContinue(
                  id,
                  "agent",
                  "按照上一份计划执行。先重新读取当前项目状态和版本；修改前等待用户审批。",
                )
              }
            />
          );
        if (item.kind === "milestone") {
          const key = `milestone:${item.runId}:${item.steps[0].callId}`;
          return (
            <ToolActivity
              key={key}
              item={item}
              storageKey={
                owner && `amadeus:${owner}:${detail.conversation.id}:${key}`
              }
              inspect={onInspect}
              selected={selectedTool}
            />
          );
        }
        const tool = item.tool;
        const status = tool.displayStatus;
        const canContinue =
          !!tool.action?.run_id &&
          ["completed", "failed", "rejected", "cancelled"].includes(status) &&
          !continued.has(tool.runId);
        return (
          <ApprovalCard
            key={`action:${tool.runId}:${tool.callId}`}
            tool={tool}
            onApproval={onApproval}
            onRevise={onReviseApproval}
            onContinue={onContinue}
            canContinue={canContinue}
          />
        );
      })}
    </>
  );
}
