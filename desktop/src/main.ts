import { app, BrowserWindow, ipcMain, Menu, session, shell } from "electron";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Backend } from "./backend";
import { AgentGateway } from "./agent";
import { credentialHeader, externalUrl, isServiceUrl } from "./security";

const defaultDataDir = path.join(
  app.getPath("appData"),
  app.isPackaged ? "Future Props Lab" : "Future Props Lab Development",
);
const testDataDir = process.env.FPL_DESKTOP_TEST_DATA_DIR;
const dataDir =
  process.env.FPL_DESKTOP_TEST_MODE === "1" &&
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
const recovery = path.join(__dirname, "../ui/startup.html");
const preload = path.join(__dirname, "preload.js");

function trusted(url: string): boolean {
  return (
    url === new URL(`file://${recovery}`).href ||
    Boolean(backend?.origin && isServiceUrl(url, backend.origin))
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
    title: "Future Props Lab",
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
  win.once("ready-to-show", () => win.show());
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
      backend?.origin &&
      isServiceUrl(url, backend.origin) &&
      new URL(url).pathname === "/docs.html"
    ) {
      const docs = makeWindow(true);
      void docs.loadURL(url);
    } else if (externalUrl(url) && !isServiceUrl(url, backend?.origin || ""))
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

async function start(): Promise<void> {
  if (starting || quitting) return;
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
        void mainWindow?.loadFile(recovery);
      },
    );
    await backend.start();
    await agent?.start();
    state = { phase: "ready", message: "本地服务已就绪" };
    await mainWindow?.loadURL(backend.origin);
  } catch (error) {
    await backend?.stop();
    state = {
      phase: "failed",
      message: error instanceof Error ? error.message : "启动失败，请查看日志",
    };
    await mainWindow?.loadFile(recovery);
  } finally {
    starting = false;
  }
}

async function shutdown(): Promise<void> {
  await agent?.stop();
  await backend?.stop();
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
        backend?.origin &&
        isServiceUrl(details.url, backend.origin) &&
        (!origin || origin === backend.origin)
      )
        headers[credentialHeader] = backend.token;
      callback({ requestHeaders: headers });
    });
    studio.setPermissionCheckHandler((contents, permission, origin, details) =>
      Boolean(
        contents &&
        backend?.origin &&
        origin === backend.origin &&
        permission === "media" &&
        details.mediaType === "audio",
      ),
    );
    studio.setPermissionRequestHandler(
      (contents, permission, callback, details) =>
        callback(
          Boolean(
            backend?.origin &&
            isServiceUrl(contents.getURL(), backend.origin) &&
            details.requestingUrl &&
            isServiceUrl(details.requestingUrl, backend.origin) &&
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
        { role: "windowMenu" },
      ]),
    );
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
  });
}
