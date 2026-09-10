import { useEffect, useMemo, useState } from "react";
import "@features/models/models.css";
import "./call-logs.css";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useLogWorkspaceScope,
  useCrossWorkspaceLogQueries,
} from "@features/accounts";
import { useWorkspacePermission } from "@platform/auth/WorkspacePermissions";
import {
  batchDeleteLogs,
  deleteLog,
  getCatalog,
  getLogs,
  getLogStats,
  type LogFilters,
} from "@features/models/api";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { accountQueryKeys } from "@features/accounts";
import { modelQueryKeys } from "@features/models/queryKeys";
import { LogDetail } from "./ModelCallLogDetail";
import {
  emptyLogFilters,
  formatNumber,
  type DeleteTarget,
} from "./modelCallLogPresentation";
import { LogToolbar, LogFilterDrawer } from "./LogFilters";
import { LogTable, LogPagination } from "./LogTable";

type Scope = ReturnType<typeof useLogWorkspaceScope>;
export function ModelCallLogsPage({
  currentWorkspace,
}: {
  currentWorkspace: { id: string; name: string };
}) {
  const scope = useLogWorkspaceScope(currentWorkspace);
  const canDelete = useWorkspacePermission("configuration.manage");
  const [filters, setFilters] = useState<LogFilters>(emptyLogFilters);
  const [lastScope, setLastScope] = useState(scope.scope);
  if (lastScope !== scope.scope) {
    setLastScope(scope.scope);
    setFilters((current) => ({ ...current, model: "", page: 1 }));
  }
  return (
    <LogsContent
      key={`${currentWorkspace.id}:${scope.scope}:${scope.ids.join(",")}:${canDelete}:${scope.allowed}`}
      filters={filters}
      setFilters={setFilters}
      scope={scope}
      currentWorkspaceId={currentWorkspace.id}
      canDelete={canDelete && scope.local}
    />
  );
}
function LogError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="call-log-error" role="alert">
      <span>{error instanceof Error ? error.message : "读取失败，请重试"}</span>
      <button className="btn" onClick={retry}>
        重试
      </button>
    </div>
  );
}
function LogsContent({
  scope,
  filters,
  setFilters,
  currentWorkspaceId,
  canDelete,
}: {
  scope: Scope;
  filters: LogFilters;
  setFilters: React.Dispatch<React.SetStateAction<LogFilters>>;
  currentWorkspaceId: string;
  canDelete: boolean;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [drawer, setDrawer] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);
  const localList = useQuery({
    queryKey: modelQueryKeys.logList({
      workspace: currentWorkspaceId,
      ...filters,
    }),
    queryFn: () => getLogs(filters),
    enabled: scope.local,
  });
  const catalog = useQuery({
    queryKey: modelQueryKeys.catalog,
    queryFn: getCatalog,
    enabled: scope.local,
  });
  const localStats = useQuery({
    queryKey: [...modelQueryKeys.logStats, currentWorkspaceId],
    queryFn: getLogStats,
    enabled: scope.local,
  });
  const cross = useCrossWorkspaceLogQueries(
    scope.ids,
    filters,
    !scope.local && !scope.spaces.isError && !scope.spaces.isPending,
  );
  const list = scope.local ? localList : cross.list;
  const stats = scope.local ? localStats : cross.stats;
  const models = useMemo(
    () =>
      scope.local
        ? [
            ...new Set(
              (catalog.data?.providers ?? []).flatMap((provider) =>
                provider.models.map((model) => model.slug),
              ),
            ),
          ].sort()
        : (cross.list.data?.model_options ?? []),
    [scope.local, catalog.data, cross.list.data],
  );
  const scopeError = !scope.local && scope.spaces.isError;
  const total = scopeError ? 0 : (list.data?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / filters.pageSize));
  useEffect(() => {
    if (list.isSuccess && filters.page > pages)
      setFilters((current) => ({ ...current, page: pages }));
  }, [list.isSuccess, filters.page, pages, setFilters]);
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: modelQueryKeys.logs }),
      queryClient.invalidateQueries({ queryKey: modelQueryKeys.logStats }),
      queryClient.invalidateQueries({
        queryKey: accountQueryKeys.crossLogsRoot,
      }),
      queryClient.invalidateQueries({
        queryKey: accountQueryKeys.crossLogStatsRoot,
      }),
    ]);
  };
  const removed = async () => {
    setSelected(new Set());
    setDetailId(null);
    setDeleteTarget(null);
    await invalidate();
  };
  const removeOne = useMutation({ mutationFn: deleteLog, onSuccess: removed });
  const removeMany = useMutation({
    mutationFn: batchDeleteLogs,
    onSuccess: removed,
  });
  const pending = removeOne.isPending || removeMany.isPending;
  const deletionError = removeOne.error || removeMany.error;
  const confirmOne = (id: string) => {
    if (!canDelete) return;
    removeOne.reset();
    removeMany.reset();
    setDeleteTarget({ kind: "single", ids: [id] });
  };
  const apply = (next: LogFilters) => {
    setFilters(next);
    setSelected(new Set());
  };
  const reset = () => {
    setResetVersion((value) => value + 1);
    apply({ ...emptyLogFilters, pageSize: filters.pageSize });
    setDrawer(false);
  };
  const retry = () => {
    void list.refetch();
  };
  return (
    <section className="page logs-page call-logs-page">
      <header className="page-header">
        <div>
          <h1>模型调用日志</h1>
          <p>查看模型调用的消息链、Token 用量、耗时与原始数据。</p>
        </div>
      </header>
      <div
        className="stat-grid"
        aria-label="所选工作区今日统计（UTC），不受列表筛选影响"
        title="所选工作区今日数据，按 UTC 计算，不受列表筛选影响"
      >
        {[
          ["今日调用", stats.data?.calls_today, "次"],
          ["今日 Token", stats.data?.total_tokens_today, ""],
          ["平均耗时", stats.data?.avg_latency_ms_today, "ms"],
          ["今日失败", stats.data?.errors_today, "次"],
        ].map(([label, value, unit], index) => (
          <div
            className={`stat-card${index === 3 ? " danger-stat" : ""}`}
            key={String(label)}
          >
            <span>{label}</span>
            <strong>
              {stats.isError || scopeError
                ? "—"
                : stats.isPending
                  ? "…"
                  : formatNumber(value as number | undefined)}{" "}
              <small>{unit}</small>
            </strong>
          </div>
        ))}
      </div>
      <p className="call-log-stats-note">所选工作区 · 今日数据（UTC）</p>
      {stats.isError && (
        <LogError
          error={stats.error}
          retry={() => {
            void stats.refetch();
          }}
        />
      )}
      <div className="call-log-card card">
        <LogToolbar
          resetVersion={resetVersion}
          filters={filters}
          models={models}
          onChange={apply}
          scope={scope.scope}
          options={scope.options}
          onScopeChange={scope.setScope}
          showScope={scope.allowed}
          onOpen={() => setDrawer(true)}
        />
        {scope.allowed && scope.spaces.isError && (
          <LogError
            error={scope.spaces.error}
            retry={() => {
              void scope.spaces.refetch();
            }}
          />
        )}
        {scope.local && catalog.isError && (
          <LogError
            error={catalog.error}
            retry={() => {
              void catalog.refetch();
            }}
          />
        )}
        <div className="table-meta">
          <p>
            共 <strong>{list.isError ? "—" : formatNumber(total)}</strong>{" "}
            条调用日志
            {!scope.local && (
              <span className="call-log-readonly">只读概况</span>
            )}
          </p>
          {canDelete && (
            <button
              className="btn danger"
              disabled={!selected.size || pending}
              onClick={() => {
                removeOne.reset();
                removeMany.reset();
                setDeleteTarget({ kind: "batch", ids: [...selected] });
              }}
            >
              批量删除{selected.size > 0 ? `（${selected.size}）` : ""}
            </button>
          )}
        </div>
        {scopeError ? (
          <div className="call-log-empty">
            工作区范围暂不可用，请重试或重新选择。
          </div>
        ) : list.isError ? (
          <LogError error={list.error} retry={retry} />
        ) : list.isPending ? (
          <div className="call-log-empty" role="status">
            正在读取调用记录…
          </div>
        ) : !list.data?.items.length ? (
          <div className="call-log-empty">
            <strong>暂无调用日志</strong>
            <p>调整筛选条件，或在模型测试及工坊中发起调用。</p>
          </div>
        ) : (
          <LogTable
            rows={list.data.items}
            local={scope.local}
            all={scope.all}
            canDelete={canDelete}
            workspaces={scope.spaces.data ?? []}
            selected={selected}
            onSelect={(ids, on) =>
              setSelected((current) => {
                const next = new Set(current);
                ids.forEach((id) => {
                  if (on) next.add(id);
                  else next.delete(id);
                });
                return next;
              })
            }
            onView={setDetailId}
            onDelete={confirmOne}
          />
        )}
        <LogPagination
          total={total}
          page={filters.page}
          pageSize={filters.pageSize}
          onPage={(page) => apply({ ...filters, page })}
          onSize={(pageSize) => apply({ ...filters, pageSize, page: 1 })}
        />
      </div>
      {drawer && (
        <LogFilterDrawer
          filters={filters}
          models={models}
          onChange={apply}
          onClose={() => setDrawer(false)}
          onReset={reset}
        />
      )}
      {scope.local && detailId && (
        <LogDetail
          id={detailId}
          onClose={() => setDetailId(null)}
          onDelete={confirmOne}
        />
      )}
      <ConfirmDialog
        open={!!deleteTarget && canDelete}
        title={deleteTarget?.kind === "batch" ? "批量删除日志" : "删除调用日志"}
        description={
          deletionError
            ? `删除失败：${deletionError.message}。可以重试。`
            : `将永久删除 ${deleteTarget?.ids.length ?? 1} 条日志及其请求与响应详情，此操作无法撤销。`
        }
        confirmLabel={deletionError ? "重试删除" : "删除日志"}
        pending={pending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget || !canDelete) return;
          if (deleteTarget.kind === "batch")
            removeMany.mutate(deleteTarget.ids);
          else removeOne.mutate(deleteTarget.ids[0]);
        }}
      />
    </section>
  );
}
