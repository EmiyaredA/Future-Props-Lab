import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PageErrorBoundary } from "@app/PageErrorBoundary";
import { ManagementAuthGate } from "./ManagementAuthGate";
import { ManagementApplication } from "./ManagementApplication";
import "@shared/ui/theme.css";
import "@app/tailwind.css";
import "@app/styles.css";

const cache = new QueryClient({
  defaultOptions: { queries: { staleTime: 5000, retry: false } },
});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PageErrorBoundary>
      <QueryClientProvider client={cache}>
        <ManagementAuthGate>
          <ManagementApplication />
        </ManagementAuthGate>
      </QueryClientProvider>
    </PageErrorBoundary>
  </StrictMode>,
);
