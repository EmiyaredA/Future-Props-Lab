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
