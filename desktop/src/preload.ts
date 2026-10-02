import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld(
  "futurePropsDesktop",
  Object.freeze({
    version: 1,
    status: () => ipcRenderer.invoke("desktop:status"),
    retry: () => ipcRenderer.invoke("desktop:retry"),
    openLogs: () => ipcRenderer.invoke("desktop:logs"),
    minimize: () => ipcRenderer.invoke("desktop:minimize"),
    close: () => ipcRenderer.invoke("desktop:close"),
    openNewWindow: () => ipcRenderer.invoke("desktop:open-new-window"),
    openPet: (projectId: string) =>
      ipcRenderer.invoke("desktop:pet-open", projectId),
    closePet: () => ipcRenderer.invoke("desktop:pet-close"),
    petStatus: () => ipcRenderer.invoke("desktop:pet-status"),
    publishPetContext: (
      value: { userId: string; workspaceId: string } | null,
    ) => ipcRenderer.invoke("desktop:pet-context", value),
    setPetInteractive: (interactive: boolean) =>
      ipcRenderer.invoke("desktop:pet-hit", interactive),
    movePet: (x: number, y: number) =>
      ipcRenderer.invoke("desktop:pet-move", x, y),
    hidePet: () => ipcRenderer.invoke("desktop:pet-hide"),
    showStudioFromPet: () => ipcRenderer.invoke("desktop:pet-show-studio"),
    openPetChat: () => ipcRenderer.invoke("desktop:pet-chat-open"),
    openPetChatFromStudio: (projectId: string) =>
      ipcRenderer.invoke("desktop:pet-chat-open-studio", projectId),
    closePetChat: () => ipcRenderer.invoke("desktop:pet-chat-close"),
    sendPetChatState: (value: { phase: string; text: string }) =>
      ipcRenderer.invoke("desktop:pet-chat-state", value),
    onPetChatState: (
      callback: (value: { phase: string; text?: string }) => void,
    ) => {
      const listener = (
        _event: unknown,
        value: { phase: string; text?: string },
      ) => callback(value);
      ipcRenderer.on("desktop:pet-chat-state", listener);
      return () =>
        ipcRenderer.removeListener("desktop:pet-chat-state", listener);
    },
    openAmadeus: () => ipcRenderer.invoke("desktop:amadeus-open"),
    hideAmadeus: () => ipcRenderer.invoke("desktop:amadeus-hide"),
    setAmadeusStageOpen: (enabled: boolean) =>
      ipcRenderer.invoke("desktop:amadeus-stage", enabled),
    amadeusAlwaysOnTop: () =>
      ipcRenderer.invoke("desktop:amadeus-always-on-top"),
    setAmadeusAlwaysOnTop: (enabled: boolean) =>
      ipcRenderer.invoke("desktop:amadeus-always-on-top", enabled),
    publishAmadeusMutation: (value: unknown) =>
      ipcRenderer.invoke("desktop:amadeus-mutation", value),
    locateAmadeusReference: (value: unknown) =>
      ipcRenderer.invoke("desktop:amadeus-locate", value),
    onAmadeusMutation: (callback: (value: unknown) => void) => {
      const listener = (_event: unknown, value: unknown) => callback(value);
      ipcRenderer.on("desktop:amadeus-mutation", listener);
      return () =>
        ipcRenderer.removeListener("desktop:amadeus-mutation", listener);
    },
    publishAmadeusContext: (value: unknown) =>
      ipcRenderer.invoke("desktop:amadeus-context-publish", value),
    amadeusContexts: () => ipcRenderer.invoke("desktop:amadeus-contexts"),
    setAmadeusPickMode: (enabled: boolean, index?: number) =>
      ipcRenderer.invoke("desktop:amadeus-pick", enabled, index),
    finishAmadeusPick: () =>
      ipcRenderer.invoke("desktop:amadeus-pick-finished"),
    addAmadeusReference: (value: unknown) =>
      ipcRenderer.invoke("desktop:amadeus-reference", value),
    onAmadeusContexts: (callback: (value: unknown) => void) => {
      const listener = (_event: unknown, value: unknown) => callback(value);
      ipcRenderer.on("desktop:amadeus-contexts", listener);
      return () =>
        ipcRenderer.removeListener("desktop:amadeus-contexts", listener);
    },
    onAmadeusPickCommand: (
      callback: (value: { enabled: boolean; index: number }) => void,
    ) => {
      const listener = (
        _event: unknown,
        value: { enabled: boolean; index: number },
      ) => callback(value);
      ipcRenderer.on("desktop:amadeus-pick-command", listener);
      return () =>
        ipcRenderer.removeListener("desktop:amadeus-pick-command", listener);
    },
    onAmadeusPickFinished: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("desktop:amadeus-pick-finished", listener);
      return () =>
        ipcRenderer.removeListener("desktop:amadeus-pick-finished", listener);
    },
    onAmadeusReference: (callback: (value: unknown) => void) => {
      const listener = (_event: unknown, value: unknown) => callback(value);
      ipcRenderer.on("desktop:amadeus-reference-added", listener);
      return () =>
        ipcRenderer.removeListener("desktop:amadeus-reference-added", listener);
    },
    onAmadeusLocate: (callback: (value: unknown) => void) => {
      const listener = (_event: unknown, value: unknown) => callback(value);
      ipcRenderer.on("desktop:amadeus-locate", listener);
      return () =>
        ipcRenderer.removeListener("desktop:amadeus-locate", listener);
    },
    agentStatus: () => ipcRenderer.invoke("desktop:agent-status"),
    enableAgent: () => ipcRenderer.invoke("desktop:agent-enable"),
    disableAgent: () => ipcRenderer.invoke("desktop:agent-disable"),
    ...(process.argv.includes("--fpl-development-bridge")
      ? {
          developmentStatus: () =>
            ipcRenderer.invoke("desktop:development-status").catch(() => null),
          applyDevelopmentUpdate: () =>
            ipcRenderer.invoke("desktop:development-apply"),
          checkDevelopmentUpdate: () =>
            ipcRenderer.invoke("desktop:development-check"),
          onDevelopmentState: (callback: (state: unknown) => void) => {
            const listener = (_event: unknown, state: unknown) =>
              callback(state);
            ipcRenderer.on("desktop:development-state", listener);
            return () =>
              ipcRenderer.removeListener("desktop:development-state", listener);
          },
          onDevelopmentMenuAction: (
            callback: (action: "apply" | "check") => void,
          ) => {
            const listener = (_event: unknown, action: "apply" | "check") =>
              callback(action);
            ipcRenderer.on("desktop:development-menu-action", listener);
            return () =>
              ipcRenderer.removeListener(
                "desktop:development-menu-action",
                listener,
              );
          },
        }
      : {}),
    onQuitRequested: (
      callback: (approve: () => void, cancel: () => void) => void,
    ) => {
      const listener = () =>
        callback(
          () => ipcRenderer.send("desktop:quit-approved"),
          () => ipcRenderer.send("desktop:quit-cancelled"),
        );
      ipcRenderer.on("desktop:quit-requested", listener);
      return () =>
        ipcRenderer.removeListener("desktop:quit-requested", listener);
    },
  }),
);
