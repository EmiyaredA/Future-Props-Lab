/* eslint-disable react-refresh/only-export-components -- standalone Electron entry */
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudioAuthGate } from "@app/StudioAuthGate";
import { useStudioSession } from "@app/StudioSession";
import { DesktopSetupGate } from "@features/accounts/DesktopSetupGate";
import { AmadeusWindow } from "@features/amadeus/Window";
import "@shared/ui/theme.css";
import "@app/tailwind.css";
import "@features/amadeus/window.css";

const queryClient = new QueryClient();
function AuthenticatedAmadeus() {
  const session = useStudioSession();
  return <AmadeusWindow session={session} />;
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <DesktopSetupGate>
        <StudioAuthGate>
          <AuthenticatedAmadeus />
        </StudioAuthGate>
      </DesktopSetupGate>
    </QueryClientProvider>
  </React.StrictMode>,
);
