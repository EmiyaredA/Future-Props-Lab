import { useEffect, useState } from "react";
import { AppWindow } from "lucide-react";
import type { DesktopDevelopmentState } from "@platform/desktop";
import "@platform/desktop";

function developmentNeedsAttention(dev: DesktopDevelopmentState): boolean {
  return (
    dev.phase === "error" ||
    dev.phase === "applying" ||
    dev.phase === "checking" ||
    (dev.pending.length > 0 && dev.phase === "ready")
  );
}

function pendingSummary(dev: DesktopDevelopmentState): string {
  if (dev.phase === "error") return dev.message || "检查失败";
  if (dev.phase === "applying") return "正在应用更新…";
  if (dev.phase === "checking") return "正在检查更新…";
  const count = dev.pending.length;
  if (count <= 0) return dev.message || "有更新待应用";
  if (dev.message) return dev.message;
  return count === 1 ? "有 1 项更新待应用" : `有 ${count} 项更新待应用`;
}

export function DesktopAppChrome() {
  const bridge = window.futurePropsDesktop;
  const [dev, setDev] = useState<DesktopDevelopmentState | null>(null);

  useEffect(() => {
    if (!bridge?.developmentStatus) return;
    let active = true;
    void bridge.developmentStatus().then((value) => {
      if (active) setDev(value);
    });
    return bridge.onDevelopmentState?.((value) => setDev(value));
  }, [bridge]);

  if (!bridge) return null;

  const expanded = Boolean(dev && developmentNeedsAttention(dev));
  const busy = dev?.phase === "applying" || dev?.phase === "checking";
  const actionLabel =
    dev?.phase === "error" ? "重新检查" : busy ? "请稍候" : "立即应用";

  return (
    <>
      <button
        type="button"
        className="studio-header-chip"
        aria-label="新建窗口"
        onClick={() => void bridge.openNewWindow()}
      >
        <AppWindow size={16} aria-hidden="true" />
        <span>新建窗口</span>
      </button>
      {dev ? (
        <div
          className={
            expanded
              ? "studio-dev-notice studio-dev-notice--expanded"
              : "studio-dev-notice"
          }
          role="status"
        >
          {expanded ? (
            <>
              <span className="studio-dev-notice__dot" aria-hidden="true" />
              <span className="studio-dev-notice__text" title={dev.message}>
                {pendingSummary(dev)}
              </span>
              <button
                type="button"
                className="studio-dev-notice__action"
                disabled={busy}
                aria-label={actionLabel}
                onClick={() => {
                  if (dev.phase === "error") {
                    void bridge.checkDevelopmentUpdate?.();
                    return;
                  }
                  window.dispatchEvent(
                    new Event("future-props:development-apply"),
                  );
                }}
              >
                {actionLabel}
              </button>
            </>
          ) : (
            <span className="studio-dev-notice__badge">
              开发 · {dev.live ? "正式数据" : "开发数据"}
            </span>
          )}
        </div>
      ) : null}
    </>
  );
}
