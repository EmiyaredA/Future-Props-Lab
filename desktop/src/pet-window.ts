import { BrowserWindow, ipcMain, screen } from "electron";
import { clampPetBounds } from "./pet-window-geometry";

type Sender = {
  sender: Electron.WebContents;
  senderFrame: Electron.WebFrameMain | null;
};

type Options = {
  preload: string;
  pageOrigin: () => string;
  trusted: (url: string) => boolean;
  isStudioSender: (event: Sender) => boolean;
  showStudio: () => void;
  canOpen: () => boolean;
};

/** One transient pet per process; no persistent desktop preference is written. */
export class PetWindowController {
  private win: BrowserWindow | undefined;
  private projectId: string | null = null;
  private scope: string | null = null;
  private readonly contexts = new Map<number, string>();

  constructor(private readonly options: Options) {}

  detachStudio(webContentsId: number): void {
    this.contexts.delete(webContentsId);
    if (this.contexts.size === 0) this.close();
  }

  close(): void {
    const win = this.win;
    this.win = undefined;
    this.projectId = null;
    this.scope = null;
    if (win && !win.isDestroyed()) win.destroy();
  }

  private isPetSender(event: Sender): boolean {
    return Boolean(
      this.win &&
      !this.win.isDestroyed() &&
      event.sender === this.win.webContents &&
      event.senderFrame === event.sender.mainFrame &&
      event.senderFrame &&
      this.options.trusted(event.senderFrame.url) &&
      new URL(event.senderFrame.url).pathname === "/pet.html",
    );
  }

  private async open(projectId: string, scope: string): Promise<void> {
    const origin = this.options.pageOrigin();
    if (!this.options.canOpen() || !origin) return;
    if (this.win && !this.win.isDestroyed()) {
      if (this.projectId === projectId && this.scope === scope) {
        this.win.show();
        return;
      }
      this.close();
    }
    const area = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    ).workArea;
    const width = 300;
    const height = 400;
    const bounds = clampPetBounds(
      {
        x: area.x + area.width - width - 28,
        y: area.y + area.height - height - 28,
        width,
        height,
      },
      [area],
    );
    const win = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: this.options.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        partition: "persist:studio",
        backgroundThrottling: false,
      },
    });
    this.win = win;
    this.projectId = projectId;
    this.scope = scope;
    win.setAlwaysOnTop(true, "floating");
    win.setIgnoreMouseEvents(true, { forward: true });
    win.on("closed", () => {
      if (this.win === win) this.close();
    });
    win.webContents.on("will-navigate", (event, url) => {
      if (
        this.options.trusted(url) &&
        new URL(url).pathname === "/pet.html" &&
        new URL(url).searchParams.get("id") === projectId
      )
        return;
      event.preventDefault();
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.once("did-finish-load", () => {
      if (this.win === win) win.showInactive();
    });
    await win.loadURL(`${origin}/pet.html?id=${encodeURIComponent(projectId)}`);
  }

  installIpc(): void {
    ipcMain.handle("desktop:pet-context", (event, value: unknown) => {
      if (!this.options.isStudioSender(event))
        throw new Error("拒绝非应用页面请求");
      if (value === null) {
        this.contexts.delete(event.sender.id);
        this.close();
        return;
      }
      if (!value || typeof value !== "object") throw new Error("身份无效");
      const context = value as { userId?: unknown; workspaceId?: unknown };
      if (
        typeof context.userId !== "string" ||
        typeof context.workspaceId !== "string" ||
        context.userId.length > 100 ||
        context.workspaceId.length > 100
      )
        throw new Error("身份无效");
      const scope = `${context.userId}:${context.workspaceId}`;
      this.contexts.set(event.sender.id, scope);
      if (this.scope && this.scope !== scope) this.close();
    });
    ipcMain.handle("desktop:pet-open", (event, projectId: unknown) => {
      if (!this.options.isStudioSender(event))
        throw new Error("拒绝非应用页面请求");
      const scope = this.contexts.get(event.sender.id);
      if (!scope) throw new Error("请先登录并选择工作空间");
      if (
        typeof projectId !== "string" ||
        !/^[0-9a-f-]{32,36}$/i.test(projectId)
      )
        throw new Error("桌宠项目 ID 无效");
      return this.open(projectId, scope);
    });
    ipcMain.handle("desktop:pet-close", (event) => {
      if (!this.options.isStudioSender(event))
        throw new Error("拒绝非应用页面请求");
      this.close();
    });
    ipcMain.handle("desktop:pet-status", (event) => {
      if (!this.options.isStudioSender(event))
        throw new Error("拒绝非应用页面请求");
      return {
        projectId: this.projectId,
        visible: Boolean(this.win?.isVisible()),
      };
    });
    ipcMain.handle("desktop:pet-hit", (event, interactive: unknown) => {
      if (!this.isPetSender(event) || typeof interactive !== "boolean")
        throw new Error("桌宠命中无效");
      this.win?.setIgnoreMouseEvents(!interactive, { forward: true });
    });
    ipcMain.handle("desktop:pet-move", (event, x: unknown, y: unknown) => {
      if (
        !this.isPetSender(event) ||
        !Number.isFinite(x) ||
        !Number.isFinite(y)
      )
        throw new Error("桌宠位置无效");
      const win = this.win;
      if (!win) return;
      const next = clampPetBounds(
        { ...win.getBounds(), x: x as number, y: y as number },
        screen.getAllDisplays().map((display) => display.workArea),
      );
      win.setBounds(next, false);
      return next;
    });
    ipcMain.handle("desktop:pet-hide", (event) => {
      if (!this.isPetSender(event)) throw new Error("拒绝非桌宠页面请求");
      this.win?.hide();
    });
    ipcMain.handle("desktop:pet-show-studio", (event) => {
      if (!this.isPetSender(event)) throw new Error("拒绝非桌宠页面请求");
      this.options.showStudio();
    });
  }
}
