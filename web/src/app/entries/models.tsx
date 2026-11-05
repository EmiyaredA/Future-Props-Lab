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

const ModelsApplication = lazy(() => import("./ModelsApplication"));
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10000, retry: 1 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PageErrorBoundary>
      <ViewportBounds />
      <QueryClientProvider client={queryClient}>
        <StudioAuthGate>
          <Suspense
            fallback={<div className="page-loading">正在打开模型服务…</div>}
          >
            <ModelsApplication />
          </Suspense>
        </StudioAuthGate>
      </QueryClientProvider>
    </PageErrorBoundary>
  </StrictMode>,
);
