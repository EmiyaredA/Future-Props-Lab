// Isolated Electron + API smoke. Never opens the normal desktop data directory.
const { execFileSync, spawn } = require("node:child_process");
const { existsSync, mkdtempSync, mkdirSync, rmSync } = require("node:fs");
const { createServer } = require("node:net");
const { once } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium, expect } = require("@playwright/test");

const root = path.resolve(__dirname, "../..");
const whaleArchive = process.argv[2] || null;
if (whaleArchive)
  assert.ok(path.isAbsolute(whaleArchive) && existsSync(whaleArchive));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result;
    } catch {
      /* App is still starting. */
    }
    await pause(300);
  }
  throw new Error("desktop pet smoke timed out");
}

async function main() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "fpl-pet-smoke-"));
  const listener = createServer().listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const child = spawn(
    path.join(root, ".venv/bin/python"),
    [
      "desktop/scripts/dev.py",
      "--test-data-dir",
      directory,
      "--test-port",
      String(port),
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  let browser;
  try {
    browser = await until(() =>
      chromium.connectOverCDP(`http://127.0.0.1:${port}`),
    );
    const context = browser.contexts()[0];
    const studio = await until(() =>
      context.pages().find((page) => page.url().startsWith("http:")),
    );
    await studio.getByLabel("账号", { exact: true }).fill("pet-smoke");
    await studio.getByLabel("显示名称", { exact: true }).fill("桌宠隔离验收");
    await studio
      .getByLabel("密码", { exact: true })
      .fill("Pet-local-smoke-53927!");
    await studio
      .getByLabel("确认密码", { exact: true })
      .fill("Pet-local-smoke-53927!");
    await studio.getByRole("button", { name: "创建管理员并进入" }).click();
    await studio.waitForURL("**/home");

    if (!whaleArchive) {
      await studio.goto(new URL("/apps/live2d-workshop", studio.url()).href);
      await studio
        .getByRole("button", { name: "新建角色", exact: true })
        .click();
      await studio.getByLabel("项目名称").fill("桌宠角色");
      await studio
        .getByRole("dialog")
        .getByRole("button", { name: "创建项目", exact: true })
        .click();
      const characterEditor = await until(() =>
        context
          .pages()
          .find((page) => page.url().includes("/live2d-workshop/projects/")),
      );
      await characterEditor
        .locator('input[type="file"]')
        .first()
        .setInputFiles(
          path.join(root, "web/public/brand/live2d-workshop-mark.png"),
        );
      await expect(characterEditor.locator(".l2-tree-name")).toHaveCount(1);
      await characterEditor
        .getByRole("button", { name: "保存", exact: true })
        .click();
      await expect(characterEditor.locator(".l2-title")).toContainText(
        "已保存",
      );

      await studio.goto(new URL("/apps/desktop-pet", studio.url()).href);
      await studio.getByRole("button", { name: "新建桌宠" }).click();
      await studio.getByRole("button", { name: /桌宠角色.*版本/ }).click();
      await studio
        .getByRole("button", { name: "创建桌宠", exact: true })
        .click();
    } else {
      await studio.goto(new URL("/apps/desktop-pet", studio.url()).href);
      await studio.getByLabel("鲸鱼娘资源包").setInputFiles(whaleArchive);
      await studio.locator(".dp-editor").waitFor();
      await expect(studio.locator(".dp-side-item")).toHaveCount(8);
      await studio.locator(".dp-whale-renderer canvas").waitFor();
      for (let index = 0; index < 8; index++) {
        await studio.locator(".dp-side-item").nth(index).click();
        await expect(
          studio.locator(".dp-side-item").nth(index),
        ).toHaveAttribute("aria-pressed", "true");
      }
      await studio.locator(".dp-side-item").nth(1).click();
      await studio.getByRole("button", { name: "设为桌宠默认配色" }).click();
      await studio.getByRole("button", { name: "保存", exact: true }).click();
      await studio.reload();
      await expect(
        studio.getByText("当前默认：DeepSeek Harness"),
      ).toBeVisible();
    }
    await studio.locator(".dp-editor").waitFor();
    await studio.locator(".dp-pet-renderer canvas").waitFor();
    await studio.getByRole("button", { name: "交互", exact: true }).click();
    await studio.getByRole("button", { name: "点击身体" }).click();
    await studio.getByLabel("气泡文案").fill("你好");
    await studio.getByRole("button", { name: "保存", exact: true }).click();
    await studio.getByRole("button", { name: "放到桌面" }).first().click();
    const pet = await until(() =>
      context.pages().find((page) => page.url().includes("/pet.html?id=")),
    );
    await pet.locator(".pet-runtime canvas").waitFor();
    await pet.evaluate(() => window.futurePropsDesktop.setPetInteractive(true));
    await pet.mouse.click(150, 300);
    await expect(pet.locator(".pet-runtime-bubble")).toHaveText("你好");
    await pet.evaluate(() =>
      window.futurePropsDesktop.setPetInteractive(false),
    );
    const screenshotDir = path.join(
      root,
      whaleArchive
        ? ".local/desktop-pet/whale/smoke"
        : ".local/desktop-pet/smoke",
    );
    mkdirSync(screenshotDir, { recursive: true });
    await pet.screenshot({ path: path.join(screenshotDir, "pet-window.png") });
    const first = await studio.evaluate(() =>
      window.futurePropsDesktop.petStatus(),
    );
    assert.ok(first.projectId && first.visible);
    await studio.evaluate(
      (id) => window.futurePropsDesktop.openPet(id),
      first.projectId,
    );
    assert.equal(
      context.pages().filter((page) => page.url().includes("/pet.html?id="))
        .length,
      1,
    );
    await pet.evaluate(() => window.futurePropsDesktop.hidePet());
    await until(
      async () =>
        !(await studio.evaluate(() => window.futurePropsDesktop.petStatus()))
          .visible,
    );
    await studio.evaluate(
      (id) => window.futurePropsDesktop.openPet(id),
      first.projectId,
    );
    await until(
      async () =>
        (await studio.evaluate(() => window.futurePropsDesktop.petStatus()))
          .visible,
    );
    await studio.evaluate(() =>
      window.futurePropsDesktop.publishPetContext(null),
    );
    await until(
      async () =>
        !(await studio.evaluate(() => window.futurePropsDesktop.petStatus()))
          .projectId,
    );

    await studio.screenshot({
      path: path.join(screenshotDir, "editor-interaction-light.png"),
    });
    await studio.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    await studio.getByRole("button", { name: "形象", exact: true }).click();
    await expect(studio.locator(".dp-pet-renderer canvas")).toBeVisible();
    await pause(350);
    await studio.screenshot({
      path: path.join(screenshotDir, "editor-look-dark.png"),
    });
    await studio.getByRole("button", { name: "习惯", exact: true }).click();
    await expect(studio.locator(".dp-pet-renderer canvas")).toBeVisible();
    await pause(350);
    await studio.screenshot({
      path: path.join(screenshotDir, "editor-habits-dark.png"),
    });
    await studio.getByRole("button", { name: "试玩", exact: true }).click();
    await expect(studio.locator(".dp-pet-renderer canvas")).toBeVisible();
    await pause(350);
    await studio.screenshot({
      path: path.join(screenshotDir, "editor-preview-dark.png"),
    });
    await studio.setViewportSize({ width: 700, height: 820 });
    await studio.getByRole("button", { name: "习惯", exact: true }).click();
    await expect(studio.locator(".dp-pet-renderer canvas")).toBeVisible();
    await pause(350);
    assert.equal(
      await studio
        .locator(".dp-editor")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
      true,
    );
    await studio.screenshot({
      path: path.join(screenshotDir, "editor-narrow-dark.png"),
    });
    console.log(
      whaleArchive
        ? "PASS isolated whale import, eight schemes, saved preview, live window and identity cleanup"
        : "PASS isolated pet creation, Pixi preview, launch, singleton, hide, restore and identity cleanup",
    );
  } catch (error) {
    console.error(output.slice(-7000));
    throw error;
  } finally {
    await Promise.race([browser?.close().catch(() => {}), pause(2000)]);
    const stopGroup = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        /* Already stopped. */
      }
    };
    stopGroup("SIGTERM");
    await until(
      () => child.exitCode !== null || child.signalCode !== null,
      15000,
    ).catch(() => stopGroup("SIGKILL"));
    // macOS Electron may leave its app process outside the supervisor group.
    // Match only the unique disposable data directory used by this smoke.
    const processRows = execFileSync("ps", ["-eo", "pid=,ppid=,command="], {
      encoding: "utf8",
    }).split("\n");
    const related = processRows
      .filter((row) => row.includes(directory))
      .map((row) => row.trim().match(/^(\d+)\s+(\d+)\s+/))
      .filter(Boolean);
    for (const match of related) {
      for (const pid of [Number(match[1]), Number(match[2])]) {
        if (pid === process.pid || pid === child.pid) continue;
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already stopped */
        }
      }
    }
    child.stdout.destroy();
    child.stderr.destroy();
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
