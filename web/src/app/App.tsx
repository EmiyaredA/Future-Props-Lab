import { useEffect, useState } from "react";
import { ModelCallLogsPage } from "@features/models/ModelCallLogsPage";
import { ModelServicePage } from "@features/models/ModelServicePage";
import { StudioSidebar, type StudioPage } from "@app/layout/StudioSidebar";

function parsePage(pathname = window.location.pathname): StudioPage {
  return pathname.startsWith("/model-call-logs")
    ? "model-call-logs"
    : "model-service";
}

function pathFor(page: StudioPage): string {
  return page === "model-call-logs" ? "/model-call-logs" : "/model-service";
}

export default function App() {
  const [page, setPage] = useState<StudioPage>(parsePage);
  useEffect(() => {
    if (window.location.pathname === "/")
      window.history.replaceState({}, "", "/model-service");
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
        {page === "model-service" ? (
          <ModelServicePage onOpenLogs={() => navigate("model-call-logs")} />
        ) : (
          <ModelCallLogsPage />
        )}
      </main>
    </div>
  );
}
