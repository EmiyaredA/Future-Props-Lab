import { QueryFeedback } from "@shared/ui/QueryFeedback";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CircleAlert,
  Clock3,
  FlaskConical,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import {
  createModelTestTool,
  deleteModelTestTool,
  executeModelTestTool,
  getModelTestTool,
  getModelTestTools,
  updateModelTestTool,
  type ModelTestToolInput,
} from "@features/models/api";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { modelQueryKeys } from "@features/models/queryKeys";
import { ModelTestToolWizard } from "./ModelTestToolWizard";
import "./model-test-tools.css";
import "./model-test-tool-detail.css";

function formatTime(value: string | null) {
  if (!value) return "尚未使用";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="test-tool-json">{JSON.stringify(value, null, 2)}</pre>;
}

function ToolDetail({
  toolId,
  onBack,
}: {
  toolId: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: modelQueryKeys.tool(toolId),
    queryFn: () => getModelTestTool(toolId),
  });
  const tool = query.data;
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [input, setInput] = useState("{}");
  const [runError, setRunError] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const saveMutation = useMutation({
    mutationFn: (body: ModelTestToolInput) =>
      updateModelTestTool(toolId, tool?.revision ?? 0, body),
    onSuccess: async () => {
      setEditing(false);
      await Promise.all([
        query.refetch(),
        queryClient.invalidateQueries({ queryKey: modelQueryKeys.tools }),
      ]);
    },
  });
  const runMutation = useMutation({
    mutationFn: async () => {
      if (!tool) throw new Error("工具尚未加载");
      const parsed = JSON.parse(input) as Record<string, unknown>;
      return executeModelTestTool(tool.id, tool.revision, parsed);
    },
    onSuccess: async (call) => {
      setRunError("");
      setResult(call);
      await query.refetch();
    },
    onError: (cause) =>
      setRunError(cause instanceof Error ? cause.message : String(cause)),
  });
  const removeMutation = useMutation({
    mutationFn: () => deleteModelTestTool(toolId, tool?.revision ?? 0),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: modelQueryKeys.tools });
      onBack();
    },
  });
  if (query.isLoading)
    return <div className="test-tool-loading">正在加载测试工具…</div>;
  if (!tool)
    return (
      <div className="test-tool-empty">
        <CircleAlert aria-hidden />
        <h2>测试工具不存在</h2>
        <button onClick={onBack}>返回列表</button>
      </div>
    );
  const properties = Object.entries(tool.input_schema.properties ?? {});
  const required = new Set(
    Array.isArray(tool.input_schema.required) ? tool.input_schema.required : [],
  );
  return (
    <section className="test-tools-page detail">
      <button className="test-tool-back" onClick={onBack}>
        <ArrowLeft aria-hidden /> 测试工具
      </button>
      <header className="test-tool-detail-head">
        <span className="test-tool-mark">
          <FlaskConical aria-hidden />
        </span>
        <div>
          <div className="test-tool-title-row">
            <h1>{tool.name}</h1>
            <span
              className={
                tool.enabled ? "test-tool-badge enabled" : "test-tool-badge"
              }
            >
              {tool.enabled ? "已启用" : "已停用"}
            </span>
            <span className={`test-tool-badge ${tool.mock_kind}`}>
              {tool.mock_kind === "success" ? "固定成功" : "模拟失败"}
            </span>
          </div>
          <p>{tool.description || "暂无工具说明"}</p>
        </div>
        <div className="test-tool-detail-actions">
          <button onClick={() => setEditing(true)}>
            <Pencil aria-hidden /> 编辑
          </button>
          <button className="danger" onClick={() => setDeleting(true)}>
            <Trash2 aria-hidden /> 删除
          </button>
        </div>
      </header>
      <div className="test-tool-detail-grid">
        <div className="test-tool-detail-column">
          <article className="test-tool-card">
            <h2>工具定义</h2>
            <dl>
              <div>
                <dt>工具名称</dt>
                <dd>{tool.name}</dd>
              </div>
              <div>
                <dt>工具说明</dt>
                <dd>{tool.description || "—"}</dd>
              </div>
            </dl>
            <h3>输入参数</h3>
            {properties.length ? (
              <div className="test-tool-table">
                <div>
                  <b>参数名称</b>
                  <b>类型</b>
                  <b>是否必填</b>
                  <b>描述</b>
                </div>
                {properties.map(([name, raw]) => {
                  const schema = raw as Record<string, unknown>;
                  return (
                    <div key={name}>
                      <span>{name}</span>
                      <span>{String(schema.type || "—")}</span>
                      <span>{required.has(name) ? "必填" : "可选"}</span>
                      <span>{String(schema.description || "—")}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="test-tool-muted">无需输入参数</p>
            )}
            <h3>模拟行为</h3>
            <p
              className={
                tool.mock_kind === "success"
                  ? "test-tool-success"
                  : "test-tool-failure"
              }
            >
              {tool.mock_kind === "success"
                ? "固定成功"
                : `${tool.error_code} · ${tool.error_message}`}
            </p>
            <p>
              <Clock3 aria-hidden /> 延迟 {tool.delay_ms} ms
            </p>
            {tool.mock_kind === "success" ? (
              <JsonBlock value={tool.mock_result} />
            ) : null}
          </article>
          <article className="test-tool-card">
            <h2>使用情况</h2>
            <p>已在 {tool.bound_conversation_count} 个模型测试会话中启用</p>
            <p className="test-tool-muted">
              最近调用 {formatTime(tool.last_used_at)}
            </p>
          </article>
        </div>
        <article className="test-tool-card test-tool-run">
          <h2>试运行</h2>
          <p className="test-tool-muted">
            输入参数并查看模拟结果，不会调用真实服务。
          </p>
          <label>
            <span>输入参数（JSON）</span>
            <textarea
              className="test-tool-code"
              rows={10}
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
          </label>
          <button
            className="test-tool-button primary wide"
            disabled={runMutation.isPending}
            onClick={() => {
              setRunError("");
              void runMutation.mutateAsync();
            }}
          >
            <Play aria-hidden />{" "}
            {runMutation.isPending ? "运行中…" : "运行测试"}
          </button>
          {runError ? <p className="test-tool-form-error">{runError}</p> : null}
          {result ? (
            <div className="test-tool-run-result">
              <h3>结果</h3>
              <JsonBlock value={result} />
            </div>
          ) : null}
        </article>
      </div>
      {editing ? (
        <ModelTestToolWizard
          tool={tool}
          saving={saveMutation.isPending}
          onClose={() => setEditing(false)}
          onSave={async (body) => {
            await saveMutation.mutateAsync(body);
          }}
        />
      ) : null}
      <ConfirmDialog
        open={deleting}
        title="删除测试工具？"
        description={
          tool.bound_conversation_count
            ? `该工具仍被 ${tool.bound_conversation_count} 个会话使用，请先解除绑定。`
            : "删除后无法恢复，但历史调用快照仍会保留。"
        }
        confirmLabel="删除"
        pending={removeMutation.isPending}
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          await removeMutation.mutateAsync();
        }}
      />
    </section>
  );
}

export function ModelTestToolsPage({
  toolId,
  onOpenTool,
  onBack,
}: {
  toolId?: string;
  onOpenTool: (toolId: string) => void;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: modelQueryKeys.tools,
    queryFn: getModelTestTools,
  });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "enabled" | "disabled">("all");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const createMutation = useMutation({
    mutationFn: createModelTestTool,
    onSuccess: async (tool) => {
      setCreating(false);
      await queryClient.invalidateQueries({ queryKey: modelQueryKeys.tools });
      onOpenTool(tool.id);
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
  });
  if (toolId) return <ToolDetail toolId={toolId} onBack={onBack} />;
  const catalog = query.data;
  const normalized = search.trim().toLowerCase();
  const tools = (catalog?.items ?? []).filter(
    (tool) =>
      (status === "all" ||
        (status === "enabled" ? tool.enabled : !tool.enabled)) &&
      (!normalized ||
        `${tool.name} ${tool.description}`.toLowerCase().includes(normalized)),
  );
  return (
    <section className="test-tools-page">
      <header className="test-tools-heading">
        <div>
          <span className="eyebrow">基模型能力</span>
          <h1>测试工具</h1>
          <p>
            创建供模型测试使用的模拟工具，验证工具选择、参数生成与结果处理。
          </p>
        </div>
        <button
          className="test-tool-button primary"
          onClick={() => setCreating(true)}
        >
          <Plus aria-hidden /> 新建测试工具
        </button>
      </header>
      <div className="test-tools-filters">
        <label>
          <Search aria-hidden />
          <input
            aria-label="搜索测试工具"
            value={search}
            placeholder="搜索测试工具名称或说明"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div role="group" aria-label="工具状态">
          <button
            className={status === "all" ? "active" : ""}
            onClick={() => setStatus("all")}
          >
            全部
          </button>
          <button
            className={status === "enabled" ? "active" : ""}
            onClick={() => setStatus("enabled")}
          >
            已启用
          </button>
          <button
            className={status === "disabled" ? "active" : ""}
            onClick={() => setStatus("disabled")}
          >
            已停用
          </button>
        </div>
      </div>
      <QueryFeedback error={query.error} onRetry={query.refetch} />
      {error ? <p className="test-tool-form-error">{error}</p> : null}
      <div className="test-tools-layout">
        <div className="test-tools-list">
          {query.isLoading ? (
            <div className="test-tool-loading">正在加载测试工具…</div>
          ) : tools.length ? (
            tools.map((tool) => (
              <article className="test-tool-list-card" key={tool.id}>
                <span className="test-tool-mark">
                  <FlaskConical aria-hidden />
                </span>
                <div className="test-tool-list-copy">
                  <h2>{tool.name}</h2>
                  <p>{tool.description || "暂无工具说明"}</p>
                  <div>
                    <span
                      className={
                        tool.enabled
                          ? "test-tool-badge enabled"
                          : "test-tool-badge"
                      }
                    >
                      {tool.enabled ? "已启用" : "已停用"}
                    </span>
                    <span className={`test-tool-badge ${tool.mock_kind}`}>
                      {tool.mock_kind === "success" ? "固定成功" : "模拟失败"}
                    </span>
                  </div>
                  <small>
                    {tool.parameter_count} 个输入参数 · 最近使用{" "}
                    {formatTime(tool.last_used_at)}
                  </small>
                </div>
                <button
                  className="test-tool-run-link"
                  onClick={() => onOpenTool(tool.id)}
                >
                  <Play aria-hidden /> 试运行
                </button>
              </article>
            ))
          ) : (
            <div className="test-tool-empty">
              <FlaskConical aria-hidden />
              <h2>{normalized ? "没有匹配的测试工具" : "还没有测试工具"}</h2>
              <p>创建一个确定性的 Mock 工具，开始验证模型的工具调用能力。</p>
              {!normalized ? (
                <button
                  className="test-tool-button primary"
                  onClick={() => setCreating(true)}
                >
                  新建测试工具
                </button>
              ) : null}
            </div>
          )}
        </div>
        <aside className="test-tools-overview">
          <h2>测试工具概览</h2>
          <div className="test-tool-metrics">
            <div>
              <strong>{catalog?.overview.total ?? 0}</strong>
              <span>总数</span>
            </div>
            <div>
              <strong>{catalog?.overview.enabled ?? 0}</strong>
              <span>已启用</span>
            </div>
            <div>
              <strong>{catalog?.overview.failure ?? 0}</strong>
              <span>模拟失败</span>
            </div>
            <div>
              <strong>{catalog?.overview.today_runs ?? 0}</strong>
              <span>今日运行</span>
            </div>
          </div>
          <h3>最近调用</h3>
          {(catalog?.overview.recent ?? []).length ? (
            (catalog?.overview.recent ?? []).map((tool) => (
              <button key={tool.id} onClick={() => onOpenTool(tool.id)}>
                <FlaskConical aria-hidden />
                <span>{tool.name}</span>
                <small>{formatTime(tool.last_used_at)}</small>
              </button>
            ))
          ) : (
            <p className="test-tool-muted">暂无调用记录</p>
          )}
        </aside>
      </div>
      {creating ? (
        <ModelTestToolWizard
          saving={createMutation.isPending}
          onClose={() => setCreating(false)}
          onSave={async (body) => {
            await createMutation.mutateAsync(body);
          }}
        />
      ) : null}
    </section>
  );
}
