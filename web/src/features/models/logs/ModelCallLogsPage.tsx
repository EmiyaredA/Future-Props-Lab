import { LoadingState } from "@shared/ui/LoadingState";
import { useEffect, useMemo, useState } from "react";
import "@features/models/models.css";
import "./call-logs.css";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountQueryKeys, listApiKeys } from "@features/accounts";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import {
  batchDeleteLogs,
  deleteLog,
  getCatalog,
  getLogs,
  getLogStats,
  type LogFilters,
} from "@features/models/api";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { modelQueryKeys } from "@features/models/queryKeys";
import { LogDetail } from "./ModelCallLogDetail";
import {
  emptyLogFilters,
  formatNumber,
  type DeleteTarget,
} from "./modelCallLogPresentation";
import { LogToolbar, LogFilterDrawer } from "./LogFilters";
import { LogTable, LogPagination } from "./LogTable";

export function ModelCallLogsPage({
  currentAccount,
}: {
  currentAccount: { id: string; name: string };
}) {
  const canDelete = useAccountPermission("configuration.manage");
  const [filters, setFilters] = useState<LogFilters>(emptyLogFilters);
  return (
    <LogsContent
      key={currentAccount.id}
      filters={filters}
      setFilters={setFilters}
      currentAccountId={currentAccount.id}
      canDelete={canDelete}
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
  filters,
  setFilters,
  currentAccountId,
  canDelete,
}: {
  filters: LogFilters;
  setFilters: React.Dispatch<React.SetStateAction<LogFilters>>;
  currentAccountId: string;
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
      account: currentAccountId,
      ...filters,
    }),
    queryFn: () => getLogs(filters),
  });
  const catalog = useQuery({
    queryKey: modelQueryKeys.catalog,
    queryFn: getCatalog,
  });
  const localStats = useQuery({
    queryKey: [...modelQueryKeys.logStats, currentAccountId],
    queryFn: getLogStats,
  });
  const keys = useQuery({
    queryKey: [...accountQueryKeys.root, "api-keys", currentAccountId],
    queryFn: listApiKeys,
  });
  const credentialOptions = useMemo(
    () =>
      (keys.data ?? []).map((key) => ({
        value: key.id,
        label: `${key.name} · ${key.key_prefix}…`,
      })),
    [keys.data],
  );
  const list = localList;
  const stats = localStats;
  const models = useMemo(
    () =>
      [
        ...new Set(
          (catalog.data?.providers ?? []).flatMap((provider) =>
            provider.models.map((model) => model.slug),
          ),
        ),
      ].sort(),
    [catalog.data],
  );
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / filters.pageSize));
  useEffect(() => {
    if (list.isSuccess && filters.page > pages)
      setFilters((current) => ({ ...current, page: pages }));
  }, [list.isSuccess, filters.page, pages, setFilters]);
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: modelQueryKeys.logs }),
      queryClient.invalidateQueries({ queryKey: modelQueryKeys.logStats }),
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
        aria-label="当前账号今日统计（UTC），不受列表筛选影响"
        title="当前账号今日数据，按 UTC 计算，不受列表筛选影响"
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
              {stats.isError
                ? "—"
                : stats.isPending
                  ? "…"
                  : formatNumber(value as number | undefined)}{" "}
              <small>{unit}</small>
            </strong>
          </div>
        ))}
      </div>
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
          credentialOptions={credentialOptions}
          onChange={apply}
          onOpen={() => setDrawer(true)}
        />
        {catalog.isError && (
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
        {list.isError ? (
          <LogError error={list.error} retry={retry} />
        ) : list.isPending ? (
          <LoadingState
            label="正在读取调用记录…"
            variant="region"
            className="call-log-empty"
          />
        ) : !list.data?.items.length ? (
          <div className="call-log-empty">
            <strong>暂无调用日志</strong>
            <p>调整筛选条件，或在模型测试及工坊中发起调用。</p>
          </div>
        ) : (
          <LogTable
            rows={list.data.items}
            canDelete={canDelete}
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
          credentialOptions={credentialOptions}
          onChange={apply}
          onClose={() => setDrawer(false)}
          onReset={reset}
        />
      )}
      {detailId && (
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
