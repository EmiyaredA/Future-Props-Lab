import { useEffect, useState } from "react";
import "@platform/desktop";
import "./api-keys-settings.css";
import "./api-keys-responsive.css";

export function DesktopAgentSettings() {
  const bridge = window.futurePropsDesktop;
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void bridge?.agentStatus?.().then((value) => {
      if (active) setEnabled(value.enabled);
    });
    return () => {
      active = false;
    };
  }, [bridge]);
  if (!bridge?.agentStatus) return null;
  return (
    <section className="desktop-agent-settings">
      <div className="desktop-agent-settings-copy">
        <h3>本地 Agent 接入</h3>
        <p>
          通过 CLI / Python SDK 操作当前
          App。仅向本机开放；每个客户端首次连接都需要你批准。批准的客户端会出现在下方密钥列表（「Agent:」前缀），可随时撤销或续期。关闭接入会断开客户端，但不会撤销密钥。
        </p>
        {error ? (
          <p className="desktop-agent-settings-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className={`btn ${enabled ? "" : "primary"}`}
        disabled={busy}
        aria-pressed={enabled}
        onClick={() => {
          setBusy(true);
          setError("");
          void (enabled ? bridge.disableAgent() : bridge.enableAgent())
            .then((value) => setEnabled(value.enabled))
            .catch(() => setError("无法切换接入状态，请查看桌面日志"))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "正在设置…" : enabled ? "关闭本地接入" : "开启本地接入"}
      </button>
    </section>
  );
}
