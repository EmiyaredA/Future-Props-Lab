import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ArtifactStep, ToolStep } from "./displayTimeline";

const sensitiveKey = /password|token|secret|api.?key|authorization/i;

function safeJson(value: unknown) {
  return JSON.stringify(
    value,
    (key, item) => (sensitiveKey.test(key) ? "••••" : item),
    2,
  );
}

function restoreMasked(value: unknown, original: unknown): unknown {
  if (Array.isArray(value))
    return value.map((item, index) =>
      restoreMasked(
        item,
        Array.isArray(original) ? original[index] : undefined,
      ),
    );
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        item === "••••" && sensitiveKey.test(key)
          ? (original as Record<string, unknown> | undefined)?.[key]
          : restoreMasked(
              item,
              (original as Record<string, unknown> | undefined)?.[key],
            ),
      ]),
    );
  return value;
}

function proposedChanges(arguments_: Record<string, unknown>): string[] {
  let body: unknown = arguments_.body || arguments_;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return ["提交文本内容"];
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const document = body as Record<string, unknown>;
  if (Array.isArray(document.operations))
    return document.operations.slice(0, 3).map((item) => {
      if (!item || typeof item !== "object") return "更新一项内容";
      const operation = item as Record<string, unknown>;
      const value = operation.value;
      const title =
        value && typeof value === "object" && "title" in value
          ? String(value.title)
          : String(operation.id || operation.entity || "资源");
      const verb =
        operation.action === "insert"
          ? "新增"
          : operation.action === "delete"
            ? "删除"
            : "更新";
      return `${verb}${String(operation.entity || "内容")} · ${title.slice(0, 56)}`;
    });
  return Object.entries(document)
    .filter(
      ([key]) =>
        !sensitiveKey.test(key) &&
        !/^(expected_revision|revision|request_id)$/.test(key),
    )
    .slice(0, 3)
    .map(([key, value]) => {
      const label =
        key === "prompt"
          ? "提示词"
          : key === "content"
            ? "内容"
            : key === "title"
              ? "标题"
              : key;
      const detail =
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
          ? String(value).slice(0, 100)
          : Array.isArray(value)
            ? `${value.length} 项`
            : "结构化内容";
      return `${label} · ${detail}`;
    });
}

export function ArtifactCard({
  artifact,
  current,
  onRevise,
  onExecute,
}: {
  artifact: ArtifactStep;
  current: boolean;
  onRevise: (
    runId: string,
    kind: "plan" | "draft",
    content: string,
    note: string,
  ) => Promise<void>;
  onExecute: (runId: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(
    artifact.kind === "plan"
      ? `${artifact.body}\n\n${artifact.steps.map((step, index) => `${index + 1}. ${step.title}\n${step.detail}`).join("\n\n")}`
      : artifact.body,
  );
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const renderedContent = (
    <div className="amadeus-artifact-content">
      <ReactMarkdown>{artifact.body}</ReactMarkdown>
      {artifact.kind === "plan" && (
        <ol className="amadeus-plan-steps">
          {artifact.steps.map((step, index) => (
            <li key={`${index}:${step.title}`}>
              <span>{index + 1}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
  return (
    <section
      className="amadeus-artifact-card"
      aria-label={artifact.kind === "plan" ? "执行计划" : "内容草稿"}
    >
      <header>
        <span className="amadeus-card-kicker">
          {!current
            ? "历史版本"
            : artifact.kind === "plan"
              ? "PLAN · 尚未执行"
              : "草稿 · 未写入项目"}
        </span>
        <h3>{artifact.title}</h3>
      </header>
      {current ? (
        renderedContent
      ) : (
        <details className="amadeus-old-artifact">
          <summary>已有后续版本 · 查看旧内容</summary>
          {renderedContent}
        </details>
      )}
      {current && !editing && (
        <div className="amadeus-card-controls">
          <button type="button" onClick={() => setEditing(true)}>
            编辑或补充说明
          </button>
          {artifact.kind === "plan" && (
            <button
              type="button"
              className="primary"
              onClick={() => void onExecute(artifact.runId)}
            >
              执行计划
            </button>
          )}
        </div>
      )}
      {current && editing && (
        <div className="amadeus-card-editor">
          <label>
            {artifact.kind === "plan" ? "修订计划" : "修订草稿"}
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </label>
          <label>
            给 Amadeus 的补充说明
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="可选"
            />
          </label>
          {error && <small role="alert">{error}</small>}
          <div className="amadeus-card-controls">
            <button
              type="button"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="primary"
              disabled={pending || (!content.trim() && !note.trim())}
              onClick={() => {
                setPending(true);
                void onRevise(
                  artifact.runId,
                  artifact.kind,
                  content.trim(),
                  note.trim(),
                )
                  .catch((cause) => setError(String(cause)))
                  .finally(() => setPending(false));
              }}
            >
              {pending ? "正在修订…" : "请 AI 再修订"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

type JsonPath = Array<string | number>;

function replaceAt(value: unknown, path: JsonPath, next: unknown): unknown {
  if (!path.length) return next;
  const [head, ...rest] = path;
  if (Array.isArray(value)) {
    const copy = [...value];
    copy[Number(head)] = replaceAt(copy[Number(head)], rest, next);
    return copy;
  }
  const copy = { ...(value as Record<string, unknown>) };
  copy[String(head)] = replaceAt(copy[String(head)], rest, next);
  return copy;
}

function ParameterField({
  name,
  value,
  path,
  onChange,
}: {
  name: string;
  value: unknown;
  path: JsonPath;
  onChange: (path: JsonPath, value: unknown) => void;
}) {
  if (Array.isArray(value) || (value !== null && typeof value === "object")) {
    const entries = Array.isArray(value)
      ? value.map((item, index) => [index, item] as const)
      : Object.entries(value as Record<string, unknown>);
    return (
      <details className="amadeus-param-group" open={path.length < 2}>
        <summary>
          {name}{" "}
          <small>
            {Array.isArray(value)
              ? `数组 · ${entries.length}`
              : `对象 · ${entries.length}`}
          </small>
        </summary>
        <div>
          {entries.map(([key, item]) => (
            <ParameterField
              key={String(key)}
              name={String(key)}
              value={item}
              path={[...path, key]}
              onChange={onChange}
            />
          ))}
        </div>
      </details>
    );
  }
  if (sensitiveKey.test(name))
    return (
      <div className="amadeus-param-field">
        <span>
          {name}
          <small>敏感参数</small>
        </span>
        <input aria-label={name} value="••••" disabled />
      </div>
    );
  return (
    <label className="amadeus-param-field">
      <span>
        {name}
        <small>{value === null ? "null" : typeof value}</small>
      </span>
      {typeof value === "boolean" ? (
        <button
          type="button"
          aria-label={`${name}：${value ? "是" : "否"}`}
          aria-pressed={value}
          onClick={() => onChange(path, !value)}
        >
          {value ? "是" : "否"}
        </button>
      ) : typeof value === "string" ? (
        <textarea
          aria-label={name}
          value={value}
          rows={value.length > 90 ? 4 : 1}
          onChange={(event) => onChange(path, event.target.value)}
        />
      ) : (
        <input
          aria-label={name}
          value={value === null ? "null" : String(value)}
          onChange={(event) => {
            if (value === null) {
              try {
                onChange(path, JSON.parse(event.target.value));
              } catch {
                /* raw JSON editor handles arbitrary values */
              }
            } else if (
              event.target.value &&
              Number.isFinite(Number(event.target.value))
            )
              onChange(path, Number(event.target.value));
          }}
        />
      )}
    </label>
  );
}

export function ApprovalCard({
  tool,
  onApproval,
  onRevise,
  onContinue,
  canContinue,
}: {
  tool: ToolStep;
  onApproval: (actionId: string, allow: boolean) => Promise<void>;
  onRevise: (
    actionId: string,
    arguments_: Record<string, unknown>,
    note: string,
  ) => Promise<void>;
  onContinue: (
    runId: string,
    mode: "agent" | "plan",
    prompt: string,
  ) => Promise<void>;
  canContinue: boolean;
}) {
  const action = tool.action;
  const [editing, setEditing] = useState(false);
  const [parameters, setParameters] = useState<Record<string, unknown>>(
    action?.arguments || tool.arguments,
  );
  const [raw, setRaw] = useState(safeJson(action?.arguments || tool.arguments));
  const [rawMode, setRawMode] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const pathParams = parameters.path_params;
  const projectId =
    pathParams && typeof pathParams === "object" && "project_id" in pathParams
      ? pathParams.project_id
      : undefined;
  const operation = action?.tool_name.startsWith("fpl_operation:")
    ? action.tool_name.slice("fpl_operation:".length)
    : parameters.operation;
  const target = String(
    parameters.project_id ||
      projectId ||
      operation ||
      parameters.path ||
      tool.name,
  );
  const title =
    tool.name === "video_timeline_batch"
      ? "调整视频时间线"
      : tool.name === "run_script"
        ? "运行脚本"
        : tool.name === "write_script"
          ? "创建脚本"
          : action?.tool_name.startsWith("fpl_operation:")
            ? `更新业务资源 · ${operation}`
            : tool.name;
  const status = tool.displayStatus;
  const changes = proposedChanges(action?.arguments || tool.arguments);
  return (
    <section
      className={`amadeus-action-card ${status === "failed" || status === "unknown" ? "is-risk" : ""}`}
      aria-label="写入操作"
    >
      <header>
        <span className="amadeus-card-kicker">
          {status === "pending"
            ? "待批准 · 未执行"
            : status === "completed"
              ? "已执行 · 收到回执"
              : status === "unknown"
                ? "结果待核实"
                : status === "rejected"
                  ? "已撤回"
                  : status === "failed"
                    ? "执行失败"
                    : status === "approved"
                      ? "已批准 · 待执行"
                      : status === "cancelled"
                        ? "已取消"
                        : "执行中"}
        </span>
        <h3>
          {title} · {target}
        </h3>
      </header>
      <div className="amadeus-action-summary">
        <span>目标</span>
        <strong>{target}</strong>
        <span>操作</span>
        <strong>{String(operation || title)}</strong>
      </div>
      {!!changes.length && (
        <div className="amadeus-action-changes">
          <strong>拟变更内容</strong>
          <ul>
            {changes.map((change, index) => (
              <li key={index}>{change}</li>
            ))}
          </ul>
        </div>
      )}
      <details className="amadeus-action-details">
        <summary>查看完整参数与回执</summary>
        <pre>
          {safeJson({
            arguments: action?.arguments || tool.arguments,
            result: action?.result || tool.result,
            sha256: action?.arguments_sha256,
          })}
        </pre>
      </details>
      {status === "unknown" && (
        <p className="amadeus-card-muted">
          外部操作可能已经执行。请先核实实际状态；这里不会自动重试。
        </p>
      )}
      {action?.run_id &&
        (status === "pending" || status === "approved") &&
        !editing && (
          <div className="amadeus-card-controls">
            {status === "pending" && (
              <button
                type="button"
                onClick={() => void onApproval(action.id, false)}
              >
                拒绝
              </button>
            )}
            {status === "pending" && (
              <button type="button" onClick={() => setEditing(true)}>
                编辑参数或补充说明
              </button>
            )}
            <button
              type="button"
              className="primary"
              onClick={() => void onApproval(action.id, true)}
            >
              {status === "approved" ? "执行已批准操作" : "批准并执行"}
            </button>
          </div>
        )}
      {editing && action?.status === "pending" && (
        <div className="amadeus-card-editor">
          <div className="amadeus-card-controls">
            <button
              type="button"
              aria-pressed={!rawMode}
              onClick={() => {
                if (rawMode) {
                  try {
                    const parsed: unknown = JSON.parse(raw);
                    if (
                      !parsed ||
                      Array.isArray(parsed) ||
                      typeof parsed !== "object"
                    )
                      throw new Error("参数必须是 JSON 对象");
                    setParameters(
                      restoreMasked(parsed, parameters) as Record<
                        string,
                        unknown
                      >,
                    );
                    setError("");
                  } catch (cause) {
                    setError(
                      cause instanceof Error ? cause.message : String(cause),
                    );
                    return;
                  }
                }
                setRawMode(false);
              }}
            >
              参数字段
            </button>
            <button
              type="button"
              aria-pressed={rawMode}
              onClick={() => {
                setRaw(safeJson(parameters));
                setRawMode(true);
              }}
            >
              完整 JSON
            </button>
          </div>
          {rawMode ? (
            <label>
              完整参数 JSON
              <textarea
                aria-label="完整参数 JSON"
                value={raw}
                rows={12}
                onChange={(event) => setRaw(event.target.value)}
              />
            </label>
          ) : (
            <div className="amadeus-param-tree">
              <ParameterField
                name="参数"
                value={parameters}
                path={[]}
                onChange={(path, value) =>
                  setParameters(
                    replaceAt(parameters, path, value) as Record<
                      string,
                      unknown
                    >,
                  )
                }
              />
            </div>
          )}
          <label>
            给 Amadeus 的补充说明
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="可选"
            />
          </label>
          <p className="amadeus-card-muted">
            提交会撤回旧审批。Agent
            将重新读取目标并生成新提案，当前参数不会直接执行。
          </p>
          {error && <small role="alert">{error}</small>}
          <div className="amadeus-card-controls">
            <button
              type="button"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="primary"
              disabled={pending}
              onClick={() => {
                let next = parameters;
                if (rawMode) {
                  try {
                    const parsed: unknown = JSON.parse(raw);
                    if (
                      !parsed ||
                      Array.isArray(parsed) ||
                      typeof parsed !== "object"
                    )
                      throw new Error("参数必须是 JSON 对象");
                    next = restoreMasked(parsed, parameters) as Record<
                      string,
                      unknown
                    >;
                  } catch (cause) {
                    setError(
                      cause instanceof Error ? cause.message : String(cause),
                    );
                    return;
                  }
                }
                setPending(true);
                void onRevise(action.id, next, note.trim())
                  .catch((cause) => setError(String(cause)))
                  .finally(() => setPending(false));
              }}
            >
              {pending ? "正在重新拟案…" : "请 AI 重新拟案"}
            </button>
          </div>
        </div>
      )}
      {canContinue && action?.run_id && (
        <div className="amadeus-card-controls">
          <button
            type="button"
            onClick={() =>
              void onContinue(
                action.run_id!,
                "agent",
                "根据已保存的工具结果继续。先核对当前项目状态。",
              )
            }
          >
            继续对话
          </button>
        </div>
      )}
    </section>
  );
}
