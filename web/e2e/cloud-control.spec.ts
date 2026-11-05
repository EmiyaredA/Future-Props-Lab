import { expect, test, type WebSocketRoute } from "@playwright/test";

test("cloud control resizes both panes and retains the original workbench", async ({
  page,
}) => {
  await page.goto("/apps");
  await expect(
    page.getByRole("button", { name: "打开Agent 工作台", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "云控", exact: true }).click();
  await expect(page).toHaveURL(/\/cloud-control$/);
  const desktop = page.getByRole("region", { name: "远程桌面", exact: true });
  const chat = page.getByRole("region", { name: "Agent 工作台", exact: true });
  const divider = page.getByRole("separator", { name: "调整远程桌面宽度" });
  for (const width of [390, 768, 1280, 1616]) {
    await page.setViewportSize({ width, height: 973 });
    for (const theme of ["浅色", "深色"]) {
      await page.getByRole("button", { name: theme, exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "云控", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    }
    if (width < 820) {
      const switcher = page.getByRole("group", { name: "云控面板" });
      await switcher.getByRole("button", { name: "远程桌面" }).click();
      await expect(desktop).toBeVisible();
      await expect(chat).toBeHidden();
      await switcher.getByRole("button", { name: "Agent 工作台" }).click();
      await expect(chat).toBeVisible();
      await expect(desktop).toBeHidden();
    } else {
      await expect(chat).toBeVisible();
      await expect(desktop).toBeVisible();
    }
  }
  await divider.focus();
  await page.keyboard.press("ArrowLeft");
  const ratio = await divider.getAttribute("aria-valuenow");
  expect(Number(ratio)).toBeLessThan(65);
  const position = await divider.boundingBox();
  expect(position).not.toBeNull();
  await page.mouse.move(position!.x + position!.width / 2, position!.y + 40);
  await page.mouse.down();
  await page.mouse.move(position!.x - 100, position!.y + 40, { steps: 5 });
  await page.mouse.up();
  const dragged = await divider.getAttribute("aria-valuenow");
  expect(Number(dragged)).toBeLessThan(Number(ratio));
  await page.reload();
  await expect(divider).toHaveAttribute("aria-valuenow", dragged!);
  await page.getByRole("button", { name: "会话历史" }).click();
  await page.getByRole("button", { name: "查看完整工作台" }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await expect(
    page.getByRole("region", { name: "Agent 工作台" }),
  ).toBeVisible();
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

test("the embedded desktop connects and the selected CLI survives reload", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const deadline = Math.floor(Date.now() / 1000) + 600;
  let preference = { idle_minutes: 30, revision: 0 };
  await page.route("**/v1/cloud-control/desktop/idle", (route) => {
    const next = preference.revision === 0 ? 120 : 15;
    expect(route.request().postDataJSON()).toEqual({
      idle_minutes: next,
      revision: preference.revision,
    });
    preference = { idle_minutes: next, revision: preference.revision + 1 };
    return route.fulfill({ json: preference });
  });
  await page.route("**/v1/cloud-control/status", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        host_label: "Fixture Mac",
        desktop_configured: true,
        desktop_authorized: true,
        idle_minutes: preference.idle_minutes,
        idle_revision: preference.revision,
        local: true,
        enrolled: true,
        unlocked_until: deadline,
      },
    }),
  );
  await page.route("**/v1/cloud-control/desktop/connect", (route) => {
    expect(route.request().postDataJSON()).toEqual({ password: "test-vnc" });
    return route.fulfill({ status: 204 });
  });
  let desktopSocket: WebSocketRoute | undefined;
  let desktopConnections = 0;
  const firstFrame =
    "4.rect,1.0,1.0,1.0,3.640,3.400;5.cfill,2.14,1.0,1.0,1.0,1.0,3.255;4.sync,1.2;";
  const desktopInputs: string[] = [];
  await page.routeWebSocket("**/v1/cloud-control/desktop/socket*", (socket) => {
    desktopConnections += 1;
    desktopSocket = socket;
    socket.onMessage((message) => {
      if (typeof message !== "string") return;
      if (message.startsWith("0.,4.ping,")) socket.send(message);
      else if (/^(3\.key,|5\.mouse,|11\.fpl_release;)/.test(message))
        desktopInputs.push(message);
    });
    socket.send("0.,7.fixture;4.size,1.0,3.640,3.400;4.sync,1.1;");
    if (desktopConnections > 3) socket.send(firstFrame);
  });
  await page.route("**/v1/agent-workbench/execution/catalog", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        projects: [{ id: "fixture", label: "Fixture project" }],
        agents: [
          { id: "codex", label: "Codex", available: true, status: "已连接" },
          { id: "pi", label: "Pi", available: true, status: "已连接" },
        ],
      },
    }),
  );
  const chat = {
    id: "fixture-chat",
    project_id: "fixture",
    agent_id: "codex",
    created_at: deadline,
  };
  let turns: {
    id: string;
    position: number;
    prompt: string;
    answer: string;
    status: string;
    approvals: never[];
    revision: number;
  }[] = [];
  await page.route("**/v1/agent-workbench/chats", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({
        project_id: "fixture",
        agent_id: "codex",
      });
      await route.fulfill({ status: 201, json: chat });
    } else {
      await route.fulfill({ json: [chat] });
    }
  });
  await page.route("**/v1/agent-workbench/chats/fixture-chat", (route) =>
    route.fulfill({ json: { ...chat, turns } }),
  );
  await page.route("**/v1/agent-workbench/chats/fixture-chat/events", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: "event: change\ndata: []\n\n",
    }),
  );
  await page.route(
    "**/v1/agent-workbench/chats/fixture-chat/turns",
    async (route) => {
      const position = turns.length + 1;
      const turn = {
        id: `turn-${position}`,
        position,
        prompt: route.request().postDataJSON().text,
        answer: `回复 ${position}`,
        status: "completed",
        approvals: [] as never[],
        revision: 2,
      };
      turns = [...turns, turn];
      await route.fulfill({ status: 202, json: turn });
    },
  );
  await page.setViewportSize({ width: 1440, height: 920 });
  await page.goto("/cloud-control");
  const desktop = page.getByRole("region", { name: "远程桌面", exact: true });
  const startDesktop = async (button: string) => {
    await desktop.getByRole("button", { name: button, exact: true }).click();
    const dialog = desktop.getByRole("dialog", { name: "连接 Mac" });
    await dialog.getByLabel("VNC 密码", { exact: true }).fill("test-vnc");
    await dialog.getByRole("button", { name: "连接桌面" }).click();
  };
  await startDesktop("连接桌面");
  await expect(desktop.getByText("等待画面", { exact: true })).toBeVisible();
  await expect(desktop.getByText("已连接", { exact: true })).toHaveCount(0);
  await expect(desktop.locator(".cloud-remote-surface")).toBeHidden();
  await expect(desktop.getByRole("button", { name: "全屏" })).toBeDisabled();
  await expect(desktop.getByText(/等待桌面画面超时/)).toBeVisible({
    timeout: 28_000,
  });
  await expect(desktop.locator("canvas")).toHaveCount(0);
  await startDesktop("重新连接");
  await expect(desktop.getByText("等待画面", { exact: true })).toBeVisible();
  await desktopSocket!.close({ code: 1012 });
  await expect(
    desktop.getByText("远程桌面连接在画面显示前中断，请重新连接。"),
  ).toBeVisible();
  await expect(desktop.locator("canvas")).toHaveCount(0);
  await startDesktop("重新连接");
  await expect(desktop.getByText("等待画面", { exact: true })).toBeVisible();
  // An opaque black frame is valid. An empty canvas after size + sync is not.
  desktopSocket!.send(firstFrame);
  await expect(desktop.getByText("已连接", { exact: true })).toBeVisible();
  await expect(desktop.getByText("640 × 400")).toBeVisible();
  const surface = desktop.locator(".cloud-remote-surface");
  const keyboard = desktop.getByRole("textbox", { name: /^Mac 远程键盘/ });
  const bounds = (await surface.boundingBox())!;
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await expect(keyboard).toBeFocused();
  await expect(desktop.getByText(/键盘已接管/)).toBeVisible();
  await page.keyboard.press("a");
  await page.keyboard.press("Enter");
  await keyboard.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart"));
    element.dispatchEvent(
      new CompositionEvent("compositionend", { data: "中" }),
    );
  });
  await expect
    .poll(() => desktopInputs)
    .toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^5\.mouse,3\.(319|320),3\.(199|200),1\.1;$/),
        "3.key,2.97,1.1;",
        "3.key,2.97,1.0;",
        "3.key,5.65293,1.1;",
        "3.key,5.65293,1.0;",
        "3.key,8.16797229,1.1;",
        "3.key,8.16797229,1.0;",
      ]),
    );
  await page.keyboard.press("Shift+Escape");
  await expect(desktop.getByRole("button", { name: "断开" })).toBeFocused();
  await expect.poll(() => desktopInputs).toContain("11.fpl_release;");
  await expect(desktop.getByText("点击画面接管键盘")).toBeVisible();
  expect(desktopInputs).not.toContain("3.key,5.65307,1.1;");
  await page.getByRole("button", { name: "深色", exact: true }).click();
  const idleTrigger = desktop.getByRole("button", { name: /自动锁定 ·/ });
  await idleTrigger.click();
  const idle = desktop.getByRole("dialog", { name: "自动锁定" });
  await expect(idle.getByRole("button", { name: "30 分钟" })).toBeFocused();
  await idle.getByRole("button", { name: "自定义" }).click();
  const duration = idle.getByRole("spinbutton", { name: "自定义时长" });
  const saveIdle = idle.getByRole("button", { name: "保存", exact: true });
  await duration.fill("121");
  await saveIdle.click();
  await expect(idle.getByRole("alert")).toHaveText("请输入 5–120 之间的整数。");
  expect(preference.revision).toBe(0);
  await duration.fill("120");
  await idle.screenshot({
    path: test.info().outputPath("cloud-idle-desktop.png"),
  });
  await saveIdle.click();
  await expect(idleTrigger).toHaveText("自动锁定 · 120 分钟");
  await expect(idleTrigger).toBeFocused();

  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await idleTrigger.click();
  await expect(duration).toHaveValue("120");
  await expect(saveIdle).toBeInViewport();
  expect(
    await idle.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await idle.screenshot({
    path: test.info().outputPath("cloud-idle-mobile.png"),
  });
  await page.keyboard.press("Escape");
  await expect(idle).toBeHidden();
  await expect(idleTrigger).toBeFocused();

  await page.setViewportSize({ width: 1440, height: 920 });
  await idleTrigger.click();
  await idle.getByRole("button", { name: "15 分钟", exact: true }).click();
  await saveIdle.click();
  await expect(
    desktop.getByRole("button", { name: "自动锁定 · 15 分钟" }),
  ).toBeVisible();
  await desktop.getByRole("button", { name: "适应窗口", exact: true }).click();
  const fullscreen = desktop.getByRole("button", { name: "全屏", exact: true });
  await fullscreen.click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(true);
  await fullscreen.click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(false);
  await page.getByRole("combobox", { name: "选择 CLI", exact: true }).click();
  await page.getByRole("option", { name: "Codex CLI", exact: true }).click();
  await page.getByRole("combobox", { name: "选择项目", exact: true }).click();
  await page
    .getByRole("option", { name: "Fixture project", exact: true })
    .click();
  const input = page.getByRole("textbox", { name: "给 Agent 发消息" });
  await input.fill("第一条消息");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("回复 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.screenshot({
    path: test.info().outputPath("cloud-control-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 900 });
  const switcher = page.getByRole("group", { name: "云控面板" });
  await switcher.getByRole("button", { name: "Agent 工作台" }).click();
  await expect(page.getByText("回复 1", { exact: true })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("cloud-control-mobile.png"),
  });
  await switcher.getByRole("button", { name: "远程桌面" }).click();
  await expect(desktop.getByText("已连接", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1800, height: 920 });
  await input.fill("正在输入的草稿");
  const viewport = await page.locator(".cloud-workspace").boundingBox();
  expect(viewport!.width).toBeGreaterThan(1650);
  desktopSocket!.send("5.error,20.desktop_idle_timeout,3.512;");
  await expect(
    desktop.getByRole("dialog", { name: "远程桌面已锁定" }),
  ).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("正在输入的草稿");
  await expect(desktop.locator("canvas")).toHaveCount(0);
  await page.getByLabel("VNC 密码", { exact: true }).fill("test-vnc");
  await desktop.getByRole("button", { name: "重新连接", exact: true }).click();
  await expect(desktop.getByText("已连接", { exact: true })).toBeVisible();
  await desktopSocket!.close({ code: 1012 });
  await expect(desktop.getByText("远程桌面已断开，请重新连接。")).toBeVisible();
  await expect(desktop.locator("canvas")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("回复 1", { exact: true })).toBeVisible();
  await input.fill("接着聊");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("回复 2", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("public desktop can display a WebP first frame after a slow transfer", async ({
  page,
}) => {
  await page.clock.install();
  await page.route("**/v1/cloud-control/status", (route) =>
    route.fulfill({
      json: {
        enabled: false,
        host_label: "Fixture Mac",
        desktop_configured: true,
        desktop_authorized: true,
        idle_minutes: 30,
        idle_revision: 0,
        local: false,
        enrolled: false,
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
        enrolled: false,
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
    enrolled: false,
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

test("cloud workbench starts chats from recommended, browsed and pasted directories", async ({
  page,
}) => {
  const base = "/Users/demo/Projects";
  const recommended = `${base}/recommended`;
  const browsed = `${base}/browsed`;
  const pasted = "/Volumes/Work/pasted";
  const picked: { id: string; label: string; root: string }[] = [];
  const chats = new Map<
    string,
    {
      id: string;
      project_id: string;
      project_label: string;
      agent_id: string;
      created_at: number;
    }
  >();
  const deadline = Math.floor(Date.now() / 1000) + 600;
  await page.route("**/v1/cloud-control/status", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        host_label: "Mac",
        desktop_configured: true,
        desktop_authorized: true,
        idle_minutes: 30,
        idle_revision: 0,
        local: true,
        enrolled: true,
        unlocked_until: deadline,
      },
    }),
  );
  await page.route("**/v1/agent-workbench/execution/catalog", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        projects: [],
        can_select_directory: true,
        recent_projects: picked,
        suggested_directories: [{ root: recommended, label: "recommended" }],
        agents: [
          { id: "codex", label: "Codex", available: true, status: "可用" },
        ],
      },
    }),
  );
  await page.route("**/v1/agent-workbench/execution/directories*", (route) => {
    const parent = new URL(route.request().url()).searchParams.get("parent");
    return route.fulfill({
      json:
        parent === browsed
          ? { parent: base, selectable: true, items: [] }
          : {
              parent: null,
              selectable: false,
              items: parent
                ? [{ root: browsed, label: "browsed" }]
                : [{ root: base, label: "项目" }],
            },
    });
  });
  await page.route("**/v1/agent-workbench/execution/projects", (route) => {
    const { root } = route.request().postDataJSON();
    if (root === "/invalid")
      return route.fulfill({ status: 409, json: { detail: "项目目录不可用" } });
    expect([recommended, browsed, pasted]).toContain(root);
    const label = root.split("/").at(-1);
    const project = { id: `local-${label}`, label, root };
    if (!picked.some((item) => item.id === project.id)) picked.unshift(project);
    return route.fulfill({ json: { id: project.id, label } });
  });
  await page.route("**/v1/agent-workbench/chats", (route) => {
    const { project_id, agent_id } = route.request().postDataJSON();
    const project = picked.find((item) => item.id === project_id);
    expect(project).toBeDefined();
    const chat = {
      id: `chat-${project_id}`,
      project_id,
      agent_id,
      project_label: project!.label,
      created_at: deadline,
    };
    chats.set(chat.id, chat);
    return route.fulfill({ status: 201, json: chat });
  });
  await page.route("**/v1/agent-workbench/chats/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    return route.fulfill({ json: { ...chats.get(id), turns: [] } });
  });
  await page.route("**/v1/agent-workbench/chats/*/turns", (route) =>
    route.fulfill({ status: 202, json: {} }),
  );
  await page.route("**/v1/agent-workbench/chats/*/events", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: "event: change\ndata: {}\n\n",
    }),
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/cloud-control");
  const workbench = page.getByRole("region", { name: "Agent 工作台" });
  const picker = page.getByRole("dialog", { name: "选择项目", exact: true });
  const browser = page.getByRole("dialog", { name: "选择项目目录" });
  const select = workbench.getByRole("button", {
    name: "选择项目",
    exact: true,
  });
  const newChat = workbench.getByRole("button", { name: "新会话" });
  async function send(label: string) {
    await expect(
      workbench.getByRole("button", { name: label, exact: true }),
    ).toBeVisible();
    const cli = workbench.getByRole("combobox", { name: "选择 CLI" });
    if ((await cli.innerText()).includes("选择 CLI")) {
      await cli.click();
      await page.getByRole("option", { name: "Codex CLI" }).click();
    }
    await workbench
      .getByRole("textbox", { name: "给 Agent 发消息" })
      .fill(`hello ${label}`);
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith("/chats") && response.status() === 201,
    );
    await workbench.getByRole("button", { name: "发送", exact: true }).click();
    expect((await (await created).json()).project_id).toBe(`local-${label}`);
    await expect(
      workbench.getByRole("button", { name: label, exact: true }),
    ).toHaveCount(0);
  }
  await select.click();
  await picker
    .getByRole("region", { name: "推荐项目" })
    .getByRole("button", { name: /recommended/ })
    .click();
  await send("recommended");
  await newChat.click();
  await workbench
    .getByRole("button", { name: "recommended", exact: true })
    .click();
  await picker.getByRole("button", { name: "选择其他目录" }).click();
  await browser.getByRole("button", { name: "项目", exact: true }).click();
  await browser.getByRole("button", { name: "browsed", exact: true }).click();
  await expect(browser.getByText(browsed, { exact: true })).toBeVisible();
  await browser
    .getByRole("button", { name: "使用此目录", exact: true })
    .click();
  await send("browsed");

  await newChat.click();
  await page.setViewportSize({ width: 390, height: 680 });
  const chatTab = page
    .getByRole("group", { name: "云控面板" })
    .getByRole("button", { name: "Agent 工作台" });
  await chatTab.click();
  await workbench.getByRole("button", { name: "browsed", exact: true }).click();
  await picker.getByRole("button", { name: "选择其他目录" }).click();
  const path = browser.getByLabel("或粘贴项目绝对路径");
  await path.fill("/invalid");
  await browser.getByRole("button", { name: "使用粘贴的路径" }).click();
  await expect(browser.getByRole("alert")).toBeVisible();
  await expect(path).toHaveValue("/invalid");
  await path.fill(pasted);
  await browser.getByRole("button", { name: "使用粘贴的路径" }).click();
  await send("pasted");

  await page.reload();
  await chatTab.click();
  await newChat.click();
  await select.click();
  const recent = picker.getByRole("region", { name: "最近项目" });
  await expect(recent.getByRole("button")).toHaveCount(3);
  await recent.getByRole("button", { name: /pasted/ }).click();
  await expect(
    workbench.getByRole("button", { name: "pasted", exact: true }),
  ).toBeVisible();
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
  const command = card.getByText("npm run codex:login", { exact: true });
  await expect(enable).toBeVisible();
  await expect(command).toBeVisible();
  await expect(
    page.getByRole("region", { name: "智能体用途授权表" }),
  ).toHaveCount(0);
  for (const width of [1470, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const button = (await enable.boundingBox())!;
    const login = (await command.boundingBox())!;
    expect(login.y - (button.y + button.height)).toBeGreaterThanOrEqual(12);
  }
  await page.setViewportSize({ width: 1470, height: 900 });
  await card.screenshot({
    path: info.outputPath("cli-connection-controls.png"),
  });
});
