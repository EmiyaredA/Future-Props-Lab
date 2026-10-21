import {
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
} from "electron";

export function installStorageDirectoryPicker(
  trusted: (event: IpcMainInvokeEvent) => boolean,
): void {
  const pending = new Set<number>();
  ipcMain.handle("desktop:storage-pick-directory", async (event) => {
    if (!trusted(event) || process.platform !== "darwin")
      throw new Error("拒绝非 macOS 应用页面请求");
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || pending.has(event.sender.id))
      throw new Error("目录选择窗口不可用或已打开");
    pending.add(event.sender.id);
    try {
      const result = await dialog.showOpenDialog(window, {
        title: "选择要分析空间占用的目录",
        buttonLabel: "选择目录",
        properties: ["openDirectory", "showHiddenFiles"],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    } finally {
      pending.delete(event.sender.id);
    }
  });
}
