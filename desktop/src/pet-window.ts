import { BrowserWindow, ipcMain, screen } from "electron";
import {
  clampPetBounds,
  companionBounds,
  type ChatLayout,
} from "./pet-window-geometry";
import { PetPreviewRelay } from "./pet-preview-relay";
import { previewIdentity } from "./pet-preview-protocol";
import {
  PetMotionGate,
  motionRequest,
  clampVisiblePet,
  type MotionGeometry,
} from "./pet-motion";

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
  private chatWin: BrowserWindow | undefined;
  private chatLayout: ChatLayout = "compact";
  private projectId: string | null = null;
  private scope: string | null = null;
  private motion = new PetMotionGate();
  private environmentRevision = 0;
  private geometry: MotionGeometry | null = null;
  private motionDisplayId: number | null = null;
  private motionLinked = false;

  private environment() {
    const win = this.win;
    if (!win || win.isDestroyed()) throw new Error("桌宠窗口不可用");
    const bounds = win.getBounds();
    const display =
      screen.getAllDisplays().find((d) => d.id === this.motionDisplayId) ??
      screen.getDisplayMatching(bounds);
    this.motionDisplayId = display.id;
    return {
      revision: this.environmentRevision,
      generation: this.motion.generation,
      bounds,
      displayId: display.id,
      workArea: display.workArea,
      visible: win.isVisible(),
    };
  }

  private publishEnvironment() {
    if (this.win && !this.win.isDestroyed())
      this.win.webContents.send("desktop:pet-environment", this.environment());
  }
  private cancelMotion() {
    this.motion.cancel(this.motion.generation + 1);
    this.publishEnvironment();
  }
  private readonly contexts = new Map<number, string>();
  private readonly preview = new PetPreviewRelay((value) => {
    if (this.motionLinked !== Boolean(value)) {
      this.motionLinked = Boolean(value);
      this.cancelMotion();
    }
    if (this.win && !this.win.isDestroyed())
      this.win.webContents.send("desktop:pet-preview", value);
  });

  constructor(private readonly options: Options) {}

  detachStudio(webContentsId: number): void {
    this.preview.endByOwner(webContentsId);
    this.contexts.delete(webContentsId);
    if (this.contexts.size === 0) this.close();
  }

  close(): void {
    this.preview.end();
    this.closeChat();
    const win = this.win;
    this.win = undefined;
    this.projectId = null;
    this.scope = null;
    this.motion = new PetMotionGate();
    this.geometry = null;
    this.motionDisplayId = null;
    this.environmentRevision += 1;
    if (win && !win.isDestroyed()) win.destroy();
  }

  private closeChat(): void {
    const chat = this.chatWin;
    this.chatWin = undefined;
    this.preview.pause(false);
    if (chat && !chat.isDestroyed()) chat.destroy();
    if (chat) this.cancelMotion();
    if (this.win && !this.win.isDestroyed())
      this.win.webContents.send("desktop:pet-chat-state", { phase: "closed" });
  }

  private chatBounds() {
    const pet = this.win;
    if (!pet) return null;
    const bounds = pet.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    return companionBounds(bounds, area, this.chatLayout);
  }

  private alignChat() {
    const bounds = this.chatBounds();
    if (!bounds || !this.chatWin || this.chatWin.isDestroyed()) return;
    const { side, ...rect } = bounds;
    this.chatWin.setBounds(rect, false);
    this.chatWin.webContents.send("desktop:pet-chat-layout", { side });
  }

  private isChatSender(event: Sender): boolean {
    return Boolean(
      this.chatWin &&
      !this.chatWin.isDestroyed() &&
      event.sender === this.chatWin.webContents &&
      event.senderFrame === event.sender.mainFrame &&
      event.senderFrame &&
      this.options.trusted(event.senderFrame.url) &&
      new URL(event.senderFrame.url).pathname === "/pet-chat.html",
    );
  }

  private async openChat(): Promise<void> {
    if (!this.win || !this.projectId || !this.win.isVisible()) return;
    if (this.chatWin && !this.chatWin.isDestroyed()) {
      this.chatWin.show();
      this.chatWin.focus();
      return;
    }
    this.chatLayout = "compact";
    const bounds = this.chatBounds();
    if (!bounds) return;
    const projectId = this.projectId;
    const chat = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      webPreferences: {
        preload: this.options.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        partition: "persist:studio",
      },
    });
    this.chatWin = chat;
    this.cancelMotion();
    this.preview.pause(true);
    chat.setAlwaysOnTop(true, "floating");
    chat.on("closed", () => {
      if (this.chatWin === chat) this.closeChat();
    });
    chat.webContents.on("will-navigate", (event, url) => {
      if (
        this.options.trusted(url) &&
        new URL(url).pathname === "/pet-chat.html" &&
        new URL(url).searchParams.get("id") === projectId
      )
        return;
      event.preventDefault();
    });
    chat.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    chat.webContents.once("did-finish-load", () => {
      if (this.chatWin === chat) {
        chat.show();
        chat.focus();
        this.win?.webContents.send("desktop:pet-chat-state", { phase: "open" });
      }
    });
    await chat.loadURL(
      `${this.options.pageOrigin()}/pet-chat.html?id=${encodeURIComponent(projectId)}`,
    );
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
        this.publishEnvironment();
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
    const previewOwner = (event: Sender, value: unknown) => {
      const identity = previewIdentity(value);
      if (
        !this.options.isStudioSender(event) ||
        event.senderFrame !== event.sender.mainFrame ||
        !event.senderFrame ||
        !this.options.trusted(event.senderFrame.url) ||
        new URL(event.senderFrame.url).pathname !==
          `/apps/desktop-pet/projects/${identity.projectId}/editor` ||
        this.contexts.get(event.sender.id) !== this.scope ||
        !this.scope ||
        this.projectId !== identity.projectId ||
        !this.win?.isVisible()
      )
        throw new Error("请在同一空间打开该项目的桌宠后联动");
      return identity;
    };
    ipcMain.handle("desktop:pet-preview-begin", (event, value: unknown) => {
      previewOwner(event, value);
      return this.preview.begin(event.sender, value);
    });
    ipcMain.handle("desktop:pet-preview-update", (event, value: unknown) => {
      previewOwner(event, value);
      return this.preview.update(event.sender, value);
    });
    ipcMain.handle("desktop:pet-preview-end", (event, sessionId: unknown) => {
      if (!this.options.isStudioSender(event))
        throw new Error("拒绝非应用页面请求");
      this.preview.endByOwner(event.sender.id, sessionId);
    });
    ipcMain.handle("desktop:pet-preview-current", (event) => {
      if (!this.isPetSender(event)) throw new Error("拒绝非桌宠页面请求");
      return this.preview.current();
    });
    ipcMain.handle("desktop:pet-preview-report", (event, value: unknown) => {
      if (!this.isPetSender(event)) throw new Error("拒绝非桌宠页面请求");
      this.preview.report(value);
    });
    const alignDisplays = () => {
      if (!this.win || this.win.isDestroyed()) return;
      this.environmentRevision += 1;
      const area = this.environment().workArea;
      this.win.setBounds(
        this.geometry
          ? clampVisiblePet(this.win.getBounds(), this.geometry, area)
          : clampPetBounds(
              this.win.getBounds(),
              screen.getAllDisplays().map((display) => display.workArea),
            ),
        false,
      );
      this.alignChat();
      this.publishEnvironment();
    };
    screen.on("display-metrics-changed", alignDisplays);
    screen.on("display-removed", alignDisplays);
    screen.on("display-added", alignDisplays);
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
    ipcMain.handle(
      "desktop:pet-resources-changed",
      (event, projectId: unknown) => {
        if (
          !this.options.isStudioSender(event) ||
          event.senderFrame !== event.sender.mainFrame ||
          !event.senderFrame ||
          !this.options.trusted(event.senderFrame.url) ||
          typeof projectId !== "string" ||
          !/^[0-9a-f-]{32,36}$/i.test(projectId) ||
          new URL(event.senderFrame.url).pathname !==
            `/apps/desktop-pet/projects/${projectId}/editor`
        )
          throw new Error("拒绝非角色编辑器请求");
        const scope = this.contexts.get(event.sender.id);
        if (!scope) throw new Error("请先登录并选择工作空间");
        if (
          this.projectId === projectId &&
          this.scope === scope &&
          this.win &&
          !this.win.isDestroyed()
        )
          this.win.webContents.send("desktop:pet-resources-changed");
      },
    );
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
      this.alignChat();
      this.publishEnvironment();
      return next;
    });
    ipcMain.handle("desktop:pet-environment", (event) => {
      if (!this.isPetSender(event)) throw new Error("拒绝非桌宠页面请求");
      return this.environment();
    });
    ipcMain.handle(
      "desktop:pet-motion-cancel",
      (event, generation: unknown) => {
        if (!this.isPetSender(event)) throw new Error("拒绝非桌宠页面请求");
        this.motion.cancel(generation);
        return this.environment();
      },
    );
    ipcMain.handle("desktop:pet-motion", (event, value: unknown) => {
      if (!this.isPetSender(event) || !this.win?.isVisible())
        throw new Error("桌宠窗口不可用");
      const win = this.win;
      const request = motionRequest(value, win.getBounds());
      if (!request.manual && (this.chatWin || this.motionLinked))
        throw new Error("聊天或编辑器联动期间已暂停自主运动");
      this.motion.accept(request, this.environmentRevision);
      const next = { ...win.getBounds(), x: request.x, y: request.y };
      const area = request.manual
        ? screen.getDisplayNearestPoint({
            x: Math.round(next.x + request.geometry.feet.x),
            y: Math.round(
              next.y +
                request.geometry.visible.y +
                request.geometry.visible.height / 2,
            ),
          })
        : (screen.getAllDisplays().find((d) => d.id === this.motionDisplayId) ??
          screen.getDisplayMatching(win.getBounds()));
      this.motionDisplayId = area.id;
      this.geometry = request.geometry;
      win.setBounds(
        clampVisiblePet(next, request.geometry, area.workArea),
        false,
      );
      this.alignChat();
      return this.environment();
    });
    ipcMain.handle("desktop:pet-hide", (event) => {
      if (!this.isPetSender(event)) throw new Error("拒绝非桌宠页面请求");
      this.preview.end();
      this.closeChat();
      this.win?.hide();
      this.motion.cancel(this.motion.generation + 1);
      this.publishEnvironment();
    });
    ipcMain.handle("desktop:pet-chat-open", (event) => {
      if (!this.isPetSender(event)) throw new Error("拒绝非桌宠页面请求");
      return this.openChat();
    });
    ipcMain.handle(
      "desktop:pet-chat-open-studio",
      (event, projectId: unknown) => {
        if (
          !this.options.isStudioSender(event) ||
          !this.contexts.has(event.sender.id) ||
          typeof projectId !== "string" ||
          this.projectId !== projectId ||
          this.scope !== this.contexts.get(event.sender.id)
        )
          throw new Error("桌宠聊天项目无效");
        return this.openChat();
      },
    );
    ipcMain.handle("desktop:pet-chat-close", (event) => {
      if (!this.isChatSender(event)) throw new Error("拒绝非聊天页面请求");
      this.closeChat();
    });
    ipcMain.handle("desktop:pet-chat-layout", (event, layout: unknown) => {
      if (
        !this.isChatSender(event) ||
        (layout !== "compact" && layout !== "expanded")
      )
        throw new Error("聊天布局无效");
      this.chatLayout = layout;
      const bounds = this.chatBounds();
      if (!bounds) throw new Error("桌宠窗口不可用");
      const { side, ...rect } = bounds;
      this.chatWin!.setBounds(rect, false);
      return { side };
    });
    ipcMain.handle("desktop:pet-chat-hit", (event, interactive: unknown) => {
      if (!this.isChatSender(event) || typeof interactive !== "boolean")
        throw new Error("聊天交互区域无效");
      this.chatWin!.setIgnoreMouseEvents(!interactive, { forward: true });
    });
    ipcMain.handle("desktop:pet-chat-state", (event, value: unknown) => {
      if (!this.isChatSender(event) || !value || typeof value !== "object")
        throw new Error("聊天状态无效");
      const state = value as { phase?: unknown; text?: unknown };
      if (
        !(["thinking", "speaking", "done", "error"] as unknown[]).includes(
          state.phase,
        ) ||
        typeof state.text !== "string" ||
        state.text.length > 140
      )
        throw new Error("聊天状态无效");
      this.win?.webContents.send("desktop:pet-chat-state", state);
    });
    ipcMain.handle("desktop:pet-show-studio", (event) => {
      if (!this.isPetSender(event)) throw new Error("拒绝非桌宠页面请求");
      this.options.showStudio();
    });
  }
}
