import { randomUUID } from "node:crypto";
import { writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
  type Session,
} from "electron";

/** A renderer can only write to a destination chosen in the native save dialog. */
export function installExportFiles(
  trusted: (event: IpcMainInvokeEvent) => boolean,
  session: Session,
) {
  session.on("will-download", (_event, item) => {
    item.setSaveDialogOptions({
      title: "保存导出文件",
      defaultPath: path.join(
        app.getPath("downloads"),
        path.basename(item.getFilename()),
      ),
    });
  });
  const pending = new Set<number>();
  const saved = new Map<number, { id: string; path: string }>();
  ipcMain.handle(
    "desktop:export-save",
    async (event, filename: unknown, bytes: unknown) => {
      if (!trusted(event)) throw new Error("拒绝非应用页面请求");
      if (
        typeof filename !== "string" ||
        !filename ||
        filename.length > 240 ||
        /[/\\\x00-\x1f]/.test(filename) ||
        !/\.(pptx|json|fplppt)$/i.test(filename) ||
        !(bytes instanceof Uint8Array) ||
        !bytes.byteLength ||
        bytes.byteLength > 256 * 1024 * 1024
      )
        throw new Error("导出文件参数无效或文件超过 256 MiB");
      const owner = event.sender.id;
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window || pending.has(owner))
        throw new Error("保存窗口不可用或正在保存其他文件");
      pending.add(owner);
      try {
        const extension = path.extname(filename).slice(1).toLowerCase();
        const result = await dialog.showSaveDialog(window, {
          title: "保存导出文件",
          defaultPath: path.join(app.getPath("downloads"), filename),
          filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
        });
        if (result.canceled || !result.filePath) return null;
        const destination = result.filePath;
        const temporary = path.join(
          path.dirname(destination),
          `.fpl-export-${randomUUID()}.tmp`,
        );
        try {
          await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
          await rename(temporary, destination);
        } finally {
          await rm(temporary, { force: true });
        }
        const receipt = { id: randomUUID(), path: destination };
        if (!event.sender.isDestroyed()) {
          if (!saved.has(owner))
            event.sender.once("destroyed", () => saved.delete(owner));
          saved.set(owner, receipt);
        }
        return receipt;
      } finally {
        pending.delete(owner);
      }
    },
  );
  ipcMain.handle("desktop:export-reveal", (event, receiptId: unknown) => {
    if (!trusted(event)) throw new Error("拒绝非应用页面请求");
    const receipt = saved.get(event.sender.id);
    if (!receipt || receipt.id !== receiptId)
      throw new Error("导出文件记录已失效，请通过保存路径查找文件");
    shell.showItemInFolder(receipt.path);
  });
}
