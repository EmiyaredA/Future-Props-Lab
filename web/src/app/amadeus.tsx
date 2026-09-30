/* eslint-disable react-refresh/only-export-components -- standalone Electron entry */
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudioAuthGate } from "@app/StudioAuthGate";
import { useStudioSession } from "@app/StudioSession";
import { DesktopSetupGate } from "@features/accounts/DesktopSetupGate";
import { AmadeusWindow } from "@features/amadeus/Window";
import { applyTheme, loadTheme, useTheme } from "@shared/ui/theme";
import "@shared/ui/theme.css";
import "@app/tailwind.css";
import "@features/amadeus/window.css";
import "@features/amadeus/window-theme.css";
import "@features/amadeus/context-panel.css";
import "@features/amadeus/side-rail.css";
import "@features/amadeus/activity-feed.css";
import "@features/amadeus/conversation-layout.css";
import "@features/amadeus/capability-dialog.css";

const queryClient = new QueryClient();

// Amadeus runs in a separate Electron window but shares the Studio origin and
// localStorage, so useTheme receives updates through the browser storage event.
function AmadeusThemeSync() {
  useTheme();
  return null;
}

applyTheme(loadTheme(), false);

function AuthenticatedAmadeus() {
  const session = useStudioSession();
  return (
    <>
      <AmadeusThemeSync />
      <AmadeusWindow session={session} />
    </>
  );
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
