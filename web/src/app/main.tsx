import { PageErrorBoundary } from "./PageErrorBoundary";
import { ViewportBounds } from "@shared/ui/ViewportBounds";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "@app/App";
import { DesktopAgentHost } from "@app/DesktopAgentHost";
import { AmadeusSourceHost } from "@features/amadeus/SourceHost";
import { DesktopDevelopmentHost } from "@app/DesktopDevelopmentHost";
import { StudioAuthGate } from "@app/StudioAuthGate";
import { DesktopSetupGate } from "@features/accounts/DesktopSetupGate";
import "@shared/ui/theme.css";
import "@app/tailwind.css";
import "@app/styles.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PageErrorBoundary>
      <ViewportBounds />
      <QueryClientProvider client={queryClient}>
        <DesktopDevelopmentHost />
        <DesktopSetupGate>
          <StudioAuthGate>
            <App />
            <DesktopAgentHost />
            <AmadeusSourceHost />
          </StudioAuthGate>
        </DesktopSetupGate>
      </QueryClientProvider>
    </PageErrorBoundary>
  </React.StrictMode>,
);
