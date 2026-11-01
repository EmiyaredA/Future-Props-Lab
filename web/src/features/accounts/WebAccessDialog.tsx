import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Copy, ExternalLink, RefreshCw, X } from "lucide-react";
import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";
import { reauthenticate } from "./api";
import "./web-access.css";

type Config = components["schemas"]["AccessConfigOut"];
type Status = components["schemas"]["AccessStatus"];
type Profile = components["schemas"]["GatewayProfile"];
type Action = components["schemas"]["AccessAction"]["action"];
const phases = {
  off: "已关闭",
  starting: "启动中",
  ready: "正常",
  connecting: "连接中",
  reconnecting: "重连中",
  failed: "失败",
};
const bytes = (value: number) => `${(value / 1024 / 1024).toFixed(2)} MiB`;

export default function WebAccessDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<Status>();
  const [config, setConfig] = useState<Config>();
  const [profile, setProfile] = useState<Profile>();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const stopped =
    !!status &&
    ["off", "failed"].includes(status.local.phase) &&
    ["off", "failed"].includes(status.public.phase);
  const dirty =
    !!config && JSON.stringify(profile) !== JSON.stringify(config.profile);

  const refresh = useCallback(async () => {
    setStatus(await unwrap(await api.GET("/v1/desktop/web-access")));
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.all([
      api.GET("/v1/desktop/web-access").then(unwrap),
      api.GET("/v1/desktop/web-access/config").then(unwrap),
    ])
      .then(([s, c]) => {
        if (active) {
          setStatus(s);
          setConfig(c);
          setProfile(c.profile);
        }
      })
      .catch((cause) => {
        if (active) setError(String(cause.message || cause));
      });
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh().catch(() => undefined);
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  async function run(label: string, operation: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请重试");
    } finally {
      setBusy("");
      setPassword("");
    }
  }
  async function verify() {
    if (password) await reauthenticate(password);
  }
  function action(value: Action) {
    void run("正在更新访问状态…", async () => {
      if (value === "public_start") await verify();
      setStatus(
        await unwrap(
          await api.POST("/v1/desktop/web-access/actions", {
            body: { action: value },
          }),
        ),
      );
    });
  }
  async function importCredential(kind: "identity" | "known_hosts") {
    await verify();
    const { ticket } = await unwrap(
      await api.POST("/v1/desktop/web-access/credentials/tickets", {
        body: { kind },
      }),
    );
    const result = await window.futurePropsDesktop?.pickWebCredential?.(
      ticket,
      kind,
    );
    if (result) {
      setProfile(
        (current) =>
          current && {
            ...current,
            [kind === "identity" ? "identity_id" : "known_hosts_id"]: result.id,
          },
      );
      setConfig(
        (current) =>
          current && {
            ...current,
            [kind === "identity"
              ? "identity_fingerprint"
              : "known_hosts_fingerprint"]: result.fingerprint,
          },
      );
      setNotice("凭据已导入，请保存连接配置。");
    }
  }
  async function apply(adopt = false) {
    if (!config || !profile) return;
    await verify();
    const receipt = adopt
      ? await unwrap(
          await api.POST("/v1/desktop/web-access/config/adopt-legacy"),
        )
      : await unwrap(
          await api.PUT("/v1/desktop/web-access/config", {
            body: { expected_revision: config.revision, profile },
          }),
        );
    setBusy("正在停机备份并应用配置，请保持应用开启…");
    await window.futurePropsDesktop?.applyWebAccessConfig?.(
      receipt.apply_receipt,
    );
  }
  const update = (key: keyof Profile, value: string | number) =>
    setProfile((current) => current && { ...current, [key]: value });
  const close = () => {
    if (!busy && !dirty) onClose();
    else if (!busy) setNotice("连接配置尚未保存。请保存，或点击“放弃更改”。");
  };
  return (
    <Dialog.Root
      open
      modal={!busy}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="web-access-overlay" />
        {busy && (
          <div
            className="web-access-overlay"
            style={{ zIndex: 1100 }}
            aria-hidden="true"
          />
        )}
        <Dialog.Content
          className="web-access-panel"
          style={{ zIndex: busy ? 1101 : 1201 }}
          aria-busy={!!busy}
          onEscapeKeyDown={(event) => {
            if (!busy && dirty) {
              event.preventDefault();
              close();
            }
          }}
        >
          <header>
            <div>
              <Dialog.Title>本地与公网访问</Dialog.Title>
              <Dialog.Description>
                共用这台 Mac 的账号、数据库与素材。每次启动 App 后默认关闭。
              </Dialog.Description>
            </div>
            <button
              className="icon-btn"
              aria-label="关闭访问面板"
              disabled={!!busy}
              onClick={close}
            >
              <X />
            </button>
          </header>
          {error && (
            <p role="alert" className="web-access-error">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {busy && (
            <p role="status" aria-live="polite">
              {busy}
            </p>
          )}
          {!status && (
            <button
              className="btn"
              onClick={() => void run("正在重新检测…", refresh)}
            >
              重新检测
            </button>
          )}
          {status && (
            <>
              <div className="web-access-endpoints">
                {(["local", "public"] as const).map((kind) => {
                  const endpoint = status[kind];
                  const isLocal = kind === "local";
                  const off =
                    endpoint.phase === "off" || endpoint.phase === "failed";
                  return (
                    <section key={kind} className="web-access-endpoint">
                      <div className="web-access-heading">
                        <h3>{isLocal ? "本地 Web" : "公网隧道"}</h3>
                        <span data-phase={endpoint.phase}>
                          {phases[endpoint.phase]}
                        </span>
                      </div>
                      <p className="web-access-address">
                        {endpoint.url || "尚未配置"}
                      </p>
                      <small>
                        最近检测：
                        {endpoint.last_checked_at
                          ? new Date(endpoint.last_checked_at).toLocaleString()
                          : "尚未检测"}
                      </small>
                      {endpoint.error && (
                        <p role="status" className="web-access-error">
                          {endpoint.error}
                        </p>
                      )}
                      <div className="web-access-actions">
                        <button
                          className={`btn ${off ? "primary" : ""}`}
                          disabled={!!busy || dirty}
                          onClick={() =>
                            action(
                              isLocal
                                ? off
                                  ? "local_start"
                                  : "local_stop"
                                : off
                                  ? "public_start"
                                  : "public_stop",
                            )
                          }
                        >
                          {off ? "开启" : "停止"}
                        </button>
                        <button
                          className="btn"
                          disabled={!endpoint.url || !!busy}
                          aria-label={`复制${isLocal ? "本地" : "公网"}地址`}
                          onClick={() =>
                            void run("正在复制…", async () => {
                              await navigator.clipboard.writeText(endpoint.url);
                              setNotice("地址已复制");
                            })
                          }
                        >
                          <Copy size={15} />
                          复制地址
                        </button>
                        {endpoint.url && endpoint.phase === "ready" && (
                          <a
                            className="btn"
                            href={endpoint.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink size={15} />
                            打开浏览器
                          </a>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
              <div className="web-access-summary">
                <span>
                  本次转发正文：接收 {bytes(status.bytes_received)} · 发送{" "}
                  {bytes(status.bytes_sent)} · {status.requests} 次请求
                </span>
                <button
                  className="btn"
                  disabled={!!busy}
                  onClick={() => action("check")}
                >
                  <RefreshCw size={15} />
                  重新检测
                </button>
              </div>
              <p className="web-access-help">
                开启公网会同时开启本地 Web；停止本地 Web
                会断开公网连接。已提交的后台任务继续执行。关闭窗口可继续运行，退出
                App 会停止访问。
              </p>
            </>
          )}
          <label className="web-access-verify">
            敏感操作验证（需要时输入管理员密码）
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={!!busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {profile && config && (
            <details className="web-access-settings">
              <summary>网关与连接凭据</summary>
              <p>
                由管理员提前部署 HTTPS 网关和专用 SSH
                转发账号。修改配置前请停止访问服务；保存时会停机备份并重启后端。
              </p>
              <fieldset disabled={!stopped || !!busy}>
                <div className="web-access-fields">
                  {(
                    [
                      ["origin", "HTTPS 域名", "https://studio.example.com"],
                      ["host", "SSH 主机", "gateway.example.com"],
                      ["user", "SSH 用户名", "fpl-gateway"],
                    ] as const
                  ).map(([key, label, placeholder]) => (
                    <label key={key}>
                      {label}
                      <input
                        value={profile[key] || ""}
                        placeholder={placeholder}
                        onChange={(event) => update(key, event.target.value)}
                        autoComplete="off"
                      />
                    </label>
                  ))}
                  {(
                    [
                      ["local_port", "本机端口"],
                      ["ssh_port", "SSH 端口"],
                      ["remote_port", "远端回环端口"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        min={key === "ssh_port" ? 1 : 1024}
                        max={65535}
                        value={profile[key]}
                        onChange={(event) =>
                          update(key, Number(event.target.value))
                        }
                      />
                    </label>
                  ))}
                </div>
                {(["identity", "known_hosts"] as const).map((kind) => (
                  <div className="web-access-credential" key={kind}>
                    <strong>
                      {kind === "identity" ? "专用 SSH 私钥" : "可信主机记录"}
                    </strong>
                    <code>
                      {kind === "identity"
                        ? profile.identity_id || "未导入"
                        : profile.known_hosts_id || "未导入"}
                    </code>
                    <small>
                      SSH 指纹：
                      {kind === "identity"
                        ? config.identity_fingerprint || "—"
                        : config.known_hosts_fingerprint || "—"}
                    </small>
                    <button
                      className="btn"
                      onClick={() =>
                        void run("正在导入凭据…", () => importCredential(kind))
                      }
                    >
                      选择文件导入
                    </button>
                  </div>
                ))}
                <div className="web-access-actions">
                  <button
                    className="btn primary"
                    disabled={!dirty}
                    onClick={() => void run("正在准备配置更新…", () => apply())}
                  >
                    备份并保存配置
                  </button>
                  {dirty && (
                    <button
                      className="btn"
                      onClick={() => {
                        setProfile(config.profile);
                        setNotice("");
                      }}
                    >
                      放弃更改
                    </button>
                  )}
                  {config.legacy_available && (
                    <button
                      className="btn"
                      onClick={() =>
                        void run("正在接管旧隧道…", () => apply(true))
                      }
                    >
                      接管现有 LaunchAgent 隧道
                    </button>
                  )}
                </div>
              </fieldset>
              <p className="web-access-help">
                只导入用于端口转发的专用密钥及已核验的
                known_hosts；应用严格验证主机指纹，不自动信任未知主机。接管时停用旧隧道自动启动并保留恢复信息。
              </p>
            </details>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
