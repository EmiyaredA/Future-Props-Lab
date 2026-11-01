import {
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
} from "electron";
import { createHash, randomUUID } from "node:crypto";
import { request } from "node:http";
import { credentialHeader } from "./security";

type Options = {
  trusted: (event: IpcMainInvokeEvent) => boolean;
  backend: () => { origin: string; token: string } | undefined;
  windows: () => BrowserWindow[];
  apply: (profile: unknown) => Promise<boolean>;
};

export function installWebAccess(options: Options): void {
  let busy = false;
  let approval:
    | { id: string; remaining: Set<number>; finish: (ok: boolean) => void }
    | undefined;
  ipcMain.on(
    "desktop:web-access-approved",
    (event, id: string, ok: boolean) => {
      if (
        !options.trusted(event) ||
        approval?.id !== id ||
        !approval.remaining.has(event.sender.id)
      )
        return;
      if (!ok) approval.finish(false);
      else {
        approval.remaining.delete(event.sender.id);
        if (!approval.remaining.size) approval.finish(true);
      }
    },
  );
  const approve = () =>
    new Promise<boolean>((resolve) => {
      const windows = options.windows();
      const timer = setTimeout(() => approval?.finish(false), 60_000);
      approval = {
        id: randomUUID(),
        remaining: new Set(windows.map((win) => win.webContents.id)),
        finish: (ok) => {
          clearTimeout(timer);
          approval = undefined;
          resolve(ok);
        },
      };
      if (!windows.length) approval.finish(false);
      else
        for (const win of windows)
          win.webContents.send("desktop:web-access-prepare", approval.id);
    });
  async function post(
    endpoint: string,
    body: unknown,
    event: IpcMainInvokeEvent,
  ): Promise<unknown> {
    const backend = options.backend();
    if (!backend) throw new Error("本地服务尚未就绪");
    const cookies = (
      await event.sender.session.cookies.get({ url: backend.origin })
    ).filter((cookie) => ["fpl_session", "fpl_csrf"].includes(cookie.name));
    return new Promise((resolve, reject) => {
      const req = request(
        `${backend.origin}/v1/desktop/web-access/${endpoint}`,
        {
          method: "POST",
          headers: {
            [credentialHeader]: backend.token,
            "Content-Type": "application/json",
            Origin: backend.origin,
            Cookie: cookies
              .map((cookie) => `${cookie.name}=${cookie.value}`)
              .join("; "),
            "X-CSRF-Token":
              cookies.find((cookie) => cookie.name === "fpl_csrf")?.value || "",
            "x-fpl-native-web-access": createHash("sha256")
              .update("web-access:" + backend.token)
              .digest("hex"),
          },
          timeout: 15_000,
        },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            data += chunk;
            if (data.length > 16384) req.destroy();
          });
          res.on("error", reject);
          res.on("end", () => {
            if (res.statusCode !== 200) {
              reject(new Error("操作已失效或被拒绝，请重新开始"));
              return;
            }
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error("本地服务响应无效"));
            }
          });
        },
      );
      req.on("error", () => reject(new Error("无法连接本地服务")));
      req.on("timeout", () => req.destroy());
      req.end(JSON.stringify(body));
    });
  }
  ipcMain.handle(
    "desktop:web-access-pick",
    async (event, ticket: string, kind: string) => {
      if (
        !options.trusted(event) ||
        busy ||
        typeof ticket !== "string" ||
        ticket.length > 128 ||
        !["identity", "known_hosts"].includes(kind)
      )
        throw new Error("凭据导入请求无效");
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) return null;
      busy = true;
      try {
        const result = await dialog.showOpenDialog(window, {
          title:
            kind === "identity"
              ? "导入专用 SSH 私钥"
              : "导入可信主机 known_hosts",
          buttonLabel: "导入",
          properties: ["openFile", "showHiddenFiles"],
        });
        return result.canceled || !result.filePaths[0]
          ? null
          : await post(
              "credentials/import",
              {
                ticket,
                path: result.filePaths[0],
              },
              event,
            );
      } finally {
        busy = false;
      }
    },
  );
  ipcMain.handle("desktop:web-access-apply", async (event, receipt: string) => {
    if (
      !options.trusted(event) ||
      busy ||
      typeof receipt !== "string" ||
      receipt.length > 128
    )
      throw new Error("配置更新请求无效");
    busy = true;
    try {
      if (!(await approve()))
        throw new Error("更新已取消，或有窗口未完成保存确认");
      const profile = await post("config/claim", { receipt }, event);
      if (!(await options.apply(profile)))
        throw new Error("配置未能应用，请查看启动日志后重试");
    } finally {
      busy = false;
    }
  });
}
