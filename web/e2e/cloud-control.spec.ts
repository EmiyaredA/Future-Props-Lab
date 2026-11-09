import { expect, test } from "@playwright/test";

test("cloud control keeps the remote desktop and Amadeus entry across themes", async ({
  page,
}) => {
  await page.goto("/apps");
  await page.getByRole("button", { name: "云控", exact: true }).click();
  await expect(page).toHaveURL(/\/cloud-control$/);
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
    await expect(
      page.getByRole("region", { name: "远程桌面", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "打开 Amadeus" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Agent 工作台" }),
    ).toHaveCount(0);
  }
});

test("ordinary accounts cannot mount cloud control", async ({ page }) => {
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
    if (request.url().includes("/v1/cloud-control/"))
      requests.push(request.url());
  });
  await page.goto("/cloud-control");
  await expect(
    page.getByRole("heading", { name: "云控仅限管理员访问" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "云控", exact: true }),
  ).toHaveCount(0);
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

test("remote app tabs scroll locally and keep the Mac-only add action visible", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 900 });
  let local = true;
  await page.route("**/v1/cloud-control/status", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        local,
        host_label: "Fixture Mac",
        remote_apps_enabled: true,
        desktop_configured: true,
        desktop_authorized: local,
        idle_minutes: 30,
        idle_revision: 0,
        unlocked_until: 0,
        happier_available: false,
      },
    }),
  );
  await page.route("**/v1/cloud-control/apps", (route) =>
    route.fulfill({
      json: {
        apps: Array.from({ length: 12 }, (_, index) => ({
          id: index.toString(16).padStart(64, "0"),
          name: `Mac 测试应用 ${index + 1}`,
        })),
      },
    }),
  );
  await page.goto("/cloud-control");
  const pane = page.getByRole("region", { name: "远程应用" });
  await expect(pane).toBeVisible({ timeout: 25_000 });
  const header = page.locator(".cloud-page-header");
  const toolbar = header.getByRole("group", { name: "远控操作" });
  const tabs = pane.getByRole("group", { name: "可远控的应用" });
  await expect(tabs.getByRole("button")).toHaveCount(12);
  const add = pane.getByRole("button", { name: "添加应用" });
  await expect(add).toBeInViewport();
  expect(
    await tabs.evaluate((node) => node.scrollWidth > node.clientWidth),
  ).toBe(true);
  await tabs
    .getByRole("button", { name: "Mac 测试应用 12", exact: true })
    .focus();
  await expect(add).toBeInViewport();
  for (const width of [390, 768, 1470]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["浅色", "深色"]) {
      await page.getByRole("button", { name: theme, exact: true }).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      const row = (await pane.locator(".cloud-app-tabs").boundingBox())!;
      const screen = (await pane.locator(".cloud-app-viewport").boundingBox())!;
      expect(screen.y).toBeCloseTo(row.y + row.height, 0);
      expect(
        (await tabs.getByRole("button").first().boundingBox())!.height,
      ).toBeCloseTo(32, 0);
    }
  }
  const heading = (await header
    .getByRole("heading", { name: "云控" })
    .boundingBox())!;
  const connection = (await toolbar.getByRole("status").boundingBox())!;
  expect(connection.x).toBeGreaterThan(heading.x + heading.width);
  expect(Math.abs(connection.y - heading.y)).toBeLessThan(12);
  local = false;
  await page.reload();
  await expect(add).toHaveCount(0);
  await expect(tabs.getByRole("button")).toHaveCount(0);
  await expect(
    pane.getByRole("button", { name: "验证访问权限" }),
  ).toBeVisible();
});

test("remote app idle preference is saved in settings with host controls restricted to local use", async ({
  page,
}) => {
  let local = true;
  let idle = { idle_minutes: 30, revision: 0 };
  let hostRequests = 0;
  await page.route("**/v1/cloud-control/status", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        local,
        host_label: "Fixture Mac",
        remote_apps_enabled: true,
        desktop_configured: true,
        desktop_authorized: local,
        idle_minutes: idle.idle_minutes,
        idle_revision: idle.revision,
        unlocked_until: 0,
        happier_available: false,
      },
    }),
  );
  await page.route("**/v1/cloud-control/apps", (route) =>
    route.fulfill({ json: { apps: [] } }),
  );
  await page.route("**/v1/cloud-control/settings", (route) => {
    hostRequests += 1;
    return route.fulfill({
      json: {
        revision: "a".repeat(64),
        host_label: "Fixture Mac",
        enabled: true,
        remote_apps_enabled: true,
        remote_apps_host_ready: true,
      },
    });
  });
  await page.route("**/v1/cloud-control/desktop/idle", (route) => {
    expect(route.request().method()).toBe("PUT");
    expect(route.request().postDataJSON()).toEqual({
      idle_minutes: local ? 60 : 120,
      revision: idle.revision,
    });
    idle = { idle_minutes: local ? 60 : 120, revision: idle.revision + 1 };
    return route.fulfill({ json: idle });
  });
  await page.goto("/cloud-control");
  const settings = page.getByRole("button", { name: "云控设置" });
  const dialog = page.getByRole("dialog", { name: "云控设置" });
  const preference = dialog.getByRole("form", { name: "自动锁定" });
  const idleEntry = dialog.getByRole("button", { name: /^自动锁定 ·/ });
  await expect(page.getByRole("button", { name: /^自动锁定 ·/ })).toHaveCount(
    0,
  );
  await settings.click();
  await expect(dialog.getByLabel("主机显示名")).toBeVisible();
  await expect(idleEntry).toHaveText(/30 分钟/);
  await idleEntry.click();
  await preference.getByRole("button", { name: "60 分钟" }).click();
  await preference.getByRole("button", { name: "保存", exact: true }).click();
  await expect(idleEntry).toHaveText(/60 分钟/);
  await expect(idleEntry).toBeFocused();
  await dialog.getByRole("button", { name: "关闭云控设置" }).click();
  await expect(settings).toBeFocused();
  expect(hostRequests).toBe(1);

  local = false;
  await page.reload();
  await settings.click();
  await expect(dialog.getByLabel("主机显示名")).toHaveCount(0);
  await expect(idleEntry).toHaveText(/60 分钟/);
  await idleEntry.click();
  await preference.getByRole("button", { name: "自定义" }).click();
  await preference.getByLabel("自定义时长").fill("121");
  await preference.getByRole("button", { name: "保存", exact: true }).click();
  await expect(preference.getByRole("alert")).toContainText("5–120");
  await preference.getByLabel("自定义时长").fill("120");
  await preference.getByRole("button", { name: "保存", exact: true }).click();
  await expect(idleEntry).toHaveText(/120 分钟/);
  await dialog.getByRole("button", { name: "关闭云控设置" }).click();
  await settings.click();
  await expect(idleEntry).toHaveText(/120 分钟/);
  expect(hostRequests).toBe(1);
});

test("connected remote app controls overlay the viewer and remain usable in fullscreen", async ({
  page,
  browserName,
}, info) => {
  await page.setViewportSize({ width: 1470, height: 900 });
  await page.addInitScript(() => {
    // Keep the browser's video and fullscreen behavior, while using a local
    // canvas track instead of connecting to the Mac capture helper.
    class FixturePeer {
      iceGatheringState = "complete";
      localDescription = { type: "offer", sdp: "fixture" };
      ontrack?: (event: { track: MediaStreamTrack }) => void;
      stream?: MediaStream;
      drawing?: number;
      addTransceiver() {
        return { receiver: {} };
      }
      createDataChannel() {
        const channel = {
          readyState: "connecting",
          bufferedAmount: 0,
          onopen: () => {},
          send(message: string) {
            if (JSON.parse(message).type === "down")
              document.body.dataset.fixtureClick = message;
          },
        };
        window.addEventListener(
          "fixture-input-open",
          () => {
            channel.readyState = "open";
            channel.onopen();
          },
          { once: true },
        );
        return channel;
      }
      async createOffer() {
        return this.localDescription;
      }
      async setLocalDescription() {}
      async setRemoteDescription() {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 200;
        const context = canvas.getContext("2d")!;
        this.stream = canvas.captureStream(10);
        this.drawing = window.setInterval(() => {
          context.fillStyle = "#24354b";
          context.fillRect(0, 0, canvas.width, canvas.height);
        }, 80);
        this.ontrack?.({ track: this.stream.getVideoTracks()[0] });
      }
      close() {
        window.clearInterval(this.drawing);
        this.stream?.getTracks().forEach((track) => track.stop());
      }
    }
    Object.defineProperty(window, "RTCPeerConnection", { value: FixturePeer });
  });
  await page.route("**/v1/cloud-control/status", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        local: true,
        host_label: "Fixture Mac",
        remote_apps_enabled: true,
        desktop_configured: true,
        desktop_authorized: true,
        idle_minutes: 30,
        idle_revision: 0,
        unlocked_until: 0,
        happier_available: false,
      },
    }),
  );
  const app = { id: "a".repeat(64), name: "Codex" };
  await page.route("**/v1/cloud-control/apps", (route) =>
    route.fulfill({ json: { apps: [app] } }),
  );
  await page.route("**/v1/cloud-control/apps/connect", (route) =>
    route.fulfill({ json: { ticket: "fixture", ice_servers: [] } }),
  );
  let setHostInputReady!: (ready: boolean) => void;
  const selections: number[] = [];
  await page.routeWebSocket("**/v1/cloud-control/apps/socket", (socket) => {
    setHostInputReady = (ready) =>
      socket.send(JSON.stringify({ type: "input-state", ready }));
    socket.onMessage((data) => {
      const message = JSON.parse(data.toString());
      if (message.type === "offer") {
        socket.send(
          JSON.stringify({
            type: "windows",
            windows: [{ id: 1, title: "Fixture window" }],
          }),
        );
      }
      if (message.type === "select") {
        selections.push(message.window);
        socket.send(JSON.stringify({ type: "answer", sdp: "fixture" }));
      }
    });
  });
  await page.goto("/cloud-control");
  await page.getByRole("button", { name: "连接应用", exact: true }).click();
  const heading = page.getByRole("group", { name: "远控操作" });
  await expect(heading.getByRole("status")).toHaveText("画面已连接，等待键鼠");
  await expect(
    heading.getByRole("combobox", { name: "远程应用窗口" }),
  ).toHaveText("Fixture window");
  const viewport = page.locator(".cloud-app-viewport");
  const video = viewport.locator("video");
  const remoteKeyboard = viewport.getByRole("textbox", { name: /^应用键盘/ });
  await expect(remoteKeyboard).toBeDisabled();
  setHostInputReady(false);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("fixture-input-open")),
  );
  await expect(heading.getByRole("status")).toHaveText(
    "画面已连接，键鼠已暂停",
  );
  const refocus = viewport.getByRole("button", { name: "恢复键鼠" });
  await expect(refocus).toBeVisible();
  await expect(remoteKeyboard).toBeDisabled();
  setHostInputReady(true);
  await expect(heading.getByRole("status")).toHaveText("已连接");
  await expect(remoteKeyboard).toBeEnabled();

  for (const size of [
    { width: 1470, height: 900 },
    { width: 390, height: 510 },
  ]) {
    await page.setViewportSize(size);
    const screen = (await viewport.boundingBox())!;
    const picture = (await video.boundingBox())!;
    expect(picture.x).toBeCloseTo(screen.x);
    expect(picture.y).toBeCloseTo(screen.y);
    expect(picture.width).toBeCloseTo(screen.width);
    expect(picture.height).toBeCloseTo(screen.height);
    const scale = Math.min(picture.width / 320, picture.height / 200);
    await page.mouse.click(
      picture.x + picture.width / 2 - 80 * scale,
      picture.y + picture.height / 2 + 50 * scale,
    );
    await expect(remoteKeyboard).toBeFocused();
    const click = await page.evaluate(() =>
      JSON.parse(document.body.dataset.fixtureClick!),
    );
    expect(click.x).toBeCloseTo(0.25);
    expect(click.y).toBeCloseTo(0.75);
    expect(
      await viewport.evaluate(
        (node) => getComputedStyle(node, "::after").borderTopWidth,
      ),
    ).toBe("2px");
  }
  await page.setViewportSize({ width: 1470, height: 900 });
  const tools = viewport.getByRole("group", { name: "画面操作" });
  const fit = tools.getByRole("button", { name: "适应窗口" });
  const disconnect = heading.getByRole("button", { name: "断开连接" });
  const fullscreen = tools.getByRole("button", { name: "全屏", exact: true });

  await page.mouse.move(0, 0);
  await expect(tools).toHaveCSS("opacity", "0");
  await viewport.hover();
  await expect(tools).toHaveCSS("opacity", "1");
  await page.screenshot({ path: info.outputPath("remote-app-hover.png") });
  await page.mouse.move(0, 0);
  await fit.focus();
  await expect(tools).toHaveCSS("opacity", "1");
  await fit.press("Space");
  await expect(fit).toHaveAttribute("aria-pressed", "false");
  await expect(viewport).toHaveAttribute("data-fit", "false");

  await fullscreen.click();
  const exit = tools.getByRole("button", { name: "退出全屏" });
  await expect(exit).toBeVisible();
  await expect
    .poll(() =>
      viewport.evaluate((node) => document.fullscreenElement === node),
    )
    .toBe(true);
  setHostInputReady(false);
  await expect(viewport.getByRole("status")).toHaveText(
    "画面已连接，键鼠已暂停",
  );
  await expect(refocus).toBeVisible();
  setHostInputReady(true);
  await expect(remoteKeyboard).toBeEnabled();
  await remoteKeyboard.focus();
  await remoteKeyboard.press("Shift+Escape");
  await expect(exit).toBeFocused();
  await exit.press("Enter");
  await expect(fullscreen).toBeVisible();
  await remoteKeyboard.focus();
  await remoteKeyboard.press("Shift+Escape");
  await expect(disconnect).toBeFocused();

  if (browserName === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    await page.mouse.move(0, 0);
    await expect(tools).toHaveCSS("opacity", "1");
    await expect(fit).toHaveCSS("min-height", "44px");
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await cdp.detach();
  }
  setHostInputReady(false);
  await refocus.click();
  await expect(heading.getByRole("status")).toHaveText("画面已连接，等待键鼠");
  expect(selections).toEqual([1, 1]);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("fixture-input-open")),
  );
  await expect(heading.getByRole("status")).toHaveText("已连接");
  await disconnect.click();
  await expect(heading.getByRole("status")).toHaveText("未连接");
  await expect(tools).toHaveCount(0);
});
