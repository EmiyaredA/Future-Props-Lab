import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { buildDisplayTimeline, type ToolStep } from "./displayTimeline";
import { ArtifactCard, ApprovalCard } from "./RevisionCards";
import type { Detail, Reference, RunDetail, SavedQuestion } from "./protocol";

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
        <div>
          已回答：{question.answer?.answer}
          {canContinue && (
            <button
              type="button"
              onClick={() =>
                void onContinue(
                  question.run_id,
                  mode,
                  "根据已经回答的问题继续。",
                )
              }
            >
              继续对话
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function ExecutionInspector({
  tools,
  runs,
  selected,
  onSelect,
  onClose,
}: {
  tools: ToolStep[];
  runs: RunDetail[];
  selected: string | null;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const groups = runs
    .map((run) => ({
      run: run.run,
      steps: tools.filter((step) => step.runId === run.run.id),
    }))
    .filter((group) => group.steps.length);
  const legacy = tools.filter(
    (step) => !runs.some((run) => run.run.id === step.runId),
  );
  if (legacy.length)
    groups.push({
      run: {
        id: "legacy",
        mode: "agent",
        status: "completed",
      } as RunDetail["run"],
      steps: legacy,
    });
  const active =
    tools.find((step) => `${step.runId}:${step.callId}` === selected) ||
    tools.at(-1);
  return (
    <aside className="amadeus-execution-inspector" aria-label="执行详情">
      <header>
        <div>
          <small>RUN TRACE</small>
          <h2>执行详情</h2>
        </div>
        <button type="button" aria-label="收起执行详情" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="amadeus-inspector-scroll">
        <div className="amadeus-inspector-stats">
          <div>
            <b>{tools.length}</b>
            <span>工具调用</span>
          </div>
          <div>
            <b>
              {
                tools.filter(
                  (tool) =>
                    tool.displayStatus === "failed" ||
                    tool.displayStatus === "unknown" ||
                    tool.displayStatus === "interrupted" ||
                    tool.displayStatus === "pending" ||
                    tool.displayStatus === "approved",
                ).length
              }
            </b>
            <span>待处理／异常</span>
          </div>
        </div>
        {groups.map((group, index) => (
          <section className="amadeus-inspector-run" key={group.run.id}>
            <h3>
              {index + 1} ·{" "}
              {group.run.mode === "plan" ? "制定计划" : "Agent 运行"}{" "}
              <small>
                {group.run.status === "completed"
                  ? "已完成"
                  : group.run.status === "running"
                    ? "进行中"
                    : group.run.status === "waiting_approval"
                      ? "等待批准"
                      : group.run.status === "waiting_question"
                        ? "等待回答"
                        : group.run.status === "interrupted"
                          ? "已中断"
                          : group.run.status}
              </small>
            </h3>
            {group.steps.map((step) => {
              const key = `${step.runId}:${step.callId}`;
              return (
                <button
                  type="button"
                  key={key}
                  aria-pressed={key === `${active?.runId}:${active?.callId}`}
                  onClick={() => onSelect(key)}
                >
                  <span>{toolLabel(step.action?.tool_name || step.name)}</span>
                  <small
                    className={
                      step.displayStatus === "failed" ||
                      step.displayStatus === "unknown" ||
                      step.displayStatus === "interrupted"
                        ? "is-risk"
                        : ""
                    }
                  >
                    {step.displayStatus === "completed"
                      ? "✓"
                      : step.displayStatus === "failed"
                        ? "失败"
                        : step.displayStatus === "unknown"
                          ? "待核实"
                          : step.displayStatus === "pending"
                            ? "待批准"
                            : step.displayStatus === "rejected"
                              ? "已撤回"
                              : step.displayStatus === "interrupted"
                                ? "已中断"
                                : step.displayStatus === "cancelled"
                                  ? "已取消"
                                  : "⋯"}
                  </small>
                </button>
              );
            })}
          </section>
        ))}
        {active && (
          <section className="amadeus-inspector-detail">
            <h3>{toolLabel(active.action?.tool_name || active.name)}</h3>
            <div className="amadeus-inspector-facts">
              <span>状态</span>
              <strong>
                {active.displayStatus === "completed"
                  ? "已完成"
                  : active.displayStatus === "pending"
                    ? "待批准"
                    : active.displayStatus === "unknown"
                      ? "结果待核实"
                      : active.displayStatus === "failed"
                        ? "失败"
                        : active.displayStatus}
              </strong>
              {stepTarget(active) && (
                <>
                  <span>目标</span>
                  <strong>{stepTarget(active)}</strong>
                </>
              )}
            </div>
            {active.children.length > 0 && (
              <ul>
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
            <details>
              <summary>展开完整参数与回执</summary>
              <pre>
                {safeJson({
                  arguments: active.action?.arguments || active.arguments,
                  result: active.action?.result ?? active.result,
                })}
              </pre>
            </details>
          </section>
        )}
      </div>
    </aside>
  );
}

export function ActivityFeed({
  detail,
  runs,
  onReference,
  onApproval,
  onAnswer,
  onContinue,
  onReviseArtifact = async () => undefined,
  onReviseApproval = async () => undefined,
  onInspect,
  display,
}: {
  detail: Detail;
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
  onInspect?: (runId: string) => void;
  display?: ReturnType<typeof buildDisplayTimeline>;
}) {
  const { entries } = display || buildDisplayTimeline(detail, runs);
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
        if (item.kind === "message") {
          const message = item.message;
          const feedback =
            message.role === "user" ? feedbackTitle(message.content) : null;
          const run = message.run_id ? runById.get(message.run_id) : undefined;
          const legacyPlan =
            run?.mode === "plan" &&
            run.status === "completed" &&
            !artifactRuns.has(run.id);
          return (
            <article
              key={`message:${message.id}`}
              className={`amadeus-message ${message.role}`}
            >
              <div className="amadeus-message-name">
                {message.role === "user"
                  ? "你"
                  : run?.mode === "plan"
                    ? "✦ Amadeus · Plan"
                    : "✦ Amadeus"}
              </div>
              {!!message.references?.length && (
                <div className="amadeus-message-refs">
                  {message.references.map((reference, index) => (
                    <button
                      key={`${reference.id}-${index}`}
                      className="amadeus-ref"
                      onClick={() => onReference(reference)}
                    >
                      <span className="amadeus-ref-thumb">
                        {reference.thumbnail ? (
                          <img src={reference.thumbnail} alt="" />
                        ) : (
                          "▧"
                        )}
                      </span>
                      <span>
                        <strong>{reference.name}</strong>
                        <small>
                          {reference.application}
                          {reference.value ? ` · ${reference.value}` : ""}
                        </small>
                      </span>
                    </button>
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
                <ReactMarkdown>{message.content}</ReactMarkdown>
              )}
            </article>
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
        if (item.kind === "milestone")
          return (
            <button
              type="button"
              key={`milestone:${item.runId}`}
              className={`amadeus-milestone ${item.status === "failed" ? "is-risk" : ""}`}
              onClick={() => onInspect?.(item.runId)}
            >
              <span>
                {item.status === "failed"
                  ? "部分步骤失败"
                  : item.status === "running"
                    ? "正在检查"
                    : "已完成检查"}{" "}
                · {item.count} 次调用
              </span>
              <small>查看执行详情 →</small>
            </button>
          );
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
      {runs
        .filter((item) =>
          ["failed", "cancelled", "interrupted"].includes(item.run.status),
        )
        .map((item) => (
          <div
            key={`run-status:${item.run.id}`}
            className="amadeus-run-status"
            role="status"
          >
            {item.run.status === "failed"
              ? "运行失败"
              : item.run.status === "cancelled"
                ? "运行已取消"
                : "运行已中断"}
            {item.run.error_message ? ` · ${item.run.error_message}` : ""}
          </div>
        ))}
    </>
  );
}
