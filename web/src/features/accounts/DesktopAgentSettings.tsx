import { useEffect, useState } from "react";
import "@platform/desktop";

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
    <section className="settings-section">
      <h3>本地 Agent 接入</h3>
      <p>
        通过 CLI / Python SDK 操作当前
        App。仅向本机开放；每个客户端首次连接都需要你批准。
      </p>
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
      <p>
        批准的客户端会显示在下面的 API
        密钥列表中，以「Agent:」开头，可随时撤销或续期。关闭接入会断开所有客户端，但不会撤销密钥。
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
