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
    openAmadeus: () => ipcRenderer.invoke("desktop:amadeus-open"),
    hideAmadeus: () => ipcRenderer.invoke("desktop:amadeus-hide"),
    amadeusAlwaysOnTop: () => ipcRenderer.invoke("desktop:amadeus-always-on-top"),
    setAmadeusAlwaysOnTop: (enabled: boolean) =>
      ipcRenderer.invoke("desktop:amadeus-always-on-top", enabled),
    publishAmadeusMutation: (value: unknown) => ipcRenderer.invoke("desktop:amadeus-mutation", value),
    locateAmadeusReference: (value: unknown) => ipcRenderer.invoke("desktop:amadeus-locate", value),
    onAmadeusMutation: (callback: (value: unknown) => void) => {
      const listener = (_event: unknown, value: unknown) => callback(value);
      ipcRenderer.on("desktop:amadeus-mutation", listener);
      return () => ipcRenderer.removeListener("desktop:amadeus-mutation", listener);
    },
    publishAmadeusContext: (value: unknown) => ipcRenderer.invoke("desktop:amadeus-context-publish", value),
    amadeusContexts: () => ipcRenderer.invoke("desktop:amadeus-contexts"),
    setAmadeusPickMode: (enabled: boolean, index?: number) => ipcRenderer.invoke("desktop:amadeus-pick", enabled, index),
    addAmadeusReference: (value: unknown) => ipcRenderer.invoke("desktop:amadeus-reference", value),
    onAmadeusContexts: (callback: (value: unknown) => void) => {
      const listener = (_event: unknown, value: unknown) => callback(value);
      ipcRenderer.on("desktop:amadeus-contexts", listener);
      return () => ipcRenderer.removeListener("desktop:amadeus-contexts", listener);
    },
    onAmadeusPickCommand: (callback: (value: { enabled: boolean; index: number }) => void) => {
      const listener = (_event: unknown, value: { enabled: boolean; index: number }) => callback(value);
      ipcRenderer.on("desktop:amadeus-pick-command", listener);
      return () => ipcRenderer.removeListener("desktop:amadeus-pick-command", listener);
    },
    onAmadeusReference: (callback: (value: unknown) => void) => {
      const listener = (_event: unknown, value: unknown) => callback(value);
      ipcRenderer.on("desktop:amadeus-reference-added", listener);
      return () => ipcRenderer.removeListener("desktop:amadeus-reference-added", listener);
    },
    onAmadeusLocate: (callback: (value: unknown) => void) => {
      const listener = (_event: unknown, value: unknown) => callback(value);
      ipcRenderer.on("desktop:amadeus-locate", listener);
      return () => ipcRenderer.removeListener("desktop:amadeus-locate", listener);
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
