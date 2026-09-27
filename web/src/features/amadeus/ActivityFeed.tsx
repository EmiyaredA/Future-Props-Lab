import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { conversationTimeline } from "./history";
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
  const labels: Record<string, string> = {
    fpl_read: "读取应用数据",
    fpl_operations: "查找可用操作",
    fpl_operation_read: "读取业务信息",
    video_timeline_batch: "调整视频时间线",
    delegate_readonly: "并行调查",
    run_script: "运行脚本",
    write_script: "创建脚本",
  };
  return labels[name] || name;
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

export function ActivityFeed({
  detail,
  runs,
  onReference,
  onApproval,
  onAnswer,
  onContinue,
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
}) {
  const timeline = conversationTimeline(
    detail.messages,
    runs,
    detail.actions || [],
    detail.questions || [],
  );
  const runById = new Map(runs.map((item) => [item.run.id, item.run]));
  const continued = new Set(
    runs.map((item) => item.run.source_run_id).filter(Boolean),
  );
  return (
    <>
      {timeline.map((item) => {
        if (item.kind === "message") {
          const message = item.message;
          const run = message.run_id ? runById.get(message.run_id) : undefined;
          const showPlanAction =
            run?.mode === "plan" &&
            run.status === "completed" &&
            !continued.has(run.id);
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
              <ReactMarkdown>{message.content}</ReactMarkdown>
              {showPlanAction && (
                <button
                  className="amadeus-inline-action"
                  onClick={() =>
                    void onContinue(
                      run.id,
                      "agent",
                      "按照上一份计划执行。先重新读取当前项目状态和版本；修改前等待用户审批。",
                    )
                  }
                >
                  执行计划
                </button>
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
        const action = item.action;
        const status =
          action?.status ||
          (item.result === undefined ? "running" : "completed");
        const canContinue =
          action &&
          action.run_id &&
          ["completed", "failed", "rejected", "cancelled"].includes(status) &&
          !continued.has(item.runId);
        const target = String(
          item.arguments.project_id ||
            item.arguments.operation ||
            item.arguments.path ||
            "",
        );
        return (
          <div
            className="amadeus-tool-card"
            key={`tool:${item.runId}:${item.callId}`}
          >
            <details>
              <summary>
                <span>
                  {toolLabel(item.name)}
                  {target ? ` · ${target}` : ""}
                </span>
                <small>
                  {status === "completed"
                    ? "已完成"
                    : status === "failed"
                      ? "失败"
                      : status === "unknown"
                        ? "结果待核实"
                        : status === "rejected"
                          ? "已拒绝"
                          : status === "running"
                            ? "进行中"
                            : "待确认"}
                </small>
              </summary>
              {!!item.children.length && (
                <ul>
                  {item.children.map((child) => (
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
              <pre>
                {safeJson({
                  arguments: item.arguments,
                  result: action?.result ?? item.result,
                })}
              </pre>
            </details>
            {action?.run_id &&
              ["pending", "approved"].includes(action.status) && (
                <div className="amadeus-card-actions">
                  {action.status === "pending" && (
                    <button onClick={() => void onApproval(action.id, false)}>
                      拒绝
                    </button>
                  )}
                  <button onClick={() => void onApproval(action.id, true)}>
                    {action.status === "approved"
                      ? "执行已批准操作"
                      : "批准并执行"}
                  </button>
                </div>
              )}
            {canContinue && (
              <button
                className="amadeus-inline-action"
                onClick={() =>
                  void onContinue(
                    item.runId,
                    "agent",
                    "根据已保存的工具结果继续。先核对当前项目状态。",
                  )
                }
              >
                继续对话
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}
