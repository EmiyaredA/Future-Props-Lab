import { LoadingState } from "@shared/ui/LoadingState";
import { integrationKeys } from "./queryKeys";
import { useIntegrationInteraction, useIntegrationOpen } from "./interaction";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cable, Eye, Pencil, Plus, Search, Trash2, Zap } from "lucide-react";
import {
  createMcpServer,
  deleteMcpServer,
  getMcpServers,
  getMcpTools,
  updateMcpServer,
  validateMcpServer,
  type McpInput,
  type McpServer,
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

const KEY = integrationKeys.catalog("mcp");
const EMPTY: McpInput = {
  name: "",
  description: "",
  transport: "streamable_http",
  url: "",
  command: "",
  arguments: [],
  bearer_token: "",
  clear_bearer_token: false,
  environment: {},
  clear_environment: false,
  tags: [],
  enabled: true,
  sensitive_result: false,
};

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.problem.code === "revision_conflict") {
    return "配置已被其他操作更新，当前输入已保留。请关闭后重新打开最新配置再合并修改。";
  }
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function toInput(item: McpServer): McpInput {
  return {
    name: item.name,
    description: item.description,
    transport: item.transport as McpInput["transport"],
    url: item.url,
    command: item.command,
    arguments: item.arguments,
    bearer_token: "",
    clear_bearer_token: false,
    environment: {},
    clear_environment: false,
    tags: item.tags,
    enabled: item.enabled,
    sensitive_result: item.sensitive_result,
  };
}

function McpForm({
  current,
  pending,
  onCancel,
  onSubmit,
}: {
  current: McpServer | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (body: McpInput) => void;
}) {
  const [value, setValue] = useState<McpInput>(() =>
    current ? toInput(current) : { ...EMPTY },
  );
  const [args, setArgs] = useState(JSON.stringify(value.arguments, null, 2));
  const [environment, setEnvironment] = useState("{}");
  const [tags, setTags] = useState((value.tags ?? []).join(", "));
  const [invalidJson, setInvalidJson] = useState("");
  return (
    <form
      className="integration-form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (!invalidJson) onSubmit(value);
      }}
    >
      <label className="integration-field">
        <span>名称</span>
        <input
          required
          value={value.name}
          onChange={(e) => setValue({ ...value, name: e.target.value })}
        />
      </label>
      <label className="integration-field">
        <span>传输方式</span>
        <CustomSelect
          ariaLabel="MCP 传输方式"
          value={value.transport}
          options={[
            { value: "streamable_http", label: "Streamable HTTP" },
            { value: "stdio", label: "stdio" },
          ]}
          onChange={(transport) =>
            setValue({
              ...value,
              transport: transport as McpInput["transport"],
            })
          }
        />
      </label>
      <label className="integration-field full">
        <span>说明</span>
        <input
          value={value.description}
          onChange={(e) => setValue({ ...value, description: e.target.value })}
        />
      </label>
      {value.transport === "streamable_http" ? (
        <>
          <label className="integration-field full">
            <span>HTTPS 或本机回环 URL</span>
            <input
              required
              type="url"
              placeholder="https://mcp.example.com/mcp"
              value={value.url}
              onChange={(e) => setValue({ ...value, url: e.target.value })}
            />
          </label>
          <label className="integration-field full">
            <span>
              {current?.has_bearer_token
                ? `Bearer Token（留空保留，当前 ${current.bearer_hint}）`
                : "Bearer Token（可选）"}
            </span>
            <input
              type="password"
              value={value.bearer_token}
              onChange={(e) =>
                setValue({ ...value, bearer_token: e.target.value })
              }
            />
            {current?.has_bearer_token ? (
              <button
                type="button"
                className="text-btn"
                onClick={() =>
                  setValue({
                    ...value,
                    bearer_token: "",
                    clear_bearer_token: true,
                  })
                }
              >
                明确清除 Token
              </button>
            ) : null}
          </label>
        </>
      ) : (
        <>
          <label className="integration-field full">
            <span>绝对可执行文件路径</span>
            <input
              required
              placeholder="/usr/local/bin/my-mcp-server"
              value={value.command}
              onChange={(e) => setValue({ ...value, command: e.target.value })}
            />
            <small>须命中服务端 FPL_MCP_STDIO_ALLOWED_COMMANDS 白名单。</small>
          </label>
          <label className="integration-field full">
            <span>参数数组（JSON）</span>
            <textarea
              rows={4}
              value={args}
              onChange={(e) => {
                setArgs(e.target.value);
                try {
                  const parsed = JSON.parse(e.target.value);
                  if (!Array.isArray(parsed)) throw new Error();
                  setValue({ ...value, arguments: parsed });
                  setInvalidJson("");
                } catch {
                  setInvalidJson("参数必须是 JSON 字符串数组");
                }
              }}
            />
          </label>
          <label className="integration-field full">
            <span>
              {current?.environment_keys.length
                ? `环境变量 JSON（留空保留：${current.environment_keys.join(", ")}）`
                : "环境变量 JSON"}
            </span>
            <textarea
              rows={4}
              value={environment}
              onChange={(e) => {
                setEnvironment(e.target.value);
                try {
                  const parsed = JSON.parse(e.target.value || "{}");
                  setValue({ ...value, environment: parsed });
                  setInvalidJson("");
                } catch {
                  setInvalidJson("环境变量必须是 JSON 对象");
                }
              }}
            />
            {current?.environment_keys.length ? (
              <button
                type="button"
                className="text-btn"
                onClick={() => {
                  setEnvironment("{}");
                  setValue({
                    ...value,
                    environment: {},
                    clear_environment: true,
                  });
                }}
              >
                明确清除环境变量
              </button>
            ) : null}
          </label>
        </>
      )}
      {invalidJson ? <span className="field-error">{invalidJson}</span> : null}
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
        <button
          type="submit"
          className="btn primary"
          disabled={pending || Boolean(invalidJson)}
        >
          {pending ? <LoadingState variant="inline" label="保存中…" /> : "保存"}
        </button>
      </footer>
    </form>
  );
}

export function McpPanel({
  canManage,
  search,
  transport,
  onSearchChange,
  onTransportChange,
}: {
  canManage: boolean;
  search: string;
  transport: string;
  onSearchChange: (value: string) => void;
  onTransportChange: (value: string) => void;
}) {
  const client = useQueryClient();
  const { blocked } = useIntegrationInteraction();
  const query = useQuery({ queryKey: KEY, queryFn: getMcpServers });
  const [editing, setEditing] = useState<McpServer | null | undefined>();
  const [removing, setRemoving] = useState<McpServer | null>(null);
  const [viewing, setViewing] = useState<McpServer | null>(null);
  const toolsQuery = useQuery({
    queryKey: integrationKeys.tools(viewing?.id ?? ""),
    queryFn: () => getMcpTools(viewing!),
    enabled: Boolean(viewing),
  });
  const tools = toolsQuery.data ?? [];
  const [notice, setNotice] = useState("");
  const refresh = () => client.invalidateQueries({ queryKey: KEY });
  const save = useMutation({
    mutationFn: (body: McpInput) =>
      editing ? updateMcpServer(editing, body) : createMcpServer(body),
    onSuccess: () => {
      setEditing(undefined);
      setNotice("");
      void refresh();
    },
    onError: (error) => {
      setNotice(errorMessage(error));
      if (
        error instanceof ApiError &&
        error.problem.code === "revision_conflict"
      ) {
        void refresh();
      }
    },
  });
  const validate = useMutation({
    mutationFn: validateMcpServer,
    onSuccess: (data) => {
      setNotice(data.check.summary);
      setViewing(data.server);
      client.setQueryData(integrationKeys.tools(data.server.id), data.tools);
      void refresh();
    },
    onError: (error) => {
      setNotice(errorMessage(error));
      if (
        error instanceof ApiError &&
        error.problem.code === "revision_conflict"
      )
        void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: deleteMcpServer,
    onSuccess: () => {
      setRemoving(null);
      void refresh();
    },
    onError: (error) => {
      setNotice(errorMessage(error));
      if (
        error instanceof ApiError &&
        error.problem.code === "revision_conflict"
      )
        void refresh();
    },
  });
  const items = useMemo(
    () =>
      (query.data?.items ?? []).filter(
        (item) =>
          `${item.name} ${item.description} ${item.tags.join(" ")}`
            .toLowerCase()
            .includes(search.toLowerCase()) &&
          (transport === "all" || item.transport === transport),
      ),
    [query.data, search, transport],
  );
  useEffect(() => {
    if (!query.data || blocked()) return;
    setEditing((current) =>
      current
        ? query.data.items.find((item) => item.id === current.id)
        : current,
    );
    setViewing((current) =>
      current
        ? (query.data.items.find((item) => item.id === current.id) ?? null)
        : null,
    );
  }, [query.data, blocked]);
  useIntegrationOpen("mcp", !query.isPending, async (request, active) => {
    const catalog = await client.fetchQuery({
      queryKey: integrationKeys.catalog("mcp"),
      queryFn: getMcpServers,
      staleTime: 0,
    });
    if (!active()) return;
    setEditing(undefined);
    setViewing(null);
    if (request.view === "list") return;
    const item = catalog.items.find((item) => item.id === request.resource_id);
    if (request.resource_id && !item) throw new Error("MCP 不存在");
    if (request.view === "edit") {
      if (!canManage) throw new Error("权限不足");
      setEditing(item ?? null);
    } else if (item) {
      await client.fetchQuery({
        queryKey: integrationKeys.tools(item.id),
        queryFn: () => getMcpTools(item),
      });
      if (!active()) return;
      setViewing(item);
    }
  });
  const openTools = async (item: McpServer) => {
    setViewing(item);
    try {
      await client.fetchQuery({
        queryKey: integrationKeys.tools(item.id),
        queryFn: () => getMcpTools(item),
      });
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };
  return (
    <div className="integration-panel">
      <div className="integration-toolbar">
        <label className="integration-search">
          <Search aria-hidden />
          <input
            aria-label="搜索 MCP"
            placeholder="搜索 MCP 服务"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </label>
        <CustomSelect
          ariaLabel="传输方式筛选"
          value={transport}
          options={[
            { value: "all", label: "全部传输" },
            { value: "streamable_http", label: "Streamable HTTP" },
            { value: "stdio", label: "stdio" },
          ]}
          onChange={onTransportChange}
        />
        {canManage ? (
          <button
            type="button"
            className="btn primary"
            onClick={() => setEditing(null)}
          >
            <Plus aria-hidden />
            添加 MCP
          </button>
        ) : null}
      </div>
      {notice ? <PanelMessage>{notice}</PanelMessage> : null}
      <div className="integration-layout">
        <main className="integration-grid">
          {query.isLoading ? (
            <LoadingState label="正在加载 MCP 服务…" variant="region" />
          ) : query.isError ? (
            <PanelMessage>加载失败，请重试。</PanelMessage>
          ) : items.length === 0 ? (
            <PanelMessage>
              {query.data?.items.length
                ? "没有匹配的 MCP 服务。"
                : "还没有 MCP 服务。"}
            </PanelMessage>
          ) : (
            items.map((item) => (
              <article className="integration-card" key={item.id}>
                <header>
                  <span className="integration-card-icon">
                    <Cable aria-hidden />
                  </span>
                  <StatusBadge enabled={item.enabled} status={item.status} />
                </header>
                <h3>{item.name}</h3>
                <p>
                  {item.description ||
                    (item.transport === "stdio" ? item.command : item.url)}
                </p>
                <div className="integration-card-meta">
                  <code>{item.transport === "stdio" ? "stdio" : "HTTP"}</code>
                  <span>{item.tool_count} 个工具</span>
                </div>
                <footer>
                  <span>{item.server_name || "尚未发现 Server 信息"}</span>
                  <span className="card-actions">
                    <button
                      aria-label={`查看 ${item.name} 工具`}
                      onClick={() => void openTools(item)}
                    >
                      <Eye aria-hidden />
                    </button>
                    {canManage ? (
                      <>
                        <button
                          aria-label={`验证 ${item.name}`}
                          disabled={validate.isPending}
                          onClick={() => validate.mutate(item)}
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
                      </>
                    ) : null}
                  </span>
                </footer>
              </article>
            ))
          )}
        </main>
        <aside className="integration-overview">
          <h2>MCP 概览</h2>
          <div className="overview-stats">
            <span>
              <strong>{query.data?.overview.primary_count ?? 0}</strong>已连接
            </span>
            <span>
              <strong>{query.data?.overview.failed_count ?? 0}</strong>异常
            </span>
            <span>
              <strong>{query.data?.overview.tertiary_count ?? 0}</strong>
              已发现工具
            </span>
          </div>
          <h3>最近验证</h3>
          {query.data?.overview.recent?.length ? (
            query.data.overview.recent.map((check) => (
              <div className="recent-check" key={check.id}>
                <Cable aria-hidden />
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
          title={editing ? "编辑 MCP" : "添加 MCP"}
          onClose={() => setEditing(undefined)}
          wide
        >
          {notice && <p role="alert">{notice}</p>}
          <McpForm
            key={editing ? `${editing.id}:${editing.revision}` : "new"}
            current={editing}
            pending={save.isPending}
            onCancel={() => setEditing(undefined)}
            onSubmit={(body) => save.mutate(body)}
          />
        </IntegrationModal>
      ) : null}
      {viewing ? (
        <IntegrationModal
          title={`${viewing.name} · 已发现工具`}
          onClose={() => setViewing(null)}
          wide
        >
          <div className="mcp-tool-list">
            {tools.length ? (
              tools.map((tool) => (
                <article key={tool.id}>
                  <h3>{tool.name}</h3>
                  <p>{tool.description || "无说明"}</p>
                  <details>
                    <summary>输入 Schema</summary>
                    <pre>{JSON.stringify(tool.input_schema, null, 2)}</pre>
                  </details>
                </article>
              ))
            ) : (
              <PanelMessage>尚未发现工具，请先验证连接。</PanelMessage>
            )}
          </div>
        </IntegrationModal>
      ) : null}
      <ConfirmDialog
        open={Boolean(removing)}
        title="删除 MCP 服务？"
        description="配置、工具快照和验证记录将被删除。"
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
