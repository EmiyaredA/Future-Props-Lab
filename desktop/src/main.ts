import { app, BrowserWindow, ipcMain, Menu, session, shell } from "electron";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Backend } from "./backend";
import { AgentGateway } from "./agent";
import { credentialHeader, externalUrl, isServiceUrl } from "./security";
import { DevelopmentGateway } from "./development-gateway";
import { DevelopmentSession } from "./development";

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
let mainWindow: BrowserWindow | undefined;
let backend: Backend | undefined;
let agent: AgentGateway | undefined;
let starting = false;
let quitting = false;
let shutdownComplete = false;
let state = { phase: "starting", message: "正在启动本地研究所…" };
let gateway: DevelopmentGateway | undefined;
const development = isDevelopment
  ? new DevelopmentSession(liveDevelopment, () => BrowserWindow.getAllWindows(), () =>
      syncDevelopmentChrome(),
    )
  : undefined;
const pageOrigin = () => gateway?.origin || backend?.origin || "";
const recovery = path.join(__dirname, "../ui/startup.html");
const preload = path.join(__dirname, "preload.js");

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

function installApplicationMenu() {
  const developmentMenu = development
    ? [
        {
          label: "开发",
          submenu: [
            {
              label: development.state.live ? "当前：正式数据" : "当前：开发数据",
              enabled: false,
            },
            {
              label: development.state.message,
              enabled: false,
            },
            { type: "separator" as const },
            {
              label:
                development.state.phase === "error"
                  ? "重新检查"
                  : development.state.phase === "applying"
                    ? "正在应用…"
                    : development.state.phase === "checking"
                      ? "正在检查…"
                      : "应用更新",
              accelerator: "CmdOrCtrl+Shift+U",
              enabled:
                development.state.phase === "error" ||
                (development.state.pending.length > 0 &&
                  development.state.phase === "ready"),
              click: () => {
                if (!mainWindow || mainWindow.webContents.isCrashed()) return;
                mainWindow.webContents.send(
                  "desktop:development-menu-action",
                  development.state.phase === "error" ? "check" : "apply",
                );
              },
            },
          ],
        },
      ]
    : [];
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
          {
            label: "退出研究所",
            accelerator: "Cmd+Q",
            click: () => app.quit(),
          },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      ...developmentMenu,
      { role: "windowMenu" },
    ]),
  );
}

function syncDevelopmentChrome() {
  if (!development) return;
  const title = developmentWindowTitle(development);
  for (const win of BrowserWindow.getAllWindows()) win.setTitle(title);
  installApplicationMenu();
}

function trusted(url: string): boolean {
  return (
    url === new URL(`file://${recovery}`).href ||
    Boolean(pageOrigin() && isServiceUrl(url, pageOrigin()))
  );
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
  });
  if (!document) {
    win.on("close", (event) => {
      if (!quitting) {
        event.preventDefault();
        win.hide();
      }
    });
    win.on("closed", () => {
      mainWindow = undefined;
      if (quitting) void shutdown();
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

async function start(navigate = true): Promise<boolean> {
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
        } else void mainWindow?.loadFile(recovery);
      },
      development ? 4 : undefined,
    );
    await backend.start();
    await agent?.start();
    state = { phase: "ready", message: "本地服务已就绪" };
    if (navigate) {
      const restored =
        development &&
        process.env.FPL_DEV_RESTORE_PATH?.startsWith("/") &&
        !process.env.FPL_DEV_RESTORE_PATH.startsWith("//")
          ? process.env.FPL_DEV_RESTORE_PATH
          : "/";
      await mainWindow?.loadURL(pageOrigin() + restored);
    }
    return true;
  } catch (error) {
    await backend?.stop();
    state = {
      phase: "failed",
      message: error instanceof Error ? error.message : "启动失败，请查看日志",
    };
    if (navigate) await mainWindow?.loadFile(recovery);
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
    mainWindow?.show();
    mainWindow?.focus();
  });
  app.on("activate", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  app.on("window-all-closed", () => undefined);
  app.on("before-quit", (event) => {
    if (shutdownComplete) return;
    event.preventDefault();
    if (quitting) return;
    if (
      mainWindow &&
      state.phase === "ready" &&
      !mainWindow.webContents.isCrashed()
    ) {
      mainWindow.show();
      mainWindow.webContents.send("desktop:quit-requested");
    } else {
      quitting = true;
      void shutdown();
    }
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
            const current = mainWindow?.webContents.getURL();
            if (current && isServiceUrl(current, pageOrigin())) {
              const url = new URL(current);
              development.send("location", {
                path: url.pathname + url.search + url.hash,
              });
            }
            quitting = true;
            void shutdown();
          }
          if (value.type === "quit") app.quit();
        },
      );
      process.on("disconnect", () => {
        quitting = true;
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
    studio.on("will-download", (_event, item) => {
      item.setSaveDialogOptions({
        title: "保存导出文件",
        defaultPath: path.join(
          app.getPath("downloads"),
          path.basename(item.getFilename()),
        ),
      });
    });
    const actions: Record<string, () => unknown> = {
      status: () => state,
      retry: () => {
        if (state.phase === "failed") void start();
      },
      logs: () => shell.openPath(path.join(dataDir, "logs")),
      minimize: () => mainWindow?.minimize(),
      close: () => mainWindow?.close(),
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
        if (
          event.sender !== mainWindow?.webContents ||
          event.senderFrame !== event.sender.mainFrame ||
          !trusted(event.senderFrame.url)
        )
          throw new Error("拒绝非应用页面请求");
        return action();
      });
    ipcMain.on("desktop:quit-approved", (event) => {
      if (
        event.sender !== mainWindow?.webContents ||
        event.senderFrame !== event.sender.mainFrame ||
        !trusted(event.senderFrame.url)
      )
        return;
      quitting = true;
      mainWindow.close();
    });
    installApplicationMenu();
    mainWindow = makeWindow();
    agent = new AgentGateway(
      dataDir,
      () => backend,
      () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    );
    await mainWindow.loadFile(recovery);
    await start();
    development?.send("ready", {
      success: state.phase === "ready",
      configDigest: backend?.configDigest,
    });
  });
}
