import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { DesktopDevelopmentState } from "@platform/desktop";
import "./desktop-development.css";

export function DesktopDevelopmentBar() {
  const [state, setState] = useState<DesktopDevelopmentState | null>(null);
  const [deferred, setDeferred] = useState(false);
  const generation = useRef<number | null>(null);
  const queryClient = useQueryClient();
  const bridge = window.futurePropsDesktop;
  useEffect(() => {
    let active = true;
    void bridge?.developmentStatus?.().then((value) => {
      if (active) setState(value);
    });
    const cleanup = bridge?.onDevelopmentState?.((value) => setState(value));
    return () => {
      active = false;
      cleanup?.();
    };
  }, [bridge]);
  useEffect(() => {
    if (!state) return;
    if (
      generation.current !== null &&
      generation.current !== state.generation
    ) {
      const safe = window.dispatchEvent(
        new Event("future-props:development-query-refresh", {
          cancelable: true,
        }),
      );
      setDeferred(!safe);
      // Active editors keep their draft and revision; list pages refresh immediately.
      void queryClient.invalidateQueries({
        refetchType: safe ? "active" : "none",
      });
    }
    generation.current = state.generation;
  }, [state, queryClient]);
  if (!state) return null;
  const apply = () => {
    const commit = () => void bridge?.applyDevelopmentUpdate?.();
    if (state.pending.some((kind) => kind === "desktop" || kind === "page")) {
      const event = new CustomEvent("future-props:before-workspace-switch", {
        cancelable: true,
        detail: commit,
      });
      if (window.dispatchEvent(event)) commit();
    } else commit();
  };
  return (
    <aside className="desktop-development-bar" aria-label="开发更新">
      <span className="desktop-development-mode">
        开发模式 · {state.live ? "正式数据" : "开发数据"}
      </span>
      <span role="status">{state.message}</span>
      {deferred && <span>编辑内容已保留；保存后重新进入页面获取最新数据</span>}
      {state.pending.length > 0 && (
        <>
          <span className="desktop-development-hint">
            重启可能中断生成任务和语音连接
          </span>
          <button
            className="btn"
            type="button"
            disabled={state.phase === "checking" || state.phase === "applying"}
            onClick={
              state.phase === "error"
                ? () => void bridge?.checkDevelopmentUpdate?.()
                : apply
            }
          >
            {state.phase === "error"
              ? "重新检查"
              : state.phase === "applying"
                ? "正在应用…"
                : "应用更新"}
          </button>
        </>
      )}
    </aside>
  );
}
