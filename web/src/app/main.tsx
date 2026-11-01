import { PageErrorBoundary } from "./PageErrorBoundary";
import { ViewportBounds } from "@shared/ui/ViewportBounds";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { StudioAuthGate } from "@app/StudioAuthGate";
import { DesktopSetupGate } from "@features/accounts/DesktopSetupGate";
import "@shared/ui/theme.css";
import "@app/tailwind.css";
import "@app/styles.css";

const SignedInApp = lazy(() => import("./SignedInApp"));
const DesktopDevelopmentHost = lazy(() =>
  import("./DesktopDevelopmentHost").then((module) => ({
    default: module.DesktopDevelopmentHost,
  })),
);

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PageErrorBoundary>
      <ViewportBounds />
      <QueryClientProvider client={queryClient}>
        {window.futurePropsDesktop && (
          <Suspense fallback={null}>
            <DesktopDevelopmentHost />
          </Suspense>
        )}
        <DesktopSetupGate>
          <StudioAuthGate>
            <Suspense
              fallback={
                <div className="page-loading" role="status">
                  正在打开工作台…
                </div>
              }
            >
              <SignedInApp />
            </Suspense>
          </StudioAuthGate>
        </DesktopSetupGate>
      </QueryClientProvider>
    </PageErrorBoundary>
  </React.StrictMode>,
);
