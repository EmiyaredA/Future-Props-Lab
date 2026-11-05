import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@platform/api/client";
import { useRuntimeAccess } from "../useRuntimeAccess";
import { accountQueryKeys } from "../queryKeys";
import { reauthenticate } from "../api";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { ManagementDialog } from "../ManagementUi";
import { useCommandReceipt, type Command } from "./commandReceipt";
import "./runtime.css";

const phases: Record<string, string> = {
  unavailable: "等待 Mac 管理 worker",
  stopped: "已停止",
  starting: "正在启动",
  running: "运行中",
  stopping: "正在停止",
  failed: "失败",
  off: "已关闭",
  connecting: "正在连接",
  ready: "已就绪",
  reconnecting: "正在重连",
};
const labels: Record<string, string> = {
  start: "启动应用",
  stop: "停止应用",
  restart: "重启应用",
  force_stop: "强制停止",
  public_start: "开启公网",
  public_stop: "关闭公网",
  check: "检查连接",
};

export function RuntimePage({
  section,
  ownerId,
}: {
  section: "application" | "access";
  ownerId: string;
}) {
  const local = useRuntimeAccess();
  const {
    receipt: pendingReceipt,
    remember: rememberReceipt,
    clear: clearReceipt,
  } = useCommandReceipt(ownerId);
  const cache = useQueryClient();
  const application = useQuery({
    queryKey: accountQueryKeys.managementApplication,
    queryFn: async () => unwrap(await api.GET("/v1/management/application")),
    refetchInterval: 5000,
  });
  const business = useQuery({
    queryKey: accountQueryKeys.managementAccess("business"),
    queryFn: async () =>
      unwrap(
        await api.GET("/v1/management/access/{target}", {
          params: { path: { target: "business" } },
        }),
      ),
    refetchInterval: 5000,
  });
  const management = useQuery({
    queryKey: accountQueryKeys.managementAccess("management"),
    queryFn: async () =>
      unwrap(
        await api.GET("/v1/management/access/{target}", {
          params: { path: { target: "management" } },
        }),
      ),
    refetchInterval: 5000,
  });
  const [confirm, setConfirm] = useState<Command | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState(pendingReceipt?.jobId || "");
  const [reauth, setReauth] = useState<Command | null>(null);
  const [password, setPassword] = useState("");
  const [logReauth, setLogReauth] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const logs = useQuery({
    queryKey: accountQueryKeys.managementLogs,
    queryFn: async () =>
      unwrap(await api.GET("/v1/management/application/logs")),
    enabled: local && showLogs,
    retry: false,
  });
  const job = useQuery({
    queryKey: accountQueryKeys.managementJob(jobId),
    queryFn: async () =>
      unwrap(
        await api.GET("/v1/management/jobs/{job_id}", {
          params: { path: { job_id: jobId } },
        }),
      ),
    enabled: !!jobId,
    refetchInterval: (query) =>
      ["queued", "leased"].includes(query.state.data?.status ?? "queued")
        ? 1000
        : false,
  });
  useEffect(() => {
    if (job.data && !["queued", "leased"].includes(job.data.status)) {
      clearReceipt();
      void cache.invalidateQueries({ queryKey: accountQueryKeys.management });
    }
  }, [job.data, cache, clearReceipt]);
  const active =
    pending ||
    (!!pendingReceipt && !jobId) ||
    (!!jobId && (!job.data || ["queued", "leased"].includes(job.data.status)));
  const perform = async (command: Command, existingId?: string) => {
    setConfirm(null);
    setPending(true);
    setError("");
    setJobId("");
    try {
      const request_id = existingId || crypto.randomUUID();
      rememberReceipt({ command, requestId: request_id });
      const result =
        command.kind === "application"
          ? await unwrap(
              await api.POST("/v1/management/application/actions", {
                body: { request_id, action: command.action },
              }),
            )
          : await unwrap(
              await api.POST("/v1/management/access/{target}/actions", {
                params: { path: { target: command.target } },
                body: { request_id, action: command.action },
              }),
            );
      rememberReceipt({ command, requestId: request_id, jobId: result.id });
      setJobId(result.id);
      setReauth(null);
      setPassword("");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "操作失败";
      if (message.includes("reauthentication_required")) setReauth(command);
      else setError(message);
    } finally {
      setPending(false);
    }
  };
  const phase = application.data?.phase ?? "unavailable";
  return (
    <section className="management-page management-runtime">
      <header className="management-page-head">
        <div>
          <h1>{section === "application" ? "应用运行" : "访问管理"}</h1>
          <p>
            {section === "application"
              ? "业务应用停止后，管理中台与账号治理继续运行。"
              : "业务应用与管理中台使用各自的公网入口。"}
          </p>
        </div>
      </header>
      {!local && (
        <p className="inline-alert">
          主机启停、日志与隧道控制仅支持本机管理入口。
        </p>
      )}
      {error && (
        <p role="alert" className="inline-alert danger">
          {error}
        </p>
      )}
      {[application.error, business.error, management.error].some(Boolean) && (
        <p role="alert">读取管理状态失败，请检查管理服务后重试。</p>
      )}
      {pendingReceipt && !jobId && !pending && !reauth && (
        <p role="status">
          操作结果尚未确认。
          <button
            className="btn"
            onClick={() => {
              const value = pendingReceipt;
              if (value) void perform(value.command, value.requestId);
            }}
          >
            核对操作回执
          </button>
        </p>
      )}
      {job.data && (
        <p role="status">
          {["queued", "leased"].includes(job.data.status)
            ? "命令已接受，正在等待本机执行…"
            : job.data.status === "completed"
              ? "操作已完成"
              : "操作结果未确认或失败；系统不会自动重复执行。请检查状态与日志。"}
        </p>
      )}
      {section === "application" ? (
        <div className="management-list-panel governance-panel">
          <h2>主应用</h2>
          <p role="status">{phases[phase]}</p>
          {application.data?.error && (
            <p role="alert">{application.data.error}</p>
          )}
          {local && (
            <div className="button-row">
              {(["start", "stop", "restart"] as const).map((action) => (
                <button
                  className="btn"
                  key={action}
                  disabled={
                    active ||
                    phase === "unavailable" ||
                    (action === "start" && phase === "running")
                  }
                  onClick={() => setConfirm({ kind: "application", action })}
                >
                  {labels[action]}
                </button>
              ))}
              {application.data?.force_stop_available && (
                <button
                  className="btn danger"
                  disabled={active}
                  onClick={() =>
                    setConfirm({ kind: "application", action: "force_stop" })
                  }
                >
                  强制停止
                </button>
              )}
              <button className="btn" onClick={() => setShowLogs(!showLogs)}>
                {showLogs ? "收起日志" : "查看应用日志"}
              </button>
            </div>
          )}
          {showLogs && local && (
            <div className="management-runtime-logs">
              <button
                className="btn"
                onClick={() => void logs.refetch()}
                disabled={logs.isFetching}
              >
                刷新日志
              </button>
              {logs.error && (
                <p role="alert">
                  {logs.error.message.includes("reauthentication_required") ? (
                    <button className="btn" onClick={() => setLogReauth(true)}>
                      重新验证身份以查看日志
                    </button>
                  ) : (
                    "日志暂不可用，请检查本机管理 worker。"
                  )}
                </p>
              )}
              <pre tabIndex={0} aria-label="应用日志">
                {logs.data?.lines.join("\n") || "暂无日志"}
              </pre>
            </div>
          )}
        </div>
      ) : (
        <div className="governance-services">
          {(
            [
              ["business", "业务应用", business.data],
              ["management", "管理中台", management.data],
            ] as const
          ).map(([target, title, data]) => (
            <section
              className="management-list-panel governance-panel"
              key={target}
            >
              <h2>{title}</h2>
              <p>{data?.url || "尚未配置公网地址"}</p>
              <p role="status">{phases[data?.phase ?? "unavailable"]}</p>
              {data?.error && <p role="alert">{data.error}</p>}
              {local && (
                <div className="button-row">
                  {(["check", "public_start", "public_stop"] as const).map(
                    (action) => (
                      <button
                        key={action}
                        className="btn"
                        disabled={
                          active || data?.phase === "unavailable" || !data?.url
                        }
                        onClick={() =>
                          setConfirm({ kind: "access", target, action })
                        }
                      >
                        {labels[action]}
                      </button>
                    ),
                  )}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!confirm}
        title={confirm ? `确认${labels[confirm.action]}？` : "确认操作"}
        description={
          confirm?.action === "force_stop"
            ? "强制终止尚未退出的业务服务，未完成任务将按各应用的恢复规则处理。"
            : "操作由本机管理 worker 执行，管理中台保持运行。"
        }
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void perform(confirm);
        }}
      />
      {(reauth || logReauth) && (
        <ManagementDialog
          title="重新验证管理员身份"
          close={() => {
            if (reauth) clearReceipt();
            setReauth(null);
            setLogReauth(false);
            setPassword("");
          }}
          pending={pending}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setPending(true);
              void reauthenticate(password)
                .then(async () => {
                  if (logReauth) {
                    setLogReauth(false);
                    setPassword("");
                    await logs.refetch();
                  } else if (reauth) {
                    await perform(reauth, pendingReceipt?.requestId);
                  }
                })
                .catch(() => setError("密码验证失败，请重试"))
                .finally(() => setPending(false));
            }}
          >
            <label>
              当前密码
              <input
                autoFocus
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button className="btn primary" disabled={pending}>
              验证并执行
            </button>
          </form>
        </ManagementDialog>
      )}
    </section>
  );
}
