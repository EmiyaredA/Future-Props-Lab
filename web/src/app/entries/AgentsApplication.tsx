import { useEffect, useRef, useState } from "react";
import { AgentWorkbenchPage } from "@features/agent-workbench/AgentWorkbenchPage";
import { RuntimeAccessProvider } from "@features/accounts/RuntimeAccessProvider";
import { CloudControlAccess } from "@features/cloud-control/CloudControlAccess";
import { useStudioSession } from "@app/StudioSession";
import { IndependentShell } from "./IndependentShell";
import { guardedNavigation } from "./navigation";

function currentPath() {
  return window.location.pathname + window.location.search;
}

export default function AgentsApplication() {
  const { me } = useStudioSession();
  const [path, setPath] = useState(currentPath);
  const previous = useRef(path);
  useEffect(() => {
    previous.current = path;
  }, [path]);
  useEffect(() => {
    const pop = () => {
      const target = currentPath();
      let committed = false;
      guardedNavigation(() => {
        if (currentPath() !== target) window.history.pushState({}, "", target);
        setPath(target);
        committed = true;
      });
      if (!committed) window.history.pushState({}, "", previous.current);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const navigate = (target: string) =>
    guardedNavigation(() => {
      if (target !== currentPath()) window.history.pushState({}, "", target);
      setPath(target);
    });
  const pathname = path.split("?")[0];
  const sources = /^\/agents\/sources\/?$/.test(pathname);
  const match = /^\/agents(?:\/sessions\/([a-zA-Z0-9_-]+))?\/?$/.exec(pathname);
  return (
    <RuntimeAccessProvider>
      <IndependentShell title="Agent 工作台">
        <CloudControlAccess>
          {sources || match ? (
            <AgentWorkbenchPage
              key={me.user.id}
              scopeKey={me.user.id}
              sessionId={match?.[1]}
              sourcesPage={sources}
              onOpenSession={(id) =>
                navigate(
                  "/agents" + (id ? "/sessions/" + encodeURIComponent(id) : ""),
                )
              }
              onSources={() => navigate("/agents/sources")}
              onBack={() =>
                guardedNavigation(
                  () => window.location.assign("/cloud-control"),
                  true,
                )
              }
            />
          ) : (
            <section className="independent-not-found">
              <h1>页面不存在</h1>
              <a href="/agents">返回工作台</a>
            </section>
          )}
        </CloudControlAccess>
      </IndependentShell>
    </RuntimeAccessProvider>
  );
}
