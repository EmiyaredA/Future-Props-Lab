// Isolated Electron smoke; only the generated, small fixture directory is scanned.
const { _electron: electron, expect } = require("@playwright/test");
const { mkdir, mkdtemp, writeFile } = require("node:fs/promises");
const path = require("node:path");

async function main() {
  const root = path.resolve(__dirname, "../..");
  const evidence = path.join(root, ".local/storage-usage");
  await mkdir(evidence, { recursive: true });
  const data = await mkdtemp(path.join(evidence, "desktop-smoke-"));
  const fixture = path.join(data, "空间验收目录");
  await mkdir(fixture);
  await writeFile(
    path.join(fixture, "large-sample.txt"),
    Buffer.alloc(64 * 1024, 65),
  );
  await writeFile(
    path.join(fixture, "small-sample.txt"),
    Buffer.alloc(8 * 1024, 66),
  );
  const env = {
    ...process.env,
    FPL_DESKTOP_TEST_MODE: "1",
    FPL_DESKTOP_TEST_DATA_DIR: data,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.FPL_DEV_SESSION;
  delete env.FPL_DEV_LIVE;
  const application = await electron.launch({
    args: [path.join(root, "desktop/dist/main.js")],
    cwd: root,
    env,
    timeout: 60_000,
  });
  try {
    const page = await application.firstWindow();
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60_000 });
    await page.getByLabel("账号", { exact: true }).fill("storage-smoke");
    await page.getByLabel("显示名称", { exact: true }).fill("空间工具隔离验收");
    await page.getByLabel("密码", { exact: true }).fill("Storage-smoke-2026!");
    await page
      .getByLabel("确认密码", { exact: true })
      .fill("Storage-smoke-2026!");
    await page.getByRole("button", { name: "创建管理员并进入" }).click();
    await page.waitForURL("**/home");
    await application.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [directory],
      });
    }, fixture);
    const origin = new URL(page.url()).origin;
    await page.goto(origin + "/tools");
    await page.getByRole("button", { name: "打开空间占用" }).click();
    await page.getByRole("button", { name: "选择其他目录" }).click();
    await expect(page.locator(".storage-path")).toHaveText(fixture);
    await expect(page.getByText("已安装 · 3.8.1")).toBeVisible();
    await page.screenshot({
      path: path.join(evidence, "native-tool-page.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: /可视化分析/ }).click();
    await expect(
      page.getByText(/已发送 GrandPerspective 打开请求/),
    ).toBeVisible();
    await page.getByRole("button", { name: "在 Finder 中打开" }).click();
    await expect(page.getByText(/已发送 Finder 打开请求/)).toBeVisible();
    await writeFile(
      path.join(evidence, "native-smoke.json"),
      JSON.stringify(
        {
          dataDirectory: data,
          fixture,
          checks: [
            "isolated admin",
            "tool navigation",
            "trusted directory picker",
            "GrandPerspective launch",
            "Finder launch",
          ],
        },
        null,
        2,
      ) + "\n",
    );
    console.log("PASS isolated storage-usage native handoff");
    console.log("Fixture:", fixture);
  } finally {
    await application.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
