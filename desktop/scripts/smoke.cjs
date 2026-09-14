// Real packaged-Electron smoke. All account and project writes go through /v1.
const { _electron: electron, expect } = require("@playwright/test");
const { mkdtemp, mkdir, writeFile, readFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
const executablePath =
  process.env.FPL_TEST_APP_EXECUTABLE ||
  path.join(
    root,
    "desktop/out/Future Props Lab-darwin-arm64/Future Props Lab.app/Contents/MacOS/Future Props Lab",
  );
const evidence =
  process.env.FPL_TEST_EVIDENCE_DIR ||
  path.join(root, "desktop/out/validation");

async function main() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fpl-desktop-smoke-"));
  await mkdir(evidence, { recursive: true });
  const env = {
    ...process.env,
    PATH: "/usr/bin:/bin",
    FPL_DESKTOP_TEST_MODE: "1",
    FPL_DESKTOP_TEST_DATA_DIR: directory,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let application;
  let origin;
  const report = { dataDirectory: directory, executablePath, checks: [] };
  const passed = (name) => {
    report.checks.push(name);
    console.log("PASS", name);
  };
  async function launch() {
    application = await electron.launch({
      executablePath,
      env,
      cwd: os.tmpdir(),
      timeout: 90_000,
    });
    const page = await application.firstWindow();
    page.on("pageerror", (error) => console.error("PAGE ERROR", error.message));
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 90_000 });
    origin = new URL(page.url()).origin;
    return page;
  }
  async function quit() {
    const closed = application.waitForEvent("close", { timeout: 30_000 });
    await application.evaluate(({ app }) => app.quit());
    await closed;
    application = undefined;
  }
  try {
    let page = await launch();
    await expect(
      page.getByRole("heading", { name: "欢迎来到本地研究所" }),
    ).toBeVisible();
    for (const width of [760, 1280]) {
      await application.evaluate(
        ({ BrowserWindow }, width) =>
          BrowserWindow.getAllWindows()[0].setSize(width, 800),
        width,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
    }
    await page.screenshot({ path: path.join(evidence, "first-run.png") });
    await page
      .locator(".auth-card")
      .screenshot({ path: path.join(evidence, "setup-light.png") });
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "dark"),
    );
    await page
      .locator(".auth-card")
      .screenshot({ path: path.join(evidence, "setup-dark.png") });
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "light"),
    );
    passed("first-run form and desktop responsive sizes");
    assert.equal((await fetch(`${origin}/ready`)).status, 403);
    assert.equal(await page.evaluate(() => typeof window.require), "undefined");
    passed("private credential and sandbox boundary");
    await page.getByLabel("账号", { exact: true }).fill("smoke-admin");
    await page.getByLabel("显示名称", { exact: true }).fill("桌面验收");
    const passwordInput = page.getByLabel("密码", { exact: true });
    const confirmationInput = page.getByLabel("确认密码", { exact: true });
    await passwordInput.fill("Smoke-test-19420!");
    await confirmationInput.fill("Smoke-test-19420!");
    await expect(passwordInput).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "显示密码" }).click();
    await expect(passwordInput).toHaveAttribute("type", "text");
    await expect(confirmationInput).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "隐藏密码" }).click();
    await expect(passwordInput).toHaveAttribute("type", "password");
    passed("independent password visibility control");
    await page.getByRole("button", { name: "创建管理员并进入" }).click();
    await expect(
      page.getByRole("heading", { name: "欢迎来到本地研究所" }),
    ).not.toBeVisible({ timeout: 30_000 });
    const result = await page.evaluate(async () => {
      const me = await fetch("/v1/auth/me").then((response) => response.json());
      const csrf = document.cookie
        .split("; ")
        .find((part) => part.startsWith("fpl_csrf="))
        ?.split("=")[1];
      const response = await fetch("/v1/visual-workshop/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": decodeURIComponent(csrf),
        },
        body: JSON.stringify({ title: "桌面安装验收", kind: "image" }),
      });
      return {
        username: me.user.username,
        status: response.status,
        project: await response.json(),
      };
    });
    assert.equal(result.username, "smoke-admin");
    assert.equal(result.status, 200);
    passed("first admin, existing login and project API");
    const second = spawn(executablePath, [], {
      env,
      cwd: os.tmpdir(),
      stdio: "ignore",
    });
    assert.equal(
      await new Promise((resolve) => second.once("exit", resolve)),
      0,
    );
    assert.equal(new URL(page.url()).origin, origin);
    passed("second app launch retains one service");
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    assert.equal(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
      false,
    );
    await application.evaluate(({ app }) => app.emit("activate"));
    assert.equal(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
      true,
    );
    passed("window close hides and Dock activation restores");
    const docsPromise = application.waitForEvent("window");
    await page.evaluate(() =>
      window.open("/docs.html?page=overview", "_blank"),
    );
    const docs = await docsPromise;
    await docs.waitForLoadState("domcontentloaded");
    assert.equal(new URL(docs.url()).origin, origin);
    await docs.close();
    passed("controlled same-origin documentation window");
    const vad = await page.evaluate(async () =>
      (await fetch("/voice-vad/silero_vad_v5.onnx"))
        .arrayBuffer()
        .then((data) => data.byteLength),
    );
    assert.ok(vad > 100_000);
    await page.goto(`${origin}/apps/visual-workshop`);
    await expect(page.getByText("桌面安装验收", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await page.screenshot({ path: path.join(evidence, "workspace.png") });
    passed("VAD model resource and deep-page refresh");
    await page.evaluate(() => {
      window.desktopTestGuard = (event) => event.preventDefault();
      window.addEventListener(
        "future-props:before-workspace-switch",
        window.desktopTestGuard,
      );
    });
    await application.evaluate(({ app }) => app.quit());
    await expect
      .poll(() =>
        page.evaluate(() =>
          fetch("/ready").then((response) => response.status),
        ),
      )
      .toBe(200);
    await page.evaluate(() =>
      window.removeEventListener(
        "future-props:before-workspace-switch",
        window.desktopTestGuard,
      ),
    );
    passed("unsaved navigation guard cancels quit");
    await quit();
    if (process.env.FPL_TEST_REPLACE_APP_FROM) {
      execFileSync("/usr/bin/ditto", [
        process.env.FPL_TEST_REPLACE_APP_FROM,
        path.resolve(path.dirname(executablePath), "../.."),
      ]);
    }
    page = await launch();
    await expect
      .poll(() =>
        page.evaluate(() =>
          fetch("/v1/auth/me").then((response) => response.status),
        ),
      )
      .toBe(200);
    const status = await page.evaluate(
      async (id) => (await fetch(`/v1/visual-workshop/projects/${id}`)).status,
      result.project.id,
    );
    assert.equal(status, 200);
    passed("relaunch restores session and saved project");
    if (process.env.FPL_TEST_REPLACE_APP_FROM)
      passed(
        "replacing the installed App preserves independent account and project data",
      );
    const output = execFileSync(
      "/usr/bin/pgrep",
      ["-P", String(application.process().pid), "-f", "fpl-server/fpl-server"],
      { encoding: "utf8" },
    ).trim();
    const ids = output.split(/\s+/).map(Number);
    if (ids.length !== 1 || !Number.isInteger(ids[0]))
      throw new Error("Expected one owned backend process");
    const backendPid = ids[0];
    process.kill(backendPid, "SIGKILL");
    await expect(page.getByRole("button", { name: "重新启动" })).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({ path: path.join(evidence, "recovery.png") });
    await page.getByRole("button", { name: "重新启动" }).click();
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 90_000 });
    passed("backend crash shows manual recovery and retry succeeds");
    origin = new URL(page.url()).origin;
    const closed = application.waitForEvent("close", { timeout: 15_000 });
    application.process().kill("SIGKILL");
    await closed;
    application = undefined;
    await expect
      .poll(
        async () => {
          try {
            await fetch(`${origin}/ready`, {
              signal: AbortSignal.timeout(1000),
            });
            return false;
          } catch {
            return true;
          }
        },
        { timeout: 25_000 },
      )
      .toBe(true);
    passed("main process crash closes parent pipe and backend exits");
    page = await launch();
    await expect
      .poll(() =>
        page.evaluate(() =>
          fetch("/v1/auth/me").then((response) => response.status),
        ),
      )
      .toBe(200);
    await quit();
    await writeFile(
      path.join(evidence, "electron-smoke.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  } catch (error) {
    if (application) {
      const page = await application.firstWindow().catch(() => null);
      await page
        ?.screenshot({ path: path.join(evidence, "failure.png") })
        .catch(() => undefined);
      await application.close().catch(() => undefined);
    }
    console.error(
      await readFile(path.join(directory, "logs/backend.log"), "utf8").catch(
        () => "No backend log",
      ),
    );
    throw error;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
