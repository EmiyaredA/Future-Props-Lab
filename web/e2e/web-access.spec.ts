import { test, expect } from "@playwright/test";

for (const width of [390, 820, 1440])
  for (const theme of ["light", "dark"] as const) {
    test(`访问面板 ${width}px ${theme} 的状态、焦点和局部滚动`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        ({ theme }) => {
          localStorage.setItem("future_props_theme", theme);
          Object.defineProperty(window, "futurePropsDesktop", {
            value: {
              version: 1,
              onQuitRequested: () => () => {},
              agentStatus: async () => ({ enabled: false, connected: false }),
            },
          });
        },
        { theme },
      );
      await page.route("**/v1/desktop/setup", (route) =>
        route.fulfill({ json: { setup_required: false } }),
      );
      const endpoint = {
        phase: "off",
        url: "http://127.0.0.1:28081",
        error: "",
        last_checked_at: "",
      };
      await page.route("**/v1/desktop/web-access", (route) =>
        route.fulfill({
          json: {
            local: endpoint,
            public: { ...endpoint, url: "https://studio.example.test" },
            build_id: "test",
            bytes_received: 1024,
            bytes_sent: 4096,
            requests: 3,
          },
        }),
      );
      await page.route("**/v1/desktop/web-access/config", (route) =>
        route.fulfill({
          json: {
            revision: "a".repeat(64),
            profile: {
              origin: "https://studio.example.test",
              host: "gateway.example.test",
              ssh_port: 22,
              user: "fpl-gateway",
              local_port: 28081,
              remote_port: 28080,
              identity_id: "",
              known_hosts_id: "",
            },
            identity_fingerprint: "",
            known_hosts_fingerprint: "",
            legacy_available: false,
          },
        }),
      );
      await page.goto("/");
      await page.getByRole("button", { name: "账号菜单", exact: true }).click();
      await page.getByRole("menuitem", { name: "本地与公网访问" }).click();
      const dialog = page.getByRole("dialog", { name: "本地与公网访问" });
      await expect(dialog.getByText("已关闭", { exact: true })).toHaveCount(2);
      await expect(dialog).toBeVisible();
      await dialog.getByText("网关与连接凭据", { exact: true }).click();
      await expect(dialog.getByLabel("SSH 主机", { exact: true })).toHaveValue(
        "gateway.example.test",
      );
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBeTruthy();
      await page.screenshot({
        path: `${process.env.FPL_E2E_OUTPUT || "test-results"}/web-access-${width}-${theme}.png`,
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    });
  }

test("登录不加载编辑器、3D 或角色", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  const requested: string[] = [];
  page.on("request", (r) => requested.push(r.url()));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 100,
    downloadThroughput: 10_000_000 / 8,
    uploadThroughput: 10_000_000 / 8,
  });
  const started = Date.now();
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "用户名", exact: true }),
  ).toBeEditable({ timeout: 3000 });
  const duration = Date.now() - started;
  expect(
    requested.filter((url) =>
      /notes-tiptap|notes-prosemirror|formula-engine|three-core|three-renderer|director-automation|DesktopPetFigure/.test(
        url,
      ),
    ),
  ).toEqual([]);
  console.log(
    JSON.stringify({
      loginInteractiveMs: duration,
      condition: "10 Mbps / 100ms RTT",
      targetMs: 3000,
    }),
  );
  await context.close();
});

test("普通项目列表不下载编辑器、3D、角色或完整媒体", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  await page.goto("/apps/visual-workshop");
  await expect(
    page.getByRole("heading", { name: "我的创作项目", exact: true }),
  ).toBeVisible();
  expect(
    requested.filter((url) =>
      /notes-tiptap|notes-prosemirror|formula-engine|three-(core|renderer)|director-(resources|automation)|DesktopPetFigure|\/v1\/files\/[^/]+\/content/.test(
        url,
      ),
    ),
  ).toEqual([]);
});

test("启动资源失败显示恢复入口，不自动刷新或提交写请求", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  let navigations = 0;
  const writes: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push(request.url());
  });
  await page.route("**/assets/main-*.js", (route) =>
    route.abort("connectionfailed"),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "页面资源加载失败", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  expect(navigations).toBe(1);
  expect(writes).toEqual([]);
  await context.close();
});
