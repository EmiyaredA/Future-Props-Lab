import { useMemo, useState } from "react";
import "@features/models/models.css";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  batchDeleteLogs,
  deleteLog,
  getCatalog,
  getLogs,
  getLogStats,
  type CallLogItem,
  type LogFilters,
} from "@features/models/api";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { CustomDateInput } from "@shared/ui/CustomDateInput";
import { CustomSelect } from "@shared/ui/CustomSelect";
import {
  logProviderKindOptions,
  providerLabels,
} from "@features/models/logs/logOptions";
import { modelQueryKeys } from "@features/models/queryKeys";
import { LogDetail } from "@features/models/logs/ModelCallLogDetail";
import {
  formatNumber,
  sourceLabels,
  type DeleteTarget,
} from "@features/models/logs/modelCallLogPresentation";

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
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const listQuery = useQuery({
    queryKey: modelQueryKeys.logList(filters),
    queryFn: () => getLogs(filters),
  });
  const catalogQuery = useQuery({
    queryKey: modelQueryKeys.catalog,
    queryFn: getCatalog,
  });
  const statsQuery = useQuery({
    queryKey: modelQueryKeys.logStats,
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
      queryClient.invalidateQueries({ queryKey: modelQueryKeys.logs }),
      queryClient.invalidateQueries({ queryKey: modelQueryKeys.logStats }),
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
      setDeleteTarget(null);
      await invalidate();
    },
  });
  const removeMany = useMutation({
    mutationFn: batchDeleteLogs,
    onSuccess: async () => {
      setSelected(new Set());
      setDeleteTarget(null);
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
    setDeleteTarget({ kind: "single", ids: [id] });
  };

  return (
    <section className="page logs-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">OBSERVABILITY</span>
          <h1>模型调用日志</h1>
          <p>查看各类模型调用的消息链、Token 用量、耗时与原始数据。</p>
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
                { value: "visual_workshop_assistant", label: "视觉助手" },
              ]}
            />
            <CustomSelect
              ariaLabel="供应商筛选"
              value={filters.providerKind}
              onChange={(value) => setFilter("providerKind", value)}
              options={logProviderKindOptions}
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
              <CustomDateInput
                ariaLabel="开始日期"
                value={filters.from}
                onChange={(value) => setFilter("from", value)}
              />
            </label>
            <label className="date-filter">
              <span>至</span>
              <CustomDateInput
                ariaLabel="结束日期"
                value={filters.to}
                onChange={(value) => setFilter("to", value)}
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
            onClick={() =>
              setDeleteTarget({ kind: "batch", ids: [...selected] })
            }
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
                      {providerLabels[row.provider_kind] ?? row.provider_kind}
                    </td>
                    <td>
                      <span className="source-badge">
                        {sourceLabels[row.call_source] ?? row.call_source}
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
                    <small>
                      快速诊断、模型测试与视觉助手产生的结果会显示在这里。
                    </small>
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
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget?.kind === "batch" ? "批量删除日志" : "删除调用日志"}
        description={
          deleteTarget?.kind === "batch"
            ? `将永久删除选中的 ${deleteTarget.ids.length} 条调用日志，此操作无法撤销。`
            : "将永久删除这条调用日志及其请求与响应详情，此操作无法撤销。"
        }
        confirmLabel={
          deleteTarget?.kind === "batch"
            ? `删除 ${deleteTarget.ids.length} 条日志`
            : "删除日志"
        }
        pending={removeOne.isPending || removeMany.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          if (deleteTarget.kind === "batch")
            removeMany.mutate(deleteTarget.ids);
          else removeOne.mutate(deleteTarget.ids[0]);
        }}
      />
    </section>
  );
}
