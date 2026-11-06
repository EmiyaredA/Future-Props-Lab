import { expect, test } from "@playwright/test";

test("cloud control switches full-width views and shows the Happier workspace", async ({
  page,
}) => {
  await page.goto("/apps");
  await expect(
    page.getByRole("button", { name: "打开Agent 工作台", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "云控", exact: true }).click();
  await expect(page).toHaveURL(/\/cloud-control$/);
  const switcher = page.getByRole("group", { name: "云控视图" });
  const desktopTab = switcher.getByRole("button", {
    name: "远程桌面",
    exact: true,
  });
  const agentTab = switcher.getByRole("button", {
    name: "Agent 工作台",
    exact: true,
  });
  const desktop = page.getByRole("region", { name: "远程桌面", exact: true });
  const chat = page.getByRole("region", { name: "Agent 工作台", exact: true });
  await expect(desktopTab).toHaveAttribute("aria-pressed", "true");
  for (const width of [390, 768, 1280, 1616]) {
    await page.setViewportSize({ width, height: 973 });
    for (const theme of ["浅色", "深色"]) {
      await page.getByRole("button", { name: theme, exact: true }).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    }
    await desktopTab.press("Enter");
    await expect(desktop).toBeVisible();
    await expect(chat).toBeHidden();
    await agentTab.press("Space");
    await expect(agentTab).toBeFocused();
    await expect(chat).toBeVisible();
    await expect(desktop).toBeHidden();
    const workspace = await page.locator(".cloud-workspace").boundingBox();
    expect((await chat.boundingBox())!.width).toBeCloseTo(workspace!.width, 0);
  }
  await expect(
    page.getByRole("separator", { name: "调整远程桌面宽度" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(agentTab).toHaveAttribute("aria-pressed", "true");
  await page.goto("/agents/sessions/private-id");
  await expect(page).toHaveURL(/\/cloud-control\?view=agent$/);
  await expect(agentTab).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("此账号或入口尚未启用 Happier。")).toBeVisible();
});

test("ordinary accounts cannot mount cloud control or workbench requests", async ({
  page,
}) => {
  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const me = await response.json();
    me.user.platform_role = "user";
    me.user.is_platform_admin = false;
    me.permission_keys = me.permission_keys.filter(
      (key: string) => key !== "cloud-control.access",
    );
    await route.fulfill({ response, json: me });
  });
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/v1/agent-workbench/"))
      requests.push(request.url());
  });
  for (const path of [
    "/cloud-control",
    "/agents",
    "/agents/sources",
    "/agents/sessions/private",
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "云控仅限管理员访问" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "云控", exact: true }),
    ).toHaveCount(0);
  }
  expect(requests).toEqual([]);
});

test("retired host tools are absent even with old favorites and usage", async ({
  page,
}) => {
  await page.route("**/v1/tool-navigation/state", (route) =>
    route.fulfill({
      json: {
        items: ["storage-usage", "codex-model-source"].map((tool_id) => ({
          tool_id,
          is_favorite: true,
          last_used_at: "2026-11-03T00:00:00Z",
          favorite_updated_at: "2026-11-03T00:00:00Z",
          use_count: 4,
        })),
      },
    }),
  );
  for (const path of [
    "/tools",
    "/tools/storage-usage",
    "/tools/codex-model-source",
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "工具导航", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("空间占用", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Codex 模型源", { exact: true })).toHaveCount(
      0,
    );
  }
});

test("public desktop unlocks with a password and reconnects with VNC only", async ({
  page,
}) => {
  await page.clock.install();
  let authorized = false;
  let passwordChecks = 0;
  await page.route("**/v1/auth/reauth", (route) => {
    const { password } = route.request().postDataJSON();
    passwordChecks++;
    return password === "fixture-password"
      ? route.fulfill({ status: 204 })
      : route.fulfill({
          status: 401,
          json: { code: "invalid_credentials", detail: "密码不正确" },
        });
  });
  await page.route("**/v1/cloud-control/unlock", (route) => {
    expect(route.request().postDataJSON()).toEqual({ purpose: "desktop" });
    authorized = true;
    return route.fulfill({ status: 204 });
  });
  await page.route("**/v1/cloud-control/status", (route) =>
    route.fulfill({
      json: {
        enabled: false,
        host_label: "Fixture Mac",
        desktop_configured: true,
        desktop_authorized: authorized,
        idle_minutes: 30,
        idle_revision: 0,
        local: false,
        unlocked_until: null,
      },
    }),
  );
  await page.route("**/v1/cloud-control/desktop/connect", (route) =>
    route.fulfill({ status: 204 }),
  );
  let desktopSocket: WebSocketRoute | undefined;
  let receivedImageAck = false;
  await page.routeWebSocket("**/v1/cloud-control/desktop/socket*", (socket) => {
    desktopSocket = socket;
    socket.onMessage((message) => {
      if (typeof message !== "string") return;
      if (message.startsWith("0.,4.ping,")) socket.send(message);
      if (message.startsWith("3.ack,")) receivedImageAck = true;
    });
    socket.send("0.,7.fixture;4.size,1.0,2.64,2.40;4.sync,1.1;");
  });
  await page.goto("/cloud-control");
  const desktop = page.getByRole("region", { name: "远程桌面", exact: true });
  await desktop.getByRole("button", { name: "连接桌面", exact: true }).click();
  const unlock = page.getByRole("dialog", { name: "验证桌面访问权限" });
  const password = unlock.getByLabel("管理员密码");
  await expect(password).toBeFocused();
  await password.fill("wrong-password");
  await unlock.getByRole("button", { name: "验证", exact: true }).click();
  await expect(unlock.getByRole("alert")).toHaveText("密码不正确");
  expect(authorized).toBe(false);
  await password.fill("fixture-password");
  await password.press("Enter");
  await expect(unlock).toBeHidden();
  await desktop.getByLabel("VNC 密码", { exact: true }).fill("test-vnc");
  await desktop.getByRole("button", { name: "连接桌面", exact: true }).click();
  await expect(desktop.getByText("等待画面", { exact: true })).toBeVisible();
  await page.clock.runFor(20_000);
  const image =
    "UklGRlAAAABXRUJQVlA4IEQAAAAQBACdASpAACgAPm02mEkkIyKhIqgAgA2JZwDU9oAAEA/gNXFtMY4TAAD+nEef67xaUa//wQW1HphqM4x2Z0hkAAAAAA==";
  desktopSocket!.send(
    `3.img,1.1,2.14,1.0,10.image/webp,1.0,1.0;4.blob,1.1,${image.length}.${image};`,
  );
  await expect.poll(() => receivedImageAck).toBe(true);
  await page.clock.runFor(6_000);
  await expect(desktop.getByText("等待画面", { exact: true })).toBeVisible();
  desktopSocket!.send("3.end,1.1;4.sync,1.2;");
  await expect(desktop.getByText("已连接", { exact: true })).toBeVisible();
  desktopSocket!.send("5.error,20.desktop_idle_timeout,3.512;");
  await expect(desktop.getByLabel("VNC 密码", { exact: true })).toBeVisible();
  expect(passwordChecks).toBe(2);
});

test("cloud settings only configure desktop connection on wide and narrow screens", async ({
  page,
}) => {
  await page.route("**/v1/cloud-control/status", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        host_label: "MacBook Air",
        desktop_configured: true,
        desktop_authorized: true,
        idle_minutes: 30,
        idle_revision: 0,
        local: true,
        unlocked_until: null,
      },
    }),
  );
  const setup = {
    revision: "a".repeat(64),
    host_label: "MacBook Air",
    enabled: true,
    public_enabled: false,
    public_desktop_vnc_only: true,
    guacd_ready: true,
    screen_sharing_ready: true,
  };
  await page.route("**/v1/cloud-control/settings", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: setup });
    expect(route.request().postDataJSON()).toEqual({
      revision: setup.revision,
      host_label: "MacBook Air",
      public_enabled: true,
    });
    return route.fulfill({ json: { ...setup, public_enabled: true } });
  });
  await page.route("**/v1/auth/reauth", (route) =>
    route.fulfill({ json: { verified: true } }),
  );
  await page.setViewportSize({ width: 1470, height: 900 });
  await page.goto("/cloud-control");
  await page.getByRole("button", { name: "云控设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "云控设置" });
  const connection = dialog.getByRole("region", { name: "桌面连接" });
  const save = dialog.getByRole("button", { name: "保存设置" });
  await expect(connection).toBeVisible();
  await expect(dialog.getByText("项目授权")).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: "云控设置" })).toBeFocused();
  await save.hover();
  await expect(save).toHaveCSS("color", "rgb(24, 18, 15)");
  const publicDesktop = connection.getByRole("checkbox", {
    name: "允许已授权管理员从公网连接桌面",
  });
  await publicDesktop.press("Space");
  await expect(publicDesktop).toBeChecked();

  await page.setViewportSize({ width: 390, height: 680 });
  await expect(save).toBeInViewport();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await dialog.getByLabel("FPL 管理员密码").fill("fixture-password");
  await save.click();
  await expect(dialog.getByRole("status")).toHaveText("云控设置已保存");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).toBeHidden();
});

test("programming CLI controls have room and admins have no per-CLI grant switches", async ({
  page,
}, info) => {
  await page.route("**/v1/code-agents", (route) =>
    route.fulfill({
      json: {
        can_enable: true,
        items: [
          {
            id: "codex",
            name: "Codex",
            enabled: false,
            available: false,
            executable: "",
            version: "",
            status: "disabled",
            message: "部署尚未启用此 Agent",
          },
        ],
      },
    }),
  );
  await page.setViewportSize({ width: 1470, height: 900 });
  await page.goto("/code-agents");
  const card = page.getByRole("article", { name: "Codex 连接" });
  const enable = card.getByRole("button", { name: "启用 CLI 连接" });
  const command = card.getByText(
    'npm --prefix "<FPL 安装目录>" run codex:login',
    { exact: true },
  );
  await expect(enable).toBeVisible();
  await expect(command).toBeVisible();
  await expect(
    page.getByRole("region", { name: "智能体用途授权表" }),
  ).toHaveCount(0);
  for (const width of [1470, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const button = (await enable.boundingBox())!;
    const login = (await command.boundingBox())!;
    expect(button.y - (login.y + login.height)).toBeGreaterThanOrEqual(12);
  }
  await page.setViewportSize({ width: 1470, height: 900 });
  await card.screenshot({
    path: info.outputPath("cli-connection-controls.png"),
  });
});
