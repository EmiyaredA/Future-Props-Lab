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
    agentStatus: () => ipcRenderer.invoke("desktop:agent-status"),
    enableAgent: () => ipcRenderer.invoke("desktop:agent-enable"),
    disableAgent: () => ipcRenderer.invoke("desktop:agent-disable"),
    onQuitRequested: (callback: (approve: () => void) => void) => {
      const listener = () =>
        callback(() => ipcRenderer.send("desktop:quit-approved"));
      ipcRenderer.on("desktop:quit-requested", listener);
      return () =>
        ipcRenderer.removeListener("desktop:quit-requested", listener);
    },
  }),
);
