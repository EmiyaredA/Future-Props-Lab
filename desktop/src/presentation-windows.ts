import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import { isServiceUrl } from "./security";

export function studioPathForNewWindow(
  current: string | undefined,
  origin: string | undefined,
): string {
  if (current && origin && isServiceUrl(current, origin)) {
    try {
      const url = new URL(current);
      if (url.pathname && url.pathname !== "/docs.html")
        return url.pathname + url.search + url.hash;
    } catch {
      /* Use the studio home. */
    }
  }
  return "/";
}

export function presentationAudiencePath(
  projectId: unknown,
  sessionId: unknown,
): string {
  if (
    typeof projectId !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(projectId) ||
    typeof sessionId !== "string" ||
    !/^[0-9a-f-]{36}$/.test(sessionId)
  )
    throw new Error("演示窗口参数无效");
  return `/apps/presentation-workshop/projects/${encodeURIComponent(projectId)}?presentationAudience=${encodeURIComponent(sessionId)}`;
}

export function installPresentationWindows({
  trusted,
  create,
  origin,
  track,
  untrack,
}: {
  trusted: (event: IpcMainInvokeEvent) => boolean;
  create: () => BrowserWindow;
  origin: () => string | undefined;
  track: (window: BrowserWindow) => void;
  untrack: (window: BrowserWindow) => void;
}) {
  const windows = new Map<number, BrowserWindow>();
  ipcMain.handle(
    "desktop:presentation-audience",
    async (event, projectId: unknown, sessionId: unknown) => {
      if (!trusted(event)) throw new Error("拒绝非应用页面请求");
      const path = presentationAudiencePath(projectId, sessionId),
        base = origin();
      if (!base) throw new Error("应用尚未就绪");
      const parent = BrowserWindow.fromWebContents(event.sender);
      if (!parent) throw new Error("演示者窗口不存在");
      const ownerId = event.sender.id;
      windows.get(ownerId)?.close();
      const window = create();
      track(window);
      windows.set(ownerId, window);
      const close = () => {
        if (!window.isDestroyed()) window.close();
      };
      parent.once("closed", close);
      window.once("closed", () => {
        parent.removeListener("closed", close);
        untrack(window);
        if (windows.get(ownerId) === window) windows.delete(ownerId);
      });
      try {
        await window.loadURL(base + path);
      } catch (error) {
        close();
        throw error;
      }
    },
  );
}
