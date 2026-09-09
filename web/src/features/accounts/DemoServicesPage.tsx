import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Server, FlaskConical, PlugZap } from "lucide-react";
import { getCatalog } from "@features/models";
import { accountQueryKeys } from "./queryKeys";
import {
  actOnDemoService,
  fetchDemoServices,
  installDemoService,
  saveDemoService,
  type DemoService,
} from "./platformApi";
import { ManagementDialog, ManagementError } from "./ManagementUi";
const names = { mock_model: "Mock 模型服务", example_tools: "示例工具服务" };
export function DemoServicesPage() {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: accountQueryKeys.demoServices,
    queryFn: fetchDemoServices,
    refetchInterval: 5000,
  });
  const [editing, setEditing] = useState<DemoService | null>(null);
  const [confirm, setConfirm] = useState<{
    service: DemoService;
    action: "start" | "stop" | "reinitialize" | "install";
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const work = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setConfirm(null);
      setEditing(null);
      await query.refetch();
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="management-page">
      <header className="management-page-head">
        <div>
          <h1>服务管理</h1>
          <p>管理本地工具与模型替身，使用确定性数据验证业务流程。</p>
        </div>
      </header>
      <ManagementError error={query.error} />
      {query.isError && (
        <button className="btn" onClick={() => void query.refetch()}>
          重新加载
        </button>
      )}
      {notice && (
        <p className="inline-alert" role="status">
          {notice}
        </p>
      )}
      {query.isPending && <p className="empty-copy">正在加载服务…</p>}
      <div className="governance-services">
        {query.data?.map((service) => (
          <section
            key={service.id}
            className="management-list-panel governance-panel"
          >
            <header>
              {service.id === "mock_model" ? (
                <FlaskConical size={24} />
              ) : (
                <Server size={24} />
              )}
              <div>
                <h2>{names[service.id]}</h2>
                <p>
                  {service.id === "mock_model"
                    ? "文本回复、流式响应与工具调用"
                    : "订单查询、商品搜索与商品详情"}
                </p>
              </div>
              <span
                className={`management-status ${service.ready ? "is-active" : "is-disabled"}`}
              >
                {service.state === "reinitializing"
                  ? "正在初始化"
                  : service.ready
                    ? "运行中"
                    : "已停用"}
              </span>
            </header>
            <div className="governance-service-body">
              <p>
                当前调用 {service.active_calls} · 配置版本 {service.revision}
              </p>
              <div className="button-row">
                <button
                  className="btn primary"
                  onClick={() => {
                    setError(null);
                    setConfirm({
                      service,
                      action: service.value.enabled ? "stop" : "start",
                    });
                  }}
                >
                  {service.value.enabled ? "停用" : "启用"}
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setError(null);
                    setConfirm({ service, action: "reinitialize" });
                  }}
                >
                  重新初始化
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setError(null);
                    setEditing(service);
                  }}
                >
                  配置
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setError(null);
                    setConfirm({ service, action: "install" });
                  }}
                >
                  <PlugZap size={15} />
                  接入当前工作区
                </button>
              </div>
              <details className="governance-logs">
                <summary>最近服务记录</summary>
                {service.logs.length ? (
                  service.logs.map((line, index) => (
                    <div key={index}>
                      <time>{new Date(line.time).toLocaleTimeString()}</time>{" "}
                      {line.message}
                    </div>
                  ))
                ) : (
                  <p>暂无运行记录。</p>
                )}
              </details>
            </div>
          </section>
        ))}
      </div>
      {editing && (
        <ManagementDialog
          title={`配置${names[editing.id]}`}
          pending={busy}
          close={() => setEditing(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void work(() =>
                saveDemoService(editing.id, {
                  expected_revision: editing.revision,
                  value: editing.value,
                }),
              );
            }}
          >
            <label>
              确定性延迟（毫秒）
              <input
                type="number"
                min={0}
                max={30000}
                required
                value={editing.value.delay_ms}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    value: {
                      ...editing.value,
                      delay_ms: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
            {editing.id === "mock_model" && (
              <label>
                固定回复
                <textarea
                  maxLength={2000}
                  value={editing.value.response_text}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      value: {
                        ...editing.value,
                        response_text: e.target.value,
                      },
                    })
                  }
                />
              </label>
            )}
            <button
              className={`governance-switch ${editing.value.failure ? "is-on" : ""}`}
              type="button"
              role="switch"
              aria-checked={editing.value.failure}
              aria-label="模拟失败"
              onClick={() =>
                setEditing({
                  ...editing,
                  value: { ...editing.value, failure: !editing.value.failure },
                })
              }
            >
              <span />
            </button>
            <span> 模拟失败</span>
            <ManagementError error={error} />
            <footer>
              <button
                className="btn"
                type="button"
                onClick={() => setEditing(null)}
              >
                取消
              </button>
              <button className="btn primary" disabled={busy}>
                保存配置
              </button>
            </footer>
          </form>
        </ManagementDialog>
      )}
      {confirm && (
        <ManagementDialog
          title={
            confirm.action === "install" ? "接入当前工作区" : "更改服务状态"
          }
          pending={busy}
          close={() => setConfirm(null)}
        >
          <p>
            {confirm.action === "install"
              ? "将在当前工作区创建演示连接或工具配置。"
              : confirm.action === "reinitialize"
                ? "停止接收新调用，等待当前调用结束后重新加载。"
                : `确认${confirm.action === "start" ? "启用" : "停用"}${names[confirm.service.id]}？`}
          </p>
          <ManagementError error={error} />
          <footer>
            <button className="btn" onClick={() => setConfirm(null)}>
              取消
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  if (confirm.action === "install") {
                    const catalog = await getCatalog();
                    const result = await installDemoService(
                      confirm.service.id,
                      catalog.revision,
                    );
                    setNotice(result.message);
                    await cache.invalidateQueries();
                  } else
                    await actOnDemoService(confirm.service.id, {
                      expected_revision: confirm.service.revision,
                      action: confirm.action,
                    });
                })
              }
            >
              确认
            </button>
          </footer>
        </ManagementDialog>
      )}
    </section>
  );
}
