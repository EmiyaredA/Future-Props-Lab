import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "@app/App";
import { StudioAuthGate } from "@app/StudioAuthGate";
import "@shared/ui/theme.css";
import "@app/styles.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <StudioAuthGate>
        <App />
      </StudioAuthGate>
    </QueryClientProvider>
  </React.StrictMode>,
);
