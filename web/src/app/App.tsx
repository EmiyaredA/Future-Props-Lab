import { useEffect, useState } from "react";
import { ModelCallLogsPage } from "@features/models/ModelCallLogsPage";
import { ModelServicePage } from "@features/models/ModelServicePage";
import { ModelTestPage } from "@features/models/ModelTestPage";
import { ToolNavigationPage } from "@features/tools/ToolNavigationPage";
import { StudioSidebar, type StudioPage } from "@app/layout/StudioSidebar";
import { parsePage, pathFor } from "@app/routes";

export default function App() {
  const [page, setPage] = useState<StudioPage>(parsePage);
  useEffect(() => {
    if (window.location.pathname === "/")
      window.history.replaceState({}, "", "/tools");
    const pop = () => setPage(parsePage());
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const navigate = (next: StudioPage) => {
    if (next !== page) window.history.pushState({}, "", pathFor(next));
    setPage(next);
  };
  return (
    <div className="studio-shell">
      <StudioSidebar page={page} navigate={navigate} />
      <main className="studio-main">
        {page === "tools" ? (
          <ToolNavigationPage
            onOpenInternal={(path) => navigate(parsePage(path))}
          />
        ) : page === "model-test" ? (
          <ModelTestPage />
        ) : page === "model-service" ? (
          <ModelServicePage onOpenLogs={() => navigate("model-call-logs")} />
        ) : (
          <ModelCallLogsPage />
        )}
      </main>
    </div>
  );
}
