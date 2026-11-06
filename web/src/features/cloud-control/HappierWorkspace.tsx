import { useEffect, useState } from "react";
import { launchHappier } from "./cloudApi";

export function HappierWorkspace({
  paneId,
  hidden,
  unlocked,
  onUnlock,
  loading,
  available,
  studioUrl,
}: {
  paneId: string;
  hidden: boolean;
  unlocked: boolean;
  onUnlock: () => void;
  loading: boolean;
  available: boolean;
  studioUrl?: string | null;
}) {
  return (
    <section
      id={paneId}
      hidden={hidden}
      aria-label="Agent 工作台"
      className="cloud-happier"
    >
      {available && unlocked ? (
        <HappierFrame visible={!hidden} />
      ) : (
        <div className="cloud-happier-state">
          {loading ? (
            <p role="status">正在检查 Happier…</p>
          ) : studioUrl ? (
            <a className="btn" href={studioUrl}>
              从 Studio HTTPS 入口登录
            </a>
          ) : available ? (
            <button type="button" className="btn" onClick={onUnlock}>
              解锁 Agent 工作台
            </button>
          ) : (
            <p>此账号或入口尚未启用 Happier。</p>
          )}
        </div>
      )}
    </section>
  );
}

function HappierFrame({ visible }: { visible: boolean }) {
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
        if (response.status === 503)
          throw new Error("Happier 暂不可用，请稍后重试");
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
      {source && (
        <iframe
          title="Happier Agent 工作台"
          src={source}
          allow="clipboard-read; clipboard-write"
          hidden={!loaded}
          referrerPolicy="strict-origin"
          onLoad={() => setLoaded(true)}
        />
      )}
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
