import { LoadingState } from "@shared/ui/LoadingState";
import { PageErrorBoundary } from "@app/PageErrorBoundary";
import { ViewportBounds } from "@shared/ui/ViewportBounds";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { clearRetainedRealtimeVoiceState } from "@features/models/realtime/realtimeVoiceMemory";
import { StudioAuthGate } from "@app/StudioAuthGate";
import "@shared/ui/theme.css";
import "@app/tailwind.css";
import "@app/styles.css";

const SignedInApp = lazy(() => import("@app/SignedInApp"));
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PageErrorBoundary>
      <ViewportBounds />
      <QueryClientProvider client={queryClient}>
        <StudioAuthGate onIdentityReset={clearRetainedRealtimeVoiceState}>
          <Suspense
            fallback={
              <LoadingState
                label="正在打开工作台…"
                variant="page"
                className="fpl-loading--fullscreen"
              />
            }
          >
            <SignedInApp />
          </Suspense>
        </StudioAuthGate>
      </QueryClientProvider>
    </PageErrorBoundary>
  </React.StrictMode>,
);
