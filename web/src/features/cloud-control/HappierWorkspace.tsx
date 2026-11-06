import { useEffect, useState } from "react";
import { launchHappier } from "./cloudApi";

export function HappierWorkspace({
  paneId,
  hidden,
  unlocked,
  onUnlock,
  onHistory,
}: {
  paneId: string;
  hidden: boolean;
  unlocked: boolean;
  onUnlock: () => void;
  onHistory: () => void;
}) {
  return (
    <section
      id={paneId}
      hidden={hidden}
      aria-label="Agent 工作台"
      className="cloud-happier"
    >
      {unlocked ? (
        <HappierFrame name={paneId + "-happier"} visible={!hidden} />
      ) : (
        <div className="cloud-happier-state">
          <button type="button" className="btn" onClick={onUnlock}>
            解锁 Agent 工作台
          </button>
          <button type="button" className="btn" onClick={onHistory}>
            查看 FPL 历史
          </button>
        </div>
      )}
    </section>
  );
}

function HappierFrame({ name, visible }: { name: string; visible: boolean }) {
  const [source, setSource] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!visible || source || error) return;
    const controller = new AbortController();
    void launchHappier(controller.signal)
      .then(async ({ exchange_url, ticket }) => {
        const response = await fetch(exchange_url, {
          method: "POST",
          credentials: "include",
          redirect: "error",
          body: new URLSearchParams({ ticket }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Happier 授权失败，请重试");
        if (!controller.signal.aborted)
          setSource(new URL("/", exchange_url).href);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            reason instanceof Error ? reason.message : "Happier 启动失败",
          );
        }
      });
    return () => controller.abort();
  }, [visible, source, error]);

  return (
    <>
      <iframe
        name={name}
        title="Happier Agent 工作台"
        src={source}
        hidden={!loaded}
        referrerPolicy="strict-origin"
        onLoad={() => {
          if (source) setLoaded(true);
        }}
      />
      {!loaded && (
        <div className="cloud-happier-state">
          {error ? (
            <>
              <p role="alert">{error}</p>
              <button
                type="button"
                className="btn"
                onClick={() => setError(undefined)}
              >
                重试
              </button>
            </>
          ) : (
            <p role="status">正在打开 Happier…</p>
          )}
        </div>
      )}
    </>
  );
}
