import { integrationKeys } from "./queryKeys";
import { useIntegrationInteraction, useIntegrationOpen } from "./interaction";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Braces,
  CheckCircle2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Zap,
} from "lucide-react";
import {
  createToolApi,
  deleteToolApi,
  getToolApis,
  updateToolApi,
  validateToolApi,
  type ToolApi,
  type ToolApiInput,
} from "@features/integrations/api";
import {
  IntegrationModal,
  PanelMessage,
  StatusBadge,
  ToggleButton,
} from "@features/integrations/components";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { ApiError } from "@platform/api/client";

const KEY = integrationKeys.catalog("tool-apis");
const EMPTY: ToolApiInput = {
  name: "",
  description: "",
  method: "GET",
  url: "",
  auth_kind: "none",
  auth_header_name: "",
  secret: "",
  clear_secret: false,
  parameters_schema: { type: "object", properties: {} },
  query_template: {},
  body_template: null,
  tags: [],
  enabled: true,
  sensitive_result: false,
};

function message(error: unknown) {
  if (error instanceof ApiError && error.problem.code === "revision_conflict") {
    return "配置已被其他操作更新，当前输入已保留。请关闭后重新打开最新配置再合并修改。";
  }
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function apiToInput(item: ToolApi): ToolApiInput {
  return {
    name: item.name,
    description: item.description,
    method: item.method as ToolApiInput["method"],
    url: item.url,
    auth_kind: item.auth_kind as ToolApiInput["auth_kind"],
    auth_header_name: item.auth_header_name,
    secret: "",
    clear_secret: false,
    parameters_schema: item.parameters_schema,
    query_template: item.query_template,
    body_template: item.body_template,
    tags: item.tags,
    enabled: item.enabled,
    sensitive_result: item.sensitive_result,
  };
}

function JsonField({
  label,
  value,
  onChange,
  optional = false,
}: {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  optional?: boolean;
}) {
  const [text, setText] = useState(
    value === null && optional ? "" : JSON.stringify(value, null, 2),
  );
  const [invalid, setInvalid] = useState(false);
  return (
    <label className="integration-field full">
      <span>{label}</span>
      <textarea
        rows={5}
        className={invalid ? "invalid" : ""}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          try {
            onChange(
              next.trim() || !optional ? JSON.parse(next || "{}") : null,
            );
            setInvalid(false);
          } catch {
            setInvalid(true);
          }
        }}
      />
      {invalid ? <small className="field-error">请输入有效 JSON</small> : null}
    </label>
  );
}

function ToolApiForm({
  current,
  pending,
  onCancel,
  onSubmit,
}: {
  current: ToolApi | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (value: ToolApiInput) => void;
}) {
  const [value, setValue] = useState<ToolApiInput>(() =>
    current ? apiToInput(current) : { ...EMPTY },
  );
  const [tags, setTags] = useState(value.tags?.join(", ") ?? "");
  return (
    <form
      className="integration-form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <label className="integration-field">
        <span>名称</span>
        <input
          required
          maxLength={120}
          value={value.name}
          onChange={(e) => setValue({ ...value, name: e.target.value })}
        />
      </label>
      <label className="integration-field">
        <span>请求方法</span>
        <CustomSelect
          ariaLabel="请求方法"
          value={value.method}
          options={["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => ({
            value: method,
            label: method,
          }))}
          onChange={(method) =>
            setValue({ ...value, method: method as ToolApiInput["method"] })
          }
        />
      </label>
      <label className="integration-field full">
        <span>HTTPS 或本机回环 URL</span>
        <input
          required
          type="url"
          placeholder="https://api.example.com/action"
          value={value.url}
          onChange={(e) => setValue({ ...value, url: e.target.value })}
        />
      </label>
      <label className="integration-field full">
        <span>说明</span>
        <input
          maxLength={500}
          value={value.description}
          onChange={(e) => setValue({ ...value, description: e.target.value })}
        />
      </label>
      <label className="integration-field">
        <span>认证方式</span>
        <CustomSelect
          ariaLabel="认证方式"
          value={value.auth_kind}
          options={[
            { value: "none", label: "无认证" },
            { value: "bearer", label: "Bearer Token" },
            { value: "api_key", label: "API-Key Header" },
          ]}
          onChange={(auth_kind) =>
            setValue({
              ...value,
              auth_kind: auth_kind as ToolApiInput["auth_kind"],
            })
          }
        />
      </label>
      {value.auth_kind === "api_key" ? (
        <label className="integration-field">
          <span>Header 名称</span>
          <input
            required
            value={value.auth_header_name}
            onChange={(e) =>
              setValue({ ...value, auth_header_name: e.target.value })
            }
          />
        </label>
      ) : null}
      {value.auth_kind !== "none" ? (
        <label className="integration-field full">
          <span>
            {current?.has_secret
              ? `密钥（留空保留，当前 ${current.secret_hint}）`
              : "密钥"}
          </span>
          <input
            type="password"
            value={value.secret}
            onChange={(e) => setValue({ ...value, secret: e.target.value })}
          />
          {current?.has_secret ? (
            <button
              type="button"
              className="text-btn"
              onClick={() =>
                setValue({ ...value, secret: "", clear_secret: true })
              }
            >
              明确清除密钥
            </button>
          ) : null}
        </label>
      ) : null}
      <JsonField
        label="输入 JSON Schema"
        value={value.parameters_schema}
        onChange={(parameters_schema) =>
          setValue({
            ...value,
            parameters_schema: parameters_schema as Record<string, never>,
          })
        }
      />
      <JsonField
        label="查询参数模板"
        value={value.query_template}
        onChange={(query_template) =>
          setValue({
            ...value,
            query_template: query_template as Record<string, never>,
          })
        }
      />
      <JsonField
        optional
        label="JSON Body 模板（可选）"
        value={value.body_template}
        onChange={(body_template) => setValue({ ...value, body_template })}
      />
      <label className="integration-field full">
        <span>标签（逗号分隔）</span>
        <input
          value={tags}
          onChange={(e) => {
            setTags(e.target.value);
            setValue({
              ...value,
              tags: e.target.value
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            });
          }}
        />
      </label>
      <label className="integration-field full">
        <span>敏感工具结果</span>
        <ToggleButton
          value={value.sensitive_result || false}
          onChange={(sensitive_result) =>
            setValue({ ...value, sensitive_result })
          }
        />
      </label>
      <ToggleButton
        value={value.enabled}
        onChange={(enabled) => setValue({ ...value, enabled })}
      />
      <footer className="integration-form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? "保存中…" : "保存"}
        </button>
      </footer>
    </form>
  );
}

export function ToolApiPanel({
  canManage,
  search,
  status,
  onSearchChange,
  onStatusChange,
}: {
  canManage: boolean;
  search: string;
  status: string;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: string) => void;
}) {
  const client = useQueryClient();
  const { blocked } = useIntegrationInteraction();
  const query = useQuery({ queryKey: KEY, queryFn: getToolApis });
  const [editing, setEditing] = useState<ToolApi | null | undefined>();
  const [testing, setTesting] = useState<ToolApi | null>(null);
  const [testInput, setTestInput] = useState("{}");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [removing, setRemoving] = useState<ToolApi | null>(null);
  const [notice, setNotice] = useState("");

  const refresh = () => client.invalidateQueries({ queryKey: KEY });
  const save = useMutation({
    mutationFn: (body: ToolApiInput) =>
      editing ? updateToolApi(editing, body) : createToolApi(body),
    onSuccess: () => {
      setEditing(undefined);
      setNotice("");
      void refresh();
    },
    onError: (error) => {
      setNotice(message(error));
      if (
        error instanceof ApiError &&
        error.problem.code === "revision_conflict"
      ) {
        void refresh();
      }
    },
  });
  const validate = useMutation({
    mutationFn: ({ item, input }: { item: ToolApi; input: unknown }) =>
      validateToolApi(item, input),
    onSuccess: (data) => {
      setResult({
        ok: data.check.ok,
        text: data.response_preview || data.check.summary,
      });
      void refresh();
    },
    onError: (error) => setResult({ ok: false, text: message(error) }),
  });
  const remove = useMutation({
    mutationFn: deleteToolApi,
    onSuccess: () => {
      setRemoving(null);
      void refresh();
    },
    onError: (error) => {
      setNotice(message(error));
      if (
        error instanceof ApiError &&
        error.problem.code === "revision_conflict"
      )
        void refresh();
    },
  });
  useEffect(() => {
    if (!query.data || blocked()) return;
    setEditing((current) =>
      current
        ? query.data.items.find((item) => item.id === current.id)
        : current,
    );
    setTesting((current) =>
      current
        ? (query.data.items.find((item) => item.id === current.id) ?? null)
        : null,
    );
  }, [query.data, blocked]);
  useIntegrationOpen("tool-api", !query.isPending, async (request, active) => {
    const catalog = await client.fetchQuery({
      queryKey: integrationKeys.catalog("tool-apis"),
      queryFn: getToolApis,
      staleTime: 0,
    });
    if (!active()) return;
    setEditing(undefined);
    setTesting(null);
    if (request.view === "list") return;
    if (!canManage) throw new Error("权限不足");
    const item = catalog.items.find((item) => item.id === request.resource_id);
    if (request.resource_id && !item) throw new Error("工具 API 不存在");
    if (request.view === "edit") setEditing(item ?? null);
    else if (item) {
      setTesting(item);
      setTestInput("{}");
      setResult(null);
    }
  });
  const items = useMemo(
    () =>
      (query.data?.items ?? []).filter((item) => {
        const match = `${item.name} ${item.description} ${item.tags.join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase());
        return (
          match &&
          (status === "all" ||
            (status === "draft"
              ? !item.enabled
              : item.enabled && item.status === status))
        );
      }),
    [query.data, search, status],
  );

  return (
    <div className="integration-panel">
      <div className="integration-toolbar">
        <label className="integration-search">
          <Search aria-hidden />
          <input
            aria-label="搜索工具 API"
            placeholder="搜索名称、说明或标签"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </label>
        <CustomSelect
          ariaLabel="状态筛选"
          value={status}
          options={[
            { value: "all", label: "全部状态" },
            { value: "healthy", label: "正常" },
            { value: "failed", label: "异常" },
            { value: "unchecked", label: "未验证" },
            { value: "draft", label: "草稿" },
          ]}
          onChange={onStatusChange}
        />
        {canManage ? (
          <button
            type="button"
            className="btn primary"
            onClick={() => setEditing(null)}
          >
            <Plus aria-hidden />
            新建工具 API
          </button>
        ) : null}
      </div>
      {notice ? <PanelMessage>{notice}</PanelMessage> : null}
      <div className="integration-layout">
        <main className="integration-grid">
          {query.isLoading ? (
            <PanelMessage>正在加载工具 API…</PanelMessage>
          ) : query.isError ? (
            <PanelMessage>加载失败，请重试。</PanelMessage>
          ) : items.length === 0 ? (
            <PanelMessage>
              {query.data?.items.length
                ? "没有匹配的工具 API。"
                : "还没有工具 API。"}
            </PanelMessage>
          ) : (
            items.map((item) => (
              <article className="integration-card" key={item.id}>
                <header>
                  <span className="integration-card-icon">
                    <Braces aria-hidden />
                  </span>
                  <StatusBadge enabled={item.enabled} status={item.status} />
                </header>
                <h3>{item.name}</h3>
                <p>{item.description || `${item.method} ${item.url}`}</p>
                <div className="integration-card-meta">
                  <code>{item.method}</code>
                  <span>{item.tags.join(" · ") || "未添加标签"}</span>
                </div>
                <footer>
                  <span>
                    {item.last_checked_at
                      ? `最近验证 ${new Date(item.last_checked_at).toLocaleString()}`
                      : "尚未验证"}
                  </span>
                  {canManage ? (
                    <span className="card-actions">
                      <button
                        aria-label={`验证 ${item.name}`}
                        onClick={() => {
                          setTesting(item);
                          setResult(null);
                          setTestInput("{}");
                        }}
                      >
                        <Zap aria-hidden />
                      </button>
                      <button
                        aria-label={`编辑 ${item.name}`}
                        onClick={() => setEditing(item)}
                      >
                        <Pencil aria-hidden />
                      </button>
                      <button
                        aria-label={`删除 ${item.name}`}
                        onClick={() => setRemoving(item)}
                      >
                        <Trash2 aria-hidden />
                      </button>
                    </span>
                  ) : null}
                </footer>
              </article>
            ))
          )}
        </main>
        <aside className="integration-overview">
          <h2>工具 API 概览</h2>
          <div className="overview-stats">
            <span>
              <strong>{query.data?.overview.primary_count ?? 0}</strong>已启用
            </span>
            <span>
              <strong>{query.data?.overview.failed_count ?? 0}</strong>异常
            </span>
            <span>
              <strong>{query.data?.overview.tertiary_count ?? 0}</strong>
              今日验证
            </span>
          </div>
          <h3>最近验证</h3>
          {query.data?.overview.recent?.length ? (
            query.data.overview.recent.map((check) => (
              <div className="recent-check" key={check.id}>
                <CheckCircle2 aria-hidden />
                <span>
                  <strong>{check.resource_name}</strong>
                  <small>{check.summary}</small>
                </span>
              </div>
            ))
          ) : (
            <p className="muted">暂无验证记录</p>
          )}
        </aside>
      </div>
      {editing !== undefined ? (
        <IntegrationModal
          protect
          pending={save.isPending}
          title={editing ? "编辑工具 API" : "新建工具 API"}
          onClose={() => setEditing(undefined)}
          wide
        >
          {notice && <p role="alert">{notice}</p>}
          <ToolApiForm
            key={editing ? `${editing.id}:${editing.revision}` : "new"}
            current={editing}
            pending={save.isPending}
            onCancel={() => setEditing(undefined)}
            onSubmit={(body) => save.mutate(body)}
          />
        </IntegrationModal>
      ) : null}
      {testing ? (
        <IntegrationModal
          title={`验证 ${testing.name}`}
          protect
          pending={validate.isPending}
          onClose={() => setTesting(null)}
        >
          <div className="integration-form">
            <label className="integration-field full">
              <span>测试输入 JSON</span>
              <textarea
                rows={8}
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
              />
            </label>
            {result ? (
              <pre
                className={
                  result.ok
                    ? "validation-result ok"
                    : "validation-result failed"
                }
              >
                {result.text}
              </pre>
            ) : null}
            <footer className="integration-form-actions">
              <button
                className="btn"
                type="button"
                onClick={() => setTesting(null)}
              >
                关闭
              </button>
              <button
                className="btn primary"
                type="button"
                disabled={validate.isPending}
                onClick={() => {
                  try {
                    validate.mutate({
                      item: testing,
                      input: JSON.parse(testInput),
                    });
                  } catch {
                    setResult({ ok: false, text: "测试输入不是有效 JSON。" });
                  }
                }}
              >
                {validate.isPending ? "验证中…" : "开始验证"}
              </button>
            </footer>
          </div>
        </IntegrationModal>
      ) : null}
      <ConfirmDialog
        open={Boolean(removing)}
        title="删除工具 API？"
        description="配置和验证记录将被删除，此操作无法撤销。"
        confirmLabel="删除"
        pending={remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) remove.mutate(removing);
        }}
      />
    </div>
  );
}
