import { AmadeusWindowPreferences } from "./amadeus-window-preferences";
import {
  installPresentationWindows,
  studioPathForNewWindow,
} from "./presentation-windows";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  screen,
  session,
  shell,
} from "electron";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Backend } from "./backend";
import { AgentGateway } from "./agent";
import { credentialHeader, externalUrl, isServiceUrl } from "./security";
import { DevelopmentGateway } from "./development-gateway";
import { DevelopmentSession } from "./development";
import {
  collapsedAmadeusBounds,
  initialAmadeusBounds,
} from "./amadeus-window-geometry";
import { installStorageDirectoryPicker } from "./storage-directory-picker";
import { installExportFiles } from "./export-files";
import { installWebAccess } from "./web-access";
const isDevelopment =
  !app.isPackaged &&
  process.env.FPL_DEV_SESSION === "1" &&
  Boolean(process.send);
const liveDevelopment = isDevelopment && process.env.FPL_DEV_LIVE === "1";

const defaultDataDir = path.join(
  app.getPath("appData"),
  app.isPackaged || liveDevelopment
    ? "Future Props Lab"
    : "Future Props Lab Development",
);
const testDataDir = process.env.FPL_DESKTOP_TEST_DATA_DIR;
const dataDir =
  isDevelopment && !liveDevelopment && process.env.FPL_DEV_DATA_DIR
    ? path.resolve(process.env.FPL_DEV_DATA_DIR)
    : process.env.FPL_DESKTOP_TEST_MODE === "1" &&
        testDataDir &&
        path.isAbsolute(testDataDir)
      ? path.resolve(testDataDir)
      : defaultDataDir;
app.setPath("userData", dataDir);
app.setName("Future Props Lab");

const studioWindows = new Set<BrowserWindow>();
let amadeusWindow: BrowserWindow | undefined;
let amadeusStageOpen = false;
let amadeusCollapsedWidth = 520;
const studioContexts = new Map<number, Record<string, unknown>>();
let focusedStudio: BrowserWindow | undefined;
let backend: Backend | undefined;
let agent: AgentGateway | undefined;
let starting = false;
let quitting = false;
let shutdownComplete = false;
let quitPending: Set<number> | null = null;
let state = { phase: "starting", message: "正在启动本地研究所…" };
let gateway: DevelopmentGateway | undefined;
const development = isDevelopment
  ? new DevelopmentSession(
      liveDevelopment,
      () => BrowserWindow.getAllWindows(),
      () => syncDevelopmentChrome(),
    )
  : undefined;
const pageOrigin = () => gateway?.origin || backend?.origin || "";
const recovery = path.join(__dirname, "../ui/startup.html");
const preload = path.join(__dirname, "preload.js");
const amadeusPreferences = new AmadeusWindowPreferences(dataDir);
let amadeusAlwaysOnTopPreference =
  amadeusPreferences.read().alwaysOnTop !== false;

function saveAmadeusBounds(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
  amadeusPreferences.write({
    ...collapsedAmadeusBounds(
      win.getBounds(),
      amadeusStageOpen,
      amadeusCollapsedWidth,
    ),
    alwaysOnTop: amadeusAlwaysOnTopPreference,
  });
}

function syncAmadeusAlwaysOnTopSurface(): void {
  if (!amadeusWindow || amadeusWindow.isDestroyed()) return;
  const focused = BrowserWindow.getFocusedWindow();
  const keep =
    amadeusAlwaysOnTopPreference &&
    Boolean(
      focused && (studioWindows.has(focused) || focused === amadeusWindow),
    );
  amadeusWindow.setAlwaysOnTop(keep, "floating");
}

function applyAmadeusAlwaysOnTop(enabled: boolean): boolean {
  amadeusAlwaysOnTopPreference = enabled;
  amadeusPreferences.write({ alwaysOnTop: enabled });
  if (amadeusWindow && !amadeusWindow.isDestroyed()) {
    if (!enabled) amadeusWindow.setAlwaysOnTop(false);
    else syncAmadeusAlwaysOnTopSurface();
  }
  return amadeusAlwaysOnTopPreference;
}

function queueAmadeusAlwaysOnTopSync(): void {
  setImmediate(() => syncAmadeusAlwaysOnTopSurface());
}

function developmentWindowTitle(session: DevelopmentSession): string {
  const mode = `开发模式 · ${session.state.live ? "正式数据" : "开发数据"}`;
  const detail =
    session.state.phase === "error"
      ? "检查失败"
      : session.state.phase === "checking"
        ? "正在检查…"
        : session.state.phase === "applying"
          ? "正在应用…"
          : session.state.pending.length
            ? "有更新待应用"
            : null;
  return detail
    ? `${mode} · ${detail} — Future Props Lab`
    : `${mode} — Future Props Lab`;
}

function liveStudioWindows(): BrowserWindow[] {
  return [...studioWindows].filter((win) => !win.isDestroyed());
}

function activeStudio(): BrowserWindow | undefined {
  if (focusedStudio && !focusedStudio.isDestroyed()) return focusedStudio;
  return liveStudioWindows()[0];
}

function showStudio(win = activeStudio()): void {
  if (!win || win.isDestroyed()) return;
  win.show();
  win.focus();
}

function trackStudio(win: BrowserWindow): void {
  studioWindows.add(win);
  focusedStudio = win;
  win.on("focus", () => {
    focusedStudio = win;
    queueAmadeusAlwaysOnTopSync();
    amadeusWindow?.webContents.send(
      "desktop:amadeus-contexts",
      availableContexts(),
    );
  });
  win.on("blur", queueAmadeusAlwaysOnTopSync);
  win.on("closed", () => {});
}

function availableContexts() {
  return liveStudioWindows().map((win) => ({
    windowId: win.webContents.id,
    focused: focusedStudio === win,
    ...(studioContexts.get(win.webContents.id) || {
      title: win.getTitle(),
      path: "/",
    }),
  }));
}

function isTrustedAmadeusSender(event: {
  sender: Electron.WebContents;
  senderFrame: Electron.WebFrameMain | null;
}): boolean {
  return Boolean(
    amadeusWindow &&
    !amadeusWindow.isDestroyed() &&
    event.sender === amadeusWindow.webContents &&
    event.senderFrame === event.sender.mainFrame &&
    event.senderFrame &&
    trusted(event.senderFrame.url) &&
    new URL(event.senderFrame.url).pathname === "/amadeus.html",
  );
}

function applyAmadeusStageOpen(enabled: boolean): boolean {
  const win = amadeusWindow;
  if (!win || win.isDestroyed() || amadeusStageOpen === enabled)
    return amadeusStageOpen;
  const bounds = win.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  if (enabled) amadeusCollapsedWidth = bounds.width;
  const width = enabled
    ? Math.min(area.width, bounds.width + 360)
    : Math.max(400, amadeusCollapsedWidth);
  const x = enabled
    ? Math.max(area.x, bounds.x - (width - bounds.width))
    : Math.min(area.x + area.width - width, bounds.x + bounds.width - width);
  win.setBounds({ ...bounds, x, width }, true);
  amadeusStageOpen = enabled;
  return enabled;
}

async function showAmadeus(): Promise<void> {
  if (quitting || state.phase !== "ready" || !pageOrigin()) return;
  if (amadeusWindow && !amadeusWindow.isDestroyed()) {
    amadeusWindow.show();
    amadeusWindow.focus();
    queueAmadeusAlwaysOnTopSync();
    return;
  }
  const workArea = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  ).workArea;
  const bounds = amadeusPreferences.bounds();
  const initialBounds = initialAmadeusBounds(bounds, workArea);
  const win = new BrowserWindow({
    ...initialBounds,
    minWidth: 400,
    minHeight: 500,
    show: false,
    title: "Amadeus",
    backgroundColor: "#fffaf6",
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      partition: "persist:studio",
      backgroundThrottling: false,
    },
  });
  amadeusWindow = win;
  amadeusStageOpen = false;
  amadeusCollapsedWidth = win.getBounds().width;
  syncAmadeusAlwaysOnTopSurface();
  let boundsTimer: ReturnType<typeof setTimeout> | undefined;
  const queueBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => saveAmadeusBounds(win), 300);
  };
  win.on("move", queueBounds);
  win.on("resize", queueBounds);
  win.on("focus", queueAmadeusAlwaysOnTopSync);
  win.on("blur", queueAmadeusAlwaysOnTopSync);
  win.once("ready-to-show", () => {
    syncAmadeusAlwaysOnTopSurface();
    win.show();
  });
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });
  win.on("closed", () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    if (amadeusWindow === win) amadeusWindow = undefined;
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (trusted(url) && new URL(url).pathname === "/amadeus.html") return;
    event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("did-finish-load", () => {
    applyAmadeusStageOpen(false);
    win.webContents.send("desktop:amadeus-contexts", availableContexts());
  });
  await win.loadURL(pageOrigin() + "/amadeus.html");
}

function isTrustedStudioSender(event: {
  sender: Electron.WebContents;
  senderFrame: Electron.WebFrameMain | null;
}): boolean {
  const win = BrowserWindow.fromWebContents(event.sender);
  return Boolean(
    win &&
    studioWindows.has(win) &&
    !win.isDestroyed() &&
    event.senderFrame === event.sender.mainFrame &&
    event.senderFrame &&
    trusted(event.senderFrame.url),
  );
}

async function openStudioWindow(pathname = "/"): Promise<BrowserWindow> {
  const win = makeWindow(false);
  if (state.phase === "ready" && pageOrigin())
    await win.loadURL(pageOrigin() + pathname);
  else await win.loadFile(recovery);
  return win;
}

function notifyDevelopmentShortcut(action: "apply" | "check"): void {
  for (const win of liveStudioWindows()) {
    if (win.webContents.isCrashed()) continue;
    win.webContents.send("desktop:development-menu-action", action);
  }
}

function installApplicationMenu() {
  // Visible File/Development menus live in App chrome; keep accelerators only.
  const acceleratorItems = [
    {
      label: "新建窗口",
      accelerator: "CmdOrCtrl+N",
      visible: false,
      click: () => {
        if (state.phase !== "ready" || quitting) return;
        void openStudioWindow(
          studioPathForNewWindow(
            activeStudio()?.webContents.getURL(),
            pageOrigin(),
          ),
        );
      },
    },
    ...(development
      ? [
          {
            label: "应用开发更新",
            accelerator: "CmdOrCtrl+Shift+U",
            visible: false,
            click: () => {
              if (!development) return;
              notifyDevelopmentShortcut(
                development.state.phase === "error" ? "check" : "apply",
              );
            },
          },
        ]
      : []),
  ];
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          ...acceleratorItems,
          { type: "separator" },
          {
            label: "退出研究所",
            accelerator: "Cmd+Q",
            click: () => app.quit(),
          },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
}

function syncDevelopmentChrome() {
  if (!development) return;
  const title = developmentWindowTitle(development);
  for (const win of liveStudioWindows()) win.setTitle(title);
}

function trusted(url: string): boolean {
  return (
    url === new URL(`file://${recovery}`).href ||
    Boolean(pageOrigin() && isServiceUrl(url, pageOrigin()))
  );
}

function loadRecoveryOnStudioWindows(): void {
  for (const win of liveStudioWindows()) void win.loadFile(recovery);
}

function makeWindow(document = false): BrowserWindow {
  const win = new BrowserWindow({
    width: document ? 1060 : 1440,
    height: 940,
    minWidth: 760,
    minHeight: 560,
    show: false,
    backgroundColor: "#141820",
    title: development
      ? developmentWindowTitle(development)
      : "Future Props Lab",
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      partition: "persist:studio",
      backgroundThrottling: false,
      additionalArguments: development ? ["--fpl-development-bridge"] : [],
    },
  });
  win.once("ready-to-show", () => win.show());
  if (development)
    win.on("page-title-updated", (event) => event.preventDefault());
  win.webContents.on("will-navigate", (event, url) => {
    if (trusted(url)) return;
    event.preventDefault();
    if (externalUrl(url)) void shell.openExternal(url);
  });
  win.webContents.on("will-redirect", (event, url) => {
    if (!trusted(url)) event.preventDefault();
  });
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  win.webContents.on("will-frame-navigate", (event) => {
    if (!trusted(event.url)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (
      pageOrigin() &&
      isServiceUrl(url, pageOrigin()) &&
      new URL(url).pathname === "/docs.html"
    ) {
      const docs = makeWindow(true);
      void docs.loadURL(url);
    } else if (externalUrl(url) && !isServiceUrl(url, pageOrigin()))
      void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-prevent-unload", () => {
    quitting = false;
    quitPending = null;
  });
  if (!document) {
    trackStudio(win);
    const contentsId = win.webContents.id;
    win.on("close", (event) => {
      if (quitting) return;
      const remaining = liveStudioWindows().filter((other) => other !== win);
      if (remaining.length > 0) return;
      event.preventDefault();
      win.hide();
    });
    win.on("closed", () => {
      studioWindows.delete(win);
      studioContexts.delete(contentsId);
      amadeusWindow?.webContents.send(
        "desktop:amadeus-contexts",
        availableContexts(),
      );
      if (focusedStudio === win) focusedStudio = liveStudioWindows()[0];
      if (quitPending) {
        quitPending.delete(contentsId);
        if (quitPending.size === 0 && !quitting) {
          quitPending = null;
          quitting = true;
          const remaining = liveStudioWindows();
          if (!remaining.length) void shutdown();
          else for (const open of remaining) open.close();
          return;
        }
      }
      if (quitting && liveStudioWindows().length === 0) void shutdown();
    });
    win.webContents.on("render-process-gone", () => {
      state = {
        phase: "failed",
        message: "页面异常退出。可点击重试重新连接。",
      };
      void win.loadFile(recovery);
    });
  }
  return win;
}

function requestQuitApprovals(): void {
  const windows = liveStudioWindows().filter(
    (win) => state.phase === "ready" && !win.webContents.isCrashed(),
  );
  if (!windows.length) {
    quitting = true;
    void shutdown();
    return;
  }
  quitPending = new Set(windows.map((win) => win.webContents.id));
  for (const win of windows) {
    win.show();
    win.webContents.send("desktop:quit-requested");
  }
}

async function start(navigate = true, webConfig?: unknown): Promise<boolean> {
  if (starting || quitting) return false;
  starting = true;
  state = { phase: "starting", message: "正在启动本地研究所…" };
  try {
    await agent?.stop();
    await backend?.stop();
    backend = new Backend(
      dataDir,
      app.isPackaged,
      process.resourcesPath,
      () => {
        if (quitting) return;
        void agent?.stop();
        state = {
          phase: "failed",
          message: "本地服务已停止。未自动重启，请查看日志后重试。",
        };
        if (development) {
          development.update({
            ...development.state,
            phase: "error",
            message: "后端已停止，请应用更新或重试",
          });
          development.send("backend-crashed");
        } else loadRecoveryOnStudioWindows();
      },
      development ? 4 : undefined,
    );
    await backend.start(webConfig);
    await agent?.start();
    state = { phase: "ready", message: "本地服务已就绪" };
    if (navigate) {
      const restored =
        development &&
        process.env.FPL_DEV_RESTORE_PATH?.startsWith("/") &&
        !process.env.FPL_DEV_RESTORE_PATH.startsWith("//")
          ? process.env.FPL_DEV_RESTORE_PATH
          : "/";
      const targets = liveStudioWindows();
      await Promise.all(
        targets.map((win) => win.loadURL(pageOrigin() + restored)),
      );
    }
    return true;
  } catch (error) {
    await backend?.stop();
    state = {
      phase: "failed",
      message: error instanceof Error ? error.message : "启动失败，请查看日志",
    };
    if (navigate) loadRecoveryOnStudioWindows();
    return false;
  } finally {
    starting = false;
  }
}

async function shutdown(): Promise<void> {
  await agent?.stop();
  await backend?.stop();
  await gateway?.stop();
  shutdownComplete = true;
  app.quit();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    showStudio();
  });
  app.on("activate", () => {
    const existing = activeStudio();
    if (existing) showStudio(existing);
    else if (state.phase === "ready") void openStudioWindow();
    else {
      const win = makeWindow(false);
      void win.loadFile(recovery);
      if (state.phase === "ready") void start();
    }
  });
  app.on("window-all-closed", () => undefined);
  app.on("before-quit", (event) => {
    if (shutdownComplete) return;
    event.preventDefault();
    if (quitting) return;
    requestQuitApprovals();
  });
  void app.whenReady().then(async () => {
    if (!app.isPackaged)
      app.dock?.setIcon(path.join(__dirname, "../assets/app-icon.png"));
    mkdirSync(path.join(dataDir, "logs"), { recursive: true, mode: 0o700 });
    if (development) {
      gateway = new DevelopmentGateway(process.env.FPL_DEV_VITE_URL!, () =>
        state.phase === "ready" ? backend : undefined,
      );
      await gateway.start();
      process.on(
        "message",
        async (value: {
          type: string;
          state?: typeof development.state;
          restartBackend?: boolean;
          reloadPage?: boolean;
        }) => {
          if (value.type === "state" && value.state)
            development.update(value.state);
          if (value.type === "stop-backend") {
            state = { phase: "updating", message: "正在更新本地服务" };
            await agent?.stop();
            await backend?.stop();
            backend = undefined;
            development.send("backend-stopped");
          }
          if (value.type === "update") {
            const success = !value.restartBackend || (await start(false));
            if (success && value.reloadPage) {
              for (const win of BrowserWindow.getAllWindows())
                if (trusted(win.webContents.getURL())) win.webContents.reload();
            }
            development.send("updated", {
              success,
              configDigest: backend?.configDigest,
            });
          }
          if (value.type === "restart") {
            const current = activeStudio()?.webContents.getURL();
            if (current && isServiceUrl(current, pageOrigin())) {
              const url = new URL(current);
              development.send("location", {
                path: url.pathname + url.search + url.hash,
              });
            }
            quitting = true;
            quitPending = null;
            amadeusWindow?.destroy();
            for (const win of liveStudioWindows()) win.close();
            if (liveStudioWindows().length === 0) void shutdown();
          }
          if (value.type === "quit") app.quit();
        },
      );
      process.on("disconnect", () => {
        quitting = true;
        quitPending = null;
        void shutdown();
      });
    }
    const studio = session.fromPartition("persist:studio");
    studio.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = details.requestHeaders;
      for (const key of Object.keys(headers))
        if (
          key.toLowerCase() === credentialHeader.toLowerCase() ||
          key.toLowerCase() === "x-fpl-agent-channel"
        )
          delete headers[key];
      const origin = Object.entries(headers).find(
        ([key]) => key.toLowerCase() === "origin",
      )?.[1];
      if (
        pageOrigin() &&
        isServiceUrl(details.url, pageOrigin()) &&
        (!origin || origin === pageOrigin())
      )
        headers[credentialHeader] = gateway?.token || backend!.token;
      callback({ requestHeaders: headers });
    });
    studio.setPermissionCheckHandler((contents, permission, origin, details) =>
      Boolean(
        contents &&
        pageOrigin() &&
        origin === pageOrigin() &&
        permission === "media" &&
        details.mediaType === "audio",
      ),
    );
    studio.setPermissionRequestHandler(
      (contents, permission, callback, details) =>
        callback(
          Boolean(
            pageOrigin() &&
            isServiceUrl(contents.getURL(), pageOrigin()) &&
            details.requestingUrl &&
            isServiceUrl(details.requestingUrl, pageOrigin()) &&
            permission === "media" &&
            "mediaTypes" in details &&
            details.mediaTypes?.length &&
            details.mediaTypes.every((type) => type === "audio"),
          ),
        ),
    );
    const actions: Record<string, (win: BrowserWindow) => unknown> = {
      status: () => state,
      retry: () => {
        if (state.phase === "failed") void start();
      },
      logs: () => shell.openPath(path.join(dataDir, "logs")),
      minimize: (win) => win.minimize(),
      close: (win) => win.close(),
      "open-new-window": (win) => {
        if (state.phase !== "ready" || quitting) return;
        openStudioWindow(
          studioPathForNewWindow(win.webContents.getURL(), pageOrigin()),
        );
      },
      "agent-status": () => agent?.status(),
      "agent-enable": () => agent?.setEnabled(true),
      "agent-disable": () => agent?.setEnabled(false),
    };
    if (development)
      Object.assign(actions, {
        "development-status": () => development.state,
        "development-apply": () => development.apply(),
        "development-check": () => development.send("check"),
      });
    for (const [name, action] of Object.entries(actions))
      ipcMain.handle(`desktop:${name}`, (event) => {
        if (!isTrustedStudioSender(event))
          throw new Error("拒绝非应用页面请求");
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) throw new Error("拒绝非应用页面请求");
        return action(win);
      });
    installStorageDirectoryPicker(isTrustedStudioSender);
    installWebAccess({
      trusted: isTrustedStudioSender,
      backend: () => backend,
      windows: liveStudioWindows,
      apply: async (profile) => {
        state = { phase: "starting", message: "正在备份数据并应用连接配置…" };
        const success = await start(true, profile);
        development?.send("ready", {
          success,
          configDigest: backend?.configDigest,
        });
        return success;
      },
    });
    installExportFiles(isTrustedStudioSender, studio);
    installPresentationWindows({
      trusted: isTrustedStudioSender,
      create: () => makeWindow(true),
      origin: pageOrigin,
      track: trackStudio,
      untrack: (window) => {
        studioWindows.delete(window);
        studioContexts.delete(window.webContents.id);
      },
    });
    ipcMain.handle("desktop:amadeus-open", (event) => {
      if (!isTrustedStudioSender(event)) throw new Error("拒绝非应用页面请求");
      return showAmadeus();
    });
    ipcMain.handle("desktop:amadeus-hide", (event) => {
      if (!isTrustedAmadeusSender(event)) throw new Error("拒绝非助手页面请求");
      amadeusWindow?.hide();
    });
    ipcMain.handle("desktop:amadeus-stage", (event, enabled: unknown) => {
      if (!isTrustedAmadeusSender(event)) throw new Error("拒绝非助手页面请求");
      if (typeof enabled !== "boolean") throw new Error("角色舞台状态无效");
      return applyAmadeusStageOpen(enabled);
    });
    ipcMain.handle(
      "desktop:amadeus-always-on-top",
      (event, enabled?: unknown) => {
        if (!isTrustedAmadeusSender(event))
          throw new Error("拒绝非助手页面请求");
        if (enabled === undefined) return amadeusAlwaysOnTopPreference;
        if (typeof enabled !== "boolean") throw new Error("置顶偏好无效");
        return applyAmadeusAlwaysOnTop(enabled);
      },
    );
    ipcMain.handle("desktop:amadeus-mutation", (event, value: unknown) => {
      if (
        !isTrustedAmadeusSender(event) ||
        !value ||
        typeof value !== "object" ||
        JSON.stringify(value).length > 1000
      )
        throw new Error("资源通知无效");
      const target = value as { userId?: unknown; accountId?: unknown };
      if (
        typeof target.userId !== "string" ||
        typeof target.accountId !== "string"
      )
        throw new Error("资源通知缺少租户范围");
      for (const win of liveStudioWindows()) {
        const context = studioContexts.get(win.webContents.id);
        if (
          context?.userId === target.userId &&
          context.accountId === target.accountId
        )
          win.webContents.send("desktop:amadeus-mutation", value);
      }
    });
    ipcMain.handle("desktop:amadeus-locate", (event, value: unknown) => {
      if (!isTrustedAmadeusSender(event) || !value || typeof value !== "object")
        throw new Error("引用无效");
      const item = value as { windowId?: number; id?: string };
      if (
        !Number.isInteger(item.windowId) ||
        typeof item.id !== "string" ||
        item.id.length > 120
      )
        throw new Error("引用无效");
      const source = liveStudioWindows().find(
        (win) => win.webContents.id === item.windowId,
      );
      if (!source) return false;
      source.show();
      source.focus();
      source.webContents.send("desktop:amadeus-locate", { id: item.id });
      return true;
    });
    ipcMain.handle(
      "desktop:amadeus-context-publish",
      (event, value: unknown) => {
        if (!isTrustedStudioSender(event))
          throw new Error("拒绝非应用页面请求");
        if (
          !value ||
          typeof value !== "object" ||
          JSON.stringify(value).length > 12_000
        )
          throw new Error("上下文无效");
        studioContexts.set(event.sender.id, value as Record<string, unknown>);
        amadeusWindow?.webContents.send(
          "desktop:amadeus-contexts",
          availableContexts(),
        );
      },
    );
    ipcMain.handle("desktop:amadeus-contexts", (event) => {
      if (!isTrustedAmadeusSender(event)) throw new Error("拒绝非助手页面请求");
      return availableContexts();
    });
    ipcMain.handle(
      "desktop:amadeus-pick",
      (event, enabled: boolean, index?: number) => {
        if (!isTrustedAmadeusSender(event))
          throw new Error("拒绝非助手页面请求");
        const source = activeStudio();
        if (!source) return false;
        source.show();
        source.focus();
        source.webContents.send("desktop:amadeus-pick-command", {
          enabled: Boolean(enabled),
          index:
            typeof index === "number" &&
            Number.isSafeInteger(index) &&
            index > 0
              ? Math.min(index, 20)
              : 1,
        });
        return true;
      },
    );
    ipcMain.handle("desktop:amadeus-pick-finished", (event) => {
      if (!isTrustedStudioSender(event))
        throw new Error("拒绝非 Studio 页面请求");
      amadeusWindow?.webContents.send("desktop:amadeus-pick-finished");
    });
    ipcMain.handle(
      "desktop:amadeus-reference",
      async (event, value: unknown) => {
        if (
          !isTrustedStudioSender(event) ||
          !amadeusWindow ||
          !value ||
          typeof value !== "object"
        )
          throw new Error("引用来源无效");
        const item = value as Record<string, unknown>;
        let thumbnail: string | undefined;
        const rect = item.rect as Record<string, number> | undefined;
        if (
          rect &&
          [rect.x, rect.y, rect.width, rect.height].every(
            (number) => typeof number === "number" && Number.isFinite(number),
          ) &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.width <= 900 &&
          rect.height <= 700
        ) {
          const win = BrowserWindow.fromWebContents(event.sender);
          const shot = await win?.webContents.capturePage({
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          });
          thumbnail = shot?.resize({ width: 180 }).toDataURL();
        }
        amadeusWindow.webContents.send("desktop:amadeus-reference-added", {
          ...item,
          rect: undefined,
          thumbnail,
          windowId: event.sender.id,
        });
        amadeusWindow.show();
        amadeusWindow.focus();
      },
    );
    ipcMain.on("desktop:quit-approved", (event) => {
      if (!isTrustedStudioSender(event) || !quitPending) return;
      quitPending.delete(event.sender.id);
      if (quitPending.size > 0) return;
      quitPending = null;
      quitting = true;
      const windows = liveStudioWindows();
      if (!windows.length) {
        void shutdown();
        return;
      }
      for (const win of windows) win.close();
    });
    ipcMain.on("desktop:quit-cancelled", (event) => {
      if (!isTrustedStudioSender(event)) return;
      quitting = false;
      quitPending = null;
    });
    installApplicationMenu();
    const main = makeWindow(false);
    agent = new AgentGateway(
      dataDir,
      () => backend,
      () => showStudio(),
    );
    await main.loadFile(recovery);
    await start();
    development?.send("ready", {
      success: state.phase === "ready",
      configDigest: backend?.configDigest,
    });
  });
}
