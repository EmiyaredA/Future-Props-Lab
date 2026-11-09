import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudioAuthGate } from "@app/StudioAuthGate";
import { PageErrorBoundary } from "@app/PageErrorBoundary";
import { ViewportBounds } from "@shared/ui/ViewportBounds";
import "@shared/ui/theme.css";
import "@app/tailwind.css";
import "@app/styles.css";
import "./independent.css";

const PortalApplication = lazy(() => import("./PortalApplication"));
const Documents = lazy(() => import("@app/entries/PortalDocuments"));
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10000, retry: 1 } },
});
if (
  /^\/cloud-control\/?$/.test(location.pathname) &&
  new URLSearchParams(location.search).get("view") === "agent"
) {
  history.replaceState({}, "", "/amadeus");
}
const documents = location.pathname === "/docs.html";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PageErrorBoundary>
      <ViewportBounds />
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={<div className="page-loading">正在打开页面…</div>}>
          {documents ? (
            <Documents />
          ) : (
            <StudioAuthGate>
              <PortalApplication />
            </StudioAuthGate>
          )}
        </Suspense>
      </QueryClientProvider>
    </PageErrorBoundary>
  </StrictMode>,
);
