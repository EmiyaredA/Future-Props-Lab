import { useEffect, useRef, useState } from "react";
import "@platform/desktop";

/** Each settings surface owns its bridge status; opening it never enables access. */
export function useDesktopAgentAccess() {
  const bridge = window.futurePropsDesktop;
  const supported = !!bridge?.agentStatus;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false);
  const inFlight = useRef(false);
  useEffect(() => {
    active.current = true;
    void bridge
      ?.agentStatus?.()
      .then((status) => {
        if (active.current) setEnabled(status.enabled);
      })
      .catch(() => {
        if (active.current) setError("无法读取本地接入状态，请查看桌面日志");
      });
    return () => {
      active.current = false;
    };
  }, [bridge]);
  const toggle = async () => {
    if (!supported || enabled === null || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const status = await (enabled
        ? bridge.disableAgent()
        : bridge.enableAgent());
      if (active.current) setEnabled(status.enabled);
    } catch {
      if (active.current) setError("无法切换接入状态，请查看桌面日志");
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  };
  return { supported, enabled, busy, error, toggle };
}
