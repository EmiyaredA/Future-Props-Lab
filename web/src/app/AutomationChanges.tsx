import { useEffect, useState } from "react";
import { api, unwrap } from "@platform/api/client";

/** Inform the editor without replacing drafts or forcing navigation. */
export function AutomationChanges({ userId }: { userId: string }) {
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    let alive = true;
    let revision: number | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const value = await unwrap(
          await api.GET("/v1/automation/changes", {
            signal: controller.signal,
          }),
        );
        if (!alive) return;
        if (revision !== null && revision !== value.revision) setChanged(true);
        revision = value.revision;
      } catch {
        /* Service recovery is handled by authentication and request UI. */
      }
      if (alive) timer = setTimeout(() => void poll(), 5000);
    };
    void poll();
    return () => {
      alive = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [userId]);
  return changed ? (
    <div className="amadeus-mutation-banner" role="status">
      自动化已更新数据；请先保存或处理当前编辑，再刷新页面。
      <button type="button" onClick={() => setChanged(false)}>
        知道了
      </button>
    </div>
  ) : null;
}
