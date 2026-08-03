import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  batchDeleteLogs,
  deleteLog,
  getCatalog,
  getLog,
  getLogs,
  getLogStats,
  type CallLogItem,
  type LogFilters,
} from "@features/models/api";
import { CustomSelect } from "@shared/ui/CustomSelect";

function formatNumber(value: number | null | undefined): string {
  return value == null ? "—" : new Intl.NumberFormat("zh-CN").format(value);
}

function LogDetail({
  id,
  onClose,
  onDelete,
}: {
  id: string;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const query = useQuery({
    queryKey: ["model-log", id],
    queryFn: () => getLog(id),
  });
  const log = query.data;
  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="log-drawer">
        <div className="drawer-head">
          <div>
            <span className="eyebrow">CALL DETAIL</span>
            <h2>调用详情</h2>
          </div>
          <button className="icon-btn" onClick={onClose}>
            ×
          </button>
        </div>
        {query.isLoading ? (
          <p>加载中…</p>
        ) : log ? (
          <div className="drawer-content">
            <dl className="detail-grid">
              <div>
                <dt>状态</dt>
                <dd>
                  <span className={`status ${log.status}`}>
                    {log.status === "success" ? "成功" : "失败"}
                  </span>
                </dd>
              </div>
              <div>
                <dt>模型</dt>
                <dd>{log.model}</dd>
              </div>
              <div>
                <dt>调用源</dt>
                <dd>
                  {log.call_source === "model_playground"
                    ? "模型测试"
                    : "快速诊断"}
                </dd>
              </div>
              <div>
                <dt>供应商</dt>
                <dd>
                  {log.provider_kind === "openai" ? "OpenAI 兼容" : "Anthropic"}
                </dd>
              </div>
              <div>
                <dt>耗时</dt>
                <dd>{log.latency_ms} ms</dd>
              </div>
              <div>
                <dt>Token</dt>
                <dd>{formatNumber(log.total_tokens)}</dd>
              </div>
              <div>
                <dt>时间</dt>
                <dd>{new Date(log.created_at).toLocaleString("zh-CN")}</dd>
              </div>
            </dl>
            {log.error_message ? (
              <div className="inline-alert danger">{log.error_message}</div>
            ) : null}
            <section className="payload-card">
              <div>
                <h3>请求</h3>
                <button
                  className="text-btn"
                  onClick={() =>
                    void navigator.clipboard.writeText(
                      JSON.stringify(log.request_payload, null, 2),
                    )
                  }
                >
                  复制
                </button>
              </div>
              <pre>{JSON.stringify(log.request_payload, null, 2)}</pre>
            </section>
            <section className="payload-card">
              <div>
                <h3>响应</h3>
                <button
                  className="text-btn"
                  onClick={() =>
                    void navigator.clipboard.writeText(
                      JSON.stringify(log.response_payload, null, 2),
                    )
                  }
                >
                  复制
                </button>
              </div>
              <pre>{JSON.stringify(log.response_payload, null, 2)}</pre>
            </section>
            <section className="trace-card">
              <span>Trace ID</span>
              <code>{log.trace_id}</code>
            </section>
          </div>
        ) : (
          <p>日志不存在。</p>
        )}
        <div className="drawer-footer">
          <button className="btn danger" onClick={() => onDelete(id)}>
            删除日志
          </button>
          <button className="btn primary" onClick={onClose}>
            完成
          </button>
        </div>
      </aside>
    </div>
  );
}

export function ModelCallLogsPage() {
  const queryClient = useQueryClient();
  const [draftSearch, setDraftSearch] = useState("");
  const [filters, setFilters] = useState<LogFilters>({
    q: "",
    callSource: "",
    providerKind: "",
    model: "",
    status: "",
    from: "",
    to: "",
    page: 1,
    pageSize: 25,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const listQuery = useQuery({
    queryKey: ["model-logs", filters],
    queryFn: () => getLogs(filters),
  });
  const catalogQuery = useQuery({
    queryKey: ["model-catalog"],
    queryFn: getCatalog,
  });
  const statsQuery = useQuery({
    queryKey: ["model-log-stats"],
    queryFn: getLogStats,
  });
  const models = useMemo(
    () => [
      ...new Set(
        (catalogQuery.data?.providers ?? []).flatMap((provider) =>
          provider.models.map((model) => model.slug),
        ),
      ),
    ],
    [catalogQuery.data],
  );
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["model-logs"] }),
      queryClient.invalidateQueries({ queryKey: ["model-log-stats"] }),
    ]);
  };
  const removeOne = useMutation({
    mutationFn: deleteLog,
    onSuccess: async (_, id) => {
      setSelected((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      setDetailId(null);
      await invalidate();
    },
  });
  const removeMany = useMutation({
    mutationFn: batchDeleteLogs,
    onSuccess: async () => {
      setSelected(new Set());
      await invalidate();
    },
  });
  const setFilter = <K extends keyof LogFilters>(
    key: K,
    value: LogFilters[K],
  ) =>
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: key === "page" ? (value as number) : 1,
    }));
  const rows = listQuery.data?.items ?? [];
  const pages = Math.max(
    1,
    Math.ceil((listQuery.data?.total ?? 0) / filters.pageSize),
  );
  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const confirmOne = (id: string) => {
    if (confirm("确定删除这条调用日志？")) removeOne.mutate(id);
  };

  return (
    <section className="page logs-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">OBSERVABILITY</span>
          <h1>模型调用日志</h1>
          <p>查看模型测试的请求、回复、Token 用量与耗时。</p>
        </div>
      </header>
      <div className="stat-grid">
        {[
          ["今日调用", statsQuery.data?.calls_today, "次"],
          ["今日 Token", statsQuery.data?.total_tokens_today, ""],
          ["平均耗时", statsQuery.data?.avg_latency_ms_today, "ms"],
          ["今日失败", statsQuery.data?.errors_today, "次"],
        ].map(([label, value, unit], index) => (
          <div
            className={`stat-card${index === 3 ? " danger-stat" : ""}`}
            key={String(label)}
          >
            <span>{label}</span>
            <strong>
              {formatNumber(value as number | undefined)} <small>{unit}</small>
            </strong>
          </div>
        ))}
      </div>
      <div className="logs-card card">
        <div className="logs-toolbar">
          <form
            className="search-box"
            onSubmit={(event) => {
              event.preventDefault();
              setFilter("q", draftSearch.trim());
            }}
          >
            <span>⌕</span>
            <input
              value={draftSearch}
              onChange={(event) => setDraftSearch(event.target.value)}
              placeholder="搜索模型、日志 ID 或 Trace ID"
            />
            <button className="btn" type="submit">
              搜索
            </button>
          </form>
          <div className="filter-row">
            <CustomSelect
              ariaLabel="调用源筛选"
              value={filters.callSource}
              onChange={(value) => setFilter("callSource", value)}
              options={[
                { value: "", label: "全部调用源" },
                { value: "model_diagnostic", label: "快速诊断" },
                { value: "model_playground", label: "模型测试" },
              ]}
            />
            <CustomSelect
              ariaLabel="供应商筛选"
              value={filters.providerKind}
              onChange={(value) => setFilter("providerKind", value)}
              options={[
                { value: "", label: "全部供应商" },
                { value: "openai", label: "OpenAI 兼容" },
                { value: "anthropic", label: "Anthropic" },
              ]}
            />
            <CustomSelect
              ariaLabel="模型筛选"
              value={filters.model}
              onChange={(value) => setFilter("model", value)}
              options={[
                { value: "", label: "全部模型" },
                ...models.map((model) => ({ value: model, label: model })),
              ]}
            />
            <CustomSelect
              ariaLabel="状态筛选"
              value={filters.status}
              onChange={(value) => setFilter("status", value)}
              options={[
                { value: "", label: "全部状态" },
                { value: "success", label: "成功" },
                { value: "error", label: "失败" },
              ]}
            />
            <label className="date-filter">
              <span>从</span>
              <input
                type="date"
                value={filters.from}
                onChange={(event) => setFilter("from", event.target.value)}
              />
            </label>
            <label className="date-filter">
              <span>至</span>
              <input
                type="date"
                value={filters.to}
                onChange={(event) => setFilter("to", event.target.value)}
              />
            </label>
            <button
              className="text-btn"
              onClick={() => {
                setDraftSearch("");
                setFilters({
                  q: "",
                  callSource: "",
                  providerKind: "",
                  model: "",
                  status: "",
                  from: "",
                  to: "",
                  page: 1,
                  pageSize: 25,
                });
              }}
            >
              重置
            </button>
          </div>
        </div>
        <div className="table-meta">
          <p>
            共 <strong>{listQuery.data?.total ?? 0}</strong> 条日志
          </p>
          <button
            className="btn danger"
            disabled={!selected.size || removeMany.isPending}
            onClick={() => {
              if (confirm(`确定删除选中的 ${selected.size} 条日志？`))
                removeMany.mutate([...selected]);
            }}
          >
            批量删除{selected.size ? ` (${selected.size})` : ""}
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="全选当前页"
                    checked={
                      rows.length > 0 &&
                      rows.every((row) => selected.has(row.id))
                    }
                    onChange={(event) =>
                      rows.forEach((row) =>
                        toggle(row.id, event.target.checked),
                      )
                    }
                  />
                </th>
                <th>时间</th>
                <th>供应商</th>
                <th>调用源</th>
                <th>模型</th>
                <th>Token</th>
                <th>耗时</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.isLoading ? (
                <tr>
                  <td colSpan={9} className="table-empty">
                    加载中…
                  </td>
                </tr>
              ) : rows.length ? (
                rows.map((row: CallLogItem) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={(event) =>
                          toggle(row.id, event.target.checked)
                        }
                      />
                    </td>
                    <td>
                      <time>
                        {new Date(row.created_at).toLocaleString("zh-CN")}
                      </time>
                    </td>
                    <td>
                      {row.provider_kind === "openai"
                        ? "OpenAI 兼容"
                        : "Anthropic"}
                    </td>
                    <td>
                      <span className="source-badge">
                        {row.call_source === "model_playground"
                          ? "模型测试"
                          : "快速诊断"}
                      </span>
                    </td>
                    <td>
                      <strong>{row.model}</strong>
                      <small className="row-sub">
                        {row.trace_id.slice(0, 8)}…
                      </small>
                    </td>
                    <td>{formatNumber(row.total_tokens)}</td>
                    <td>{row.latency_ms} ms</td>
                    <td>
                      <span className={`status ${row.status}`}>
                        {row.status === "success" ? "成功" : "失败"}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="text-btn"
                          onClick={() => setDetailId(row.id)}
                        >
                          详情
                        </button>
                        <button
                          className="text-btn danger-text"
                          onClick={() => confirmOne(row.id)}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="table-empty">
                    <span>◇</span>
                    <strong>暂无调用日志</strong>
                    <small>快速诊断与模型测试产生的结果会显示在这里。</small>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <span>每页</span>
          <CustomSelect
            ariaLabel="每页条数"
            className="page-size-select"
            value={String(filters.pageSize)}
            onChange={(value) => setFilter("pageSize", Number(value))}
            options={[
              { value: "25", label: "25" },
              { value: "50", label: "50" },
              { value: "100", label: "100" },
            ]}
          />
          <button
            className="btn"
            disabled={filters.page <= 1}
            onClick={() => setFilter("page", filters.page - 1)}
          >
            上一页
          </button>
          <span>
            {filters.page} / {pages}
          </span>
          <button
            className="btn"
            disabled={filters.page >= pages}
            onClick={() => setFilter("page", filters.page + 1)}
          >
            下一页
          </button>
        </div>
      </div>
      {detailId ? (
        <LogDetail
          id={detailId}
          onClose={() => setDetailId(null)}
          onDelete={confirmOne}
        />
      ) : null}
    </section>
  );
}
