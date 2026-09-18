import { expect, test, type BrowserContext, type Page } from "@playwright/test";

async function write(
  context: BrowserContext,
  path: string,
  data: unknown,
  method = "POST",
) {
  const csrf =
    (await context.cookies()).find((cookie) => cookie.name === "fpl_csrf")
      ?.value || "";
  const response = await context.request.fetch(path, {
    method,
    data,
    headers: {
      Origin: new URL(
        context.pages()[0]?.url() ||
          `http://127.0.0.1:${process.env.FPL_E2E_WEB_PORT || "3000"}`,
      ).origin,
      "X-CSRF-Token": csrf,
    },
  });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.status() === 204 ? null : response.json();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();
}

test("管理中台创建账号、一次性密码、创建空间与审计", async ({ page }) => {
  await page.goto("/management/accounts");
  await expect(
    page.getByRole("heading", { name: "账号管理", exact: true }),
  ).toBeVisible();
  const username = `managed-${Date.now()}`;
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "创建账号", exact: true });
  await dialog.getByLabel("用户名", { exact: true }).fill(username);
  await dialog.getByLabel("展示名", { exact: true }).fill("治理浏览器测试");
  await dialog
    .getByLabel("邮箱", { exact: true })
    .fill(`${username}@example.invalid`);
  await dialog.getByRole("button", { name: "创建账号", exact: true }).click();
  const secret = page.getByRole("dialog", { name: "临时密码只显示一次" });
  await expect(secret).toBeVisible();
  const password = await secret.locator("code").innerText();
  expect(password.length).toBeGreaterThan(12);
  await page.keyboard.press("Escape");
  await expect(secret).toBeHidden();
  await expect(page.getByText(password, { exact: true })).toHaveCount(0);
  await page.getByLabel("搜索账号").fill(username);
  await expect(
    page.getByRole("cell", { name: /治理浏览器测试/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "工作区管理", exact: true }).click();
  await page.getByRole("button", { name: "创建工作区", exact: true }).click();
  const workspace = page.getByRole("dialog", {
    name: "创建工作区",
    exact: true,
  });
  await workspace.getByLabel("工作区名称").fill(`治理空间-${username}`);
  await workspace.getByLabel("查找拥有者").fill(username);
  await workspace
    .getByRole("button", { name: `治理浏览器测试 · @${username}`, exact: true })
    .click();
  await workspace
    .getByRole("button", { name: "创建工作区", exact: true })
    .click();
  await expect(workspace).toBeHidden();
  await page.getByLabel("搜索工作区").fill(`治理空间-${username}`);
  await expect(
    page.getByRole("cell", { name: `治理空间-${username}`, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "安全审计", exact: true }).click();
  await page.getByLabel("目标账号", { exact: true }).fill(username);
  await expect(
    page.getByRole("cell", { name: /创建工作区\s*成功/ }),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: "/tmp/fpl-management-desktop.png",
    fullPage: true,
  });
});

test("内部只读角色浏览各工坊且不产生业务写入", async ({ page, browser }) => {
  test.setTimeout(60000);
  await page.goto("/management/accounts");
  const admin = page.context();
  const username = `viewer-${Date.now()}`;
  const created = await write(admin, "/v1/platform/accounts", {
    username,
    display_name: "只读浏览测试",
  });
  const me = await (await admin.request.get("/v1/auth/me")).json();
  const invitation = await write(
    admin,
    "/v1/account/workspaces/current/invitations",
    { username, role: "viewer" },
  );
  const baseURL = new URL(page.url()).origin;
  const viewer = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  const view = await viewer.newPage();
  await view.goto("/home");
  await view.getByLabel("用户名", { exact: true }).fill(username);
  await view
    .getByLabel("密码", { exact: true })
    .fill(created.temporary_password);
  await view.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    view.getByRole("heading", { name: "设置你的新密码" }),
  ).toBeVisible();
  await view.getByLabel("当前临时密码").fill(created.temporary_password);
  await view
    .getByLabel("新密码", { exact: true })
    .fill("Viewer-Browser-Password!2026");
  await view.getByLabel("确认新密码").fill("Viewer-Browser-Password!2026");
  await view.getByRole("button", { name: "保存并继续" }).click();
  await expect(
    view.getByRole("heading", { name: "设置你的新密码" }),
  ).toBeHidden();
  await write(
    viewer,
    `/v1/account/workspace-invitations/${invitation.id}/accept`,
    { expected_revision: invitation.revision },
  );
  await write(viewer, "/v1/account/workspaces/switch", {
    workspace_id: me.workspace.id,
  });
  const visual = await write(admin, "/v1/visual-workshop/projects", {
    title: "只读视觉作品",
    kind: "canvas",
  });
  const video = await write(admin, "/v1/video-editor/projects", {
    title: "只读剪辑作品",
  });
  const galgame = await write(admin, "/v1/galgame-workshop/projects", {
    title: "只读剧情作品",
  });
  const assetName = `readonly-${username}.png`;
  const upload = await admin.request.post("/v1/files", {
    headers: {
      Origin: baseURL,
      "X-CSRF-Token": (await admin.cookies()).find(
        (c) => c.name === "fpl_csrf",
      )!.value,
    },
    multipart: {
      upload: {
        name: assetName,
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH3cAAAAASUVORK5CYII=",
          "base64",
        ),
      },
    },
  });
  expect(upload.ok(), await upload.text()).toBeTruthy();
  const writes: string[] = [];
  view.on("request", (request) => {
    if (
      /[A-Z]/.test(request.method()) &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method()) &&
      request.url().includes("/v1/") &&
      !/\/v1\/(auth|account)\//.test(request.url())
    )
      writes.push(`${request.method()} ${request.url()}`);
  });
  for (const path of [
    "/files",
    "/model-test",
    "/apps/visual-workshop",
    "/apps/thought-workshop",
    "/apps/galgame-workshop",
    "/apps/video-editor",
    "/apps/audio-annotation",
  ]) {
    await view.goto(path);
    await expect(
      view.getByText("只读成员 · 可浏览、播放和下载已有内容", { exact: true }),
    ).toBeVisible();
    await expect(view.locator('[role="alert"]')).toHaveCount(0);
    await noOverflow(view);
  }
  // Follow actual links in the read-only collections rather than constructing editor routes.
  for (const [path, title] of [
    ["/apps/visual-workshop", "只读视觉作品"],
    ["/apps/video-editor", "只读剪辑作品"],
    ["/apps/galgame-workshop", "只读剧情作品"],
  ]) {
    await view.goto(path);
    await view.getByRole("button", { name: new RegExp(title) }).click();
    await expect(
      view.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(view.locator('[role="alert"]')).toHaveCount(0);
  }
  expect(visual.id && video.id && galgame.id).toBeTruthy();
  expect(writes).toEqual([]);
  await view.goto("/management/accounts");
  await expect(
    view.getByRole("heading", { name: "需要平台管理员权限" }),
  ).toBeVisible();
  await view.goto("/files");
  await view
    .getByRole("button", { name: new RegExp(assetName.replace(/\.png$/, "")) })
    .click();
  await expect(view.getByRole("img", { name: assetName })).toBeVisible();
  await expect(view.getByRole("link", { name: "下载素材" })).toHaveAttribute(
    "href",
    /^blob:/,
  );
  expect(writes).toEqual([]);
  await view.setViewportSize({ width: 390, height: 844 });
  await noOverflow(view);
  await view.screenshot({ path: "/tmp/fpl-viewer-mobile.png", fullPage: true });
  const memberList = await (
    await admin.request.get("/v1/account/workspaces/current/members")
  ).json();
  const membership = memberList.items.find(
    (m: { user_id: string }) => m.user_id === created.account.id,
  );
  const memberPath = `/v1/account/workspaces/current/members/${membership.membership_id}`;
  await write(
    admin,
    memberPath,
    { role: "member", expected_revision: membership.revision },
    "PATCH",
  );
  await view.goto("/files");
  await expect(
    view.getByText("只读成员 · 可浏览、播放和下载已有内容", { exact: true }),
  ).toHaveCount(0);
  await write(
    admin,
    memberPath,
    { role: "viewer", expected_revision: membership.revision + 1 },
    "PATCH",
  );
  writes.length = 0;
  await view.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    view.getByText("只读成员 · 可浏览、播放和下载已有内容", { exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([]);
  const otherTab = await viewer.newPage();
  await otherTab.goto("/files");
  const personal = await (
    await viewer.request.get("/v1/account/workspaces")
  ).json();
  const owned = personal.items.find(
    (w: { role: string }) => w.role === "owner",
  );
  await write(viewer, "/v1/account/workspaces/switch", {
    workspace_id: owned.id,
  });
  const reloaded = otherTab.waitForEvent("load");
  await view.evaluate(() => {
    const channel = new BroadcastChannel("future-props-workspace");
    channel.postMessage({});
    channel.close();
  });
  await reloaded;
  await expect(
    otherTab.getByText("只读成员 · 可浏览、播放和下载已有内容", {
      exact: true,
    }),
  ).toHaveCount(0);
  await viewer.close();
});

for (const theme of ["light", "dark"] as const) {
  test(`管理中台手机布局与键盘入口：${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(
      (value) => localStorage.setItem("future_props_theme", value),
      theme,
    );
    for (const path of [
      "/management/accounts",
      "/management/workspaces",
      "/management/audit",
    ]) {
      await page.goto(path);
      await page.getByRole("button", { name: "打开管理导航" }).click();
      await expect(
        page.getByRole("navigation", { name: "管理中台", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "打开管理导航" }),
      ).toBeFocused();
      await noOverflow(page);
      await page.keyboard.press("Tab");
      await expect(page.locator(":focus")).toBeVisible();
    }
    await page.screenshot({
      path: `/tmp/fpl-management-mobile-${theme}.png`,
      fullPage: true,
    });
  });
}
