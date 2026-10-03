// Isolated Electron + API smoke. Never opens the normal desktop data directory.
const { execFileSync, spawn } = require("node:child_process");
const {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
} = require("node:fs");
const { unzipSync, strFromU8 } = require("fflate");
const { createServer } = require("node:net");
const { once } = require("node:events");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium, expect } = require("@playwright/test");
const {
  inspectHumanPet,
  inspectHumanWalk,
} = require("./inspect-human-pet.cjs");
const { inspectCompanionChat } = require("./inspect-companion-chat.cjs");
const { inspectPetPreview } = require("./inspect-pet-preview.cjs");
const {
  inspectPetMotion,
  inspectMotionPoses,
} = require("./inspect-pet-motion.cjs");

const root = path.resolve(__dirname, "../..");
const whaleArchive = process.argv[2] || null;
const replacementArchive = process.argv[3] || null;
if (replacementArchive)
  assert.ok(
    whaleArchive &&
      path.isAbsolute(replacementArchive) &&
      existsSync(replacementArchive),
  );
if (whaleArchive)
  assert.ok(path.isAbsolute(whaleArchive) && existsSync(whaleArchive));
let importedModel = whaleArchive
  ? JSON.parse(strFromU8(unzipSync(readFileSync(whaleArchive))["model.json"]))
  : null;
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
  const dataParent = path.join(root, ".local/desktop-pet/smoke-data");
  mkdirSync(dataParent, { recursive: true });
  const directory = mkdtempSync(path.join(dataParent, "fpl-pet-smoke-"));
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
      await studio.getByLabel("桌宠角色资源包").setInputFiles(whaleArchive);
      await studio.locator(".dp-editor").waitFor();
      await expect(studio.locator(".dp-side-item")).toHaveCount(
        importedModel.schemes.length,
      );
      await studio.locator(".dp-whale-renderer canvas").waitFor();
      if (replacementArchive) {
        const id = studio.url().split("/projects/")[1].split("/")[0];
        const before = await studio.evaluate(async (id) => {
          const base = `/v1/desktop-pet/projects/${id}`;
          return {
            project: await (await fetch(base)).json(),
            document: await (await fetch(`${base}/document`)).json(),
            chat: await (await fetch(`${base}/chat`)).json(),
          };
        }, id);
        importedModel = JSON.parse(
          strFromU8(unzipSync(readFileSync(replacementArchive))["model.json"]),
        );
        await studio
          .getByLabel("选择更新角色资源包")
          .setInputFiles(replacementArchive);
        await expect(studio.locator(".dp-side-item")).toHaveCount(
          importedModel.schemes.length,
        );
        const after = await studio.evaluate(async (id) => {
          const base = `/v1/desktop-pet/projects/${id}`;
          return {
            project: await (await fetch(base)).json(),
            document: await (await fetch(`${base}/document`)).json(),
            chat: await (await fetch(`${base}/chat`)).json(),
          };
        }, id);
        assert.equal(after.project.id, before.project.id);
        assert.equal(after.document.revision, before.document.revision + 1);
        assert.deepEqual(after.document.config, before.document.config);
        assert.deepEqual(after.chat, before.chat);
      }
      for (let index = 0; index < importedModel.schemes.length; index++) {
        await studio.locator(".dp-side-item").nth(index).click();
        await expect(
          studio.locator(".dp-side-item").nth(index),
        ).toHaveAttribute("aria-pressed", "true");
      }
      const selected = Math.min(1, importedModel.schemes.length - 1);
      await studio.locator(".dp-side-item").nth(selected).click();
      await studio.getByRole("button", { name: "设为桌宠默认配色" }).click();
      await studio.getByRole("button", { name: "保存", exact: true }).click();
      await studio.reload();
      await expect(
        studio.getByText(
          `当前默认：${importedModel.schemes[selected].brand} · ${importedModel.schemes[selected].label}`,
        ),
      ).toBeVisible();
    }
    await studio.locator(".dp-editor").waitFor();
    await studio.locator(".dp-pet-renderer canvas").waitFor();
    await studio.getByRole("button", { name: "交互", exact: true }).click();
    await studio.getByRole("button", { name: "点击身体" }).click();
    await studio.getByRole("button", { name: "台词", exact: true }).click();
    await studio.getByRole("button", { name: /添加台词/ }).click();
    await studio
      .getByRole("textbox", { name: "第 1 句台词", exact: true })
      .fill("你好");
    await studio.getByRole("button", { name: "保存", exact: true }).click();
    await studio.getByRole("button", { name: "放到桌面" }).first().click();
    const pet = await until(() =>
      context.pages().find((page) => page.url().includes("/pet.html?id=")),
    );
    await pet.locator(".pet-runtime canvas").waitFor();
    await pet.mouse.move(150, 300, { steps: 8 });
    await expect(pet.getByTitle("隐藏")).toBeVisible();
    await expect(pet.getByTitle("聊天")).toBeVisible();
    await pet.mouse.click(150, 300);
    await expect(pet.locator(".pet-runtime-bubble")).toHaveText("你好");
    await pet.mouse.move(5, 5, { steps: 8 });
    await expect(pet.getByTitle("隐藏")).toHaveCount(0);
    await pet.mouse.move(150, 300, { steps: 8 });
    await expect(pet.getByTitle("隐藏")).toBeVisible();
    const screenshotDir = path.join(
      root,
      process.env.FPL_SMOKE_PET_OUTPUT ||
        (whaleArchive
          ? importedModel.rigProfile === "human-chibi"
            ? importedModel.schemes.length > 1
              ? ".local/desktop-pet/kurisu/wardrobe/smoke"
              : ".local/desktop-pet/kurisu/smoke"
            : ".local/desktop-pet/whale/smoke"
          : ".local/desktop-pet/smoke"),
    );
    mkdirSync(screenshotDir, { recursive: true });
    await pet.screenshot({ path: path.join(screenshotDir, "pet-window.png") });
    const chatButton = await pet.getByTitle("聊天").boundingBox();
    assert.ok(chatButton);
    await pet.mouse.move(
      chatButton.x + chatButton.width / 2,
      chatButton.y + chatButton.height / 2,
      { steps: 16 },
    );
    await pet.mouse.click(
      chatButton.x + chatButton.width / 2,
      chatButton.y + chatButton.height / 2,
    );
    const chatPage = await until(() =>
      context.pages().find((page) => page.url().includes("/pet-chat.html?id=")),
    );
    await chatPage.getByRole("button", { name: "聊天设置" }).click();
    await expect(
      chatPage.getByText("当前 Workspace 没有可用的文字模型"),
    ).toBeVisible();
    await chatPage.screenshot({
      path: path.join(screenshotDir, "chat-window.png"),
    });
    if (!chatPage.isClosed())
      await chatPage.keyboard.press("Escape").catch((error) => {
        if (!chatPage.isClosed()) throw error;
      });
    await until(
      () =>
        !context
          .pages()
          .some((page) => page.url().includes("/pet-chat.html?id=")),
    );
    if (whaleArchive)
      await inspectPetPreview(
        studio,
        pet,
        context,
        new URL(pet.url()).searchParams.get("id"),
        screenshotDir,
        importedModel.rigProfile === "human-chibi",
      );
    const first = await studio.evaluate(() =>
      window.futurePropsDesktop.petStatus(),
    );
    assert.ok(first.projectId && first.visible);
    if (whaleArchive && process.env.FPL_SMOKE_PET_MOTION === "1") {
      await inspectPetMotion(
        studio,
        pet,
        context,
        first.projectId,
        screenshotDir,
      );
      for (const scheme of importedModel.schemes)
        await inspectMotionPoses(
          studio,
          first.projectId,
          screenshotDir,
          scheme.id,
        );
    }
    await studio.evaluate(async () => {
      const csrf = document.cookie
        .split("; ")
        .find((entry) => entry.startsWith("fpl_csrf="))
        ?.slice("fpl_csrf=".length);
      const call = async (path, method = "GET", body) => {
        const response = await fetch(path, {
          method,
          credentials: "include",
          headers: {
            ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}),
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!response.ok)
          throw new Error(
            `${path}: ${response.status} ${await response.text()}`,
          );
        return response.json();
      };
      const services = await call("/v1/platform/demo-services");
      const mock = services.find((item) => item.id === "mock_model");
      await call("/v1/platform/demo-services/mock_model", "PUT", {
        expected_revision: mock.revision,
        value: { enabled: true, response_text: "小鱼收到你的消息啦。" },
      });
      const catalog = await call("/v1/model-providers");
      await call("/v1/account/demo-services/mock_model/install", "POST", {
        expected_catalog_revision: catalog.revision,
      });
    });
    await pet.evaluate(() => window.futurePropsDesktop.openPetChat());
    const activeChat = await until(() =>
      context.pages().find((page) => page.url().includes("/pet-chat.html?id=")),
    );
    await activeChat.getByRole("button", { name: "聊天设置" }).click();
    await activeChat.locator(".dp-chat-models button").first().click();
    await activeChat.getByRole("button", { name: "完成设置" }).click();
    await activeChat
      .getByRole("textbox", { name: "输入消息" })
      .fill("你好，小鱼");
    await activeChat.keyboard.press("Enter");
    await expect(activeChat.getByText("小鱼收到你的消息啦。")).toBeVisible();
    await expect(pet.locator(".pet-runtime-bubble")).toHaveCount(0);
    await inspectCompanionChat(
      activeChat,
      pet,
      studio,
      first.projectId,
      screenshotDir,
    );
    await activeChat.screenshot({
      path: path.join(screenshotDir, "chat-reply.png"),
    });
    await activeChat.keyboard.press("Escape").catch((error) => {
      if (!activeChat.isClosed()) throw error;
    });
    await until(
      () =>
        !context
          .pages()
          .some((page) => page.url().includes("/pet-chat.html?id=")),
    );
    await pet.evaluate(() => window.futurePropsDesktop.openPetChat());
    const reopenedChat = await until(() =>
      context.pages().find((page) => page.url().includes("/pet-chat.html?id=")),
    );
    await expect(
      reopenedChat.getByRole("button", { name: "完整对话" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(reopenedChat.getByText("小鱼收到你的消息啦。")).toBeVisible();
    await reopenedChat.keyboard.press("Escape").catch((error) => {
      if (!reopenedChat.isClosed()) throw error;
    });
    await until(
      () =>
        !context
          .pages()
          .some((page) => page.url().includes("/pet-chat.html?id=")),
    );
    const hideButton = await pet.getByTitle("隐藏").boundingBox();
    assert.ok(hideButton);
    await pet.mouse.move(
      hideButton.x + hideButton.width / 2,
      hideButton.y + hideButton.height / 2,
      { steps: 16 },
    );
    await expect(pet.getByTitle("隐藏")).toBeVisible();
    await pet.mouse.click(
      hideButton.x + hideButton.width / 2,
      hideButton.y + hideButton.height / 2,
    );
    await until(
      async () =>
        !(await studio.evaluate(() => window.futurePropsDesktop.petStatus()))
          .visible,
    );
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

    if (importedModel?.rigProfile === "human-chibi") {
      for (const scheme of importedModel.schemes) {
        const outfitDir = path.join(screenshotDir, scheme.id);
        mkdirSync(outfitDir, { recursive: true });
        await inspectHumanPet(studio, first.projectId, outfitDir, scheme.id);
        await inspectHumanWalk(studio, first.projectId, outfitDir, scheme.id);
      }
    }

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
    if (importedModel?.rigProfile === "human-chibi")
      await inspectHumanWalk(studio, first.projectId, screenshotDir);
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
    await studio.getByRole("button", { name: "预览", exact: true }).click();
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
    const existingPages = new Set(context.pages());
    await studio.evaluate(() => window.futurePropsDesktop.openNewWindow());
    const extra = await until(() =>
      context
        .pages()
        .find(
          (page) => !existingPages.has(page) && page.url().startsWith("http:"),
        ),
    );
    await extra.waitForLoadState("domcontentloaded");
    await extra.evaluate(() => {
      // Let the evaluation return before the normal IPC destroys its context.
      setTimeout(() => void window.futurePropsDesktop.close(), 0);
    });
    await until(() => extra.isClosed());
    assert.equal(studio.isClosed(), false);
    assert.equal(output.includes("Object has been destroyed"), false);
    console.log(
      whaleArchive
        ? `PASS isolated ${importedModel.rigProfile || "whale"} import, ${importedModel.schemes.length} schemes, lines, chat stream, history and identity cleanup`
        : "PASS isolated pet creation, lines, chat stream, history, launch, hide, restore and identity cleanup",
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
