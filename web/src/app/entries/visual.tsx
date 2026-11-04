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

const VisualApplication = lazy(() => import("./VisualApplication"));
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
            fallback={<div className="page-loading">正在打开视觉创作工坊…</div>}
          >
            <VisualApplication />
          </Suspense>
        </StudioAuthGate>
      </QueryClientProvider>
    </PageErrorBoundary>
  </StrictMode>,
);
