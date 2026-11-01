import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import {
  workbenchEntries,
  workbenchSessions,
  workbenchSource,
} from "./fixtures/agent-workbench";

async function expectPalette(page: import("@playwright/test").Page) {
  const colors = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const expected = (token: string) => {
      const probe = document.createElement("span");
      probe.style.backgroundColor = root.getPropertyValue(token);
      document.body.append(probe);
      const value = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return value;
    };
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        ".aw-sidebar .custom-select-trigger",
      ),
    ].map((node) => ({
      label: node.getAttribute("aria-label"),
      actual: getComputedStyle(node).backgroundColor,
      expected: expected("--surface-raised"),
      foreground: getComputedStyle(node).color,
      expectedForeground: (() => {
        const probe = document.createElement("span");
        probe.style.color = root.getPropertyValue("--text");
        document.body.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      })(),
    }));
    const rail = document.querySelector<HTMLElement>(
      ".studio-rail-button.is-active",
    );
    const probe = document.createElement("span");
    probe.style.backgroundColor =
      "color-mix(in srgb, var(--accent-soft) 88%, transparent)";
    document.body.append(probe);
    const expectedRail = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      controls,
      rail: rail ? getComputedStyle(rail).backgroundColor : null,
      expectedRail,
    };
  });
  if (colors.rail)
    expect(colors.rail, "侧栏应用选中态").toBe(colors.expectedRail);
  for (const color of colors.controls) {
    expect(color.actual, color.label ?? "筛选控件底色").toBe(color.expected);
    expect(color.foreground, color.label ?? "筛选控件文字").toBe(
      color.expectedForeground,
    );
    const luminance = (value: string) => {
      const channels = (value.match(/[\d.]+/g) ?? [])
        .slice(0, 3)
        .map((v) => Number(v) / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const a = luminance(color.actual),
      b = luminance(color.foreground);
    expect(
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
    ).toBeGreaterThanOrEqual(4.5);
  }
}

async function expectMenuPalette(
  page: import("@playwright/test").Page,
  screenshotPath?: string,
) {
  await page.getByRole("combobox", { name: "会话来源", exact: true }).click();
  const menu = page.getByRole("listbox", { name: "会话来源", exact: true });
  await expect(menu).toBeVisible();
  const palette = await menu.evaluate((node) => {
    const token = (name: string) => {
      const probe = document.createElement("span");
      probe.style.color = getComputedStyle(
        document.documentElement,
      ).getPropertyValue(name);
      document.body.append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    };
    const selected = node.querySelector<HTMLElement>('[aria-selected="true"]')!;
    return {
      background: getComputedStyle(node).backgroundColor,
      expectedBackground: token("--surface"),
      selectedColor: getComputedStyle(selected).color,
      expectedColor: token("--accent-text"),
    };
  });
  expect(palette.background).toBe(palette.expectedBackground);
  expect(palette.selectedColor).toBe(palette.expectedColor);
  if (screenshotPath) await page.screenshot({ path: screenshotPath });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
}

test("Agent workbench APP/CLI reading, filters, source consent and responsive themes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let source = { ...workbenchSource };
  let historyCount = 4;
  let historyRequests = 0;
  let historyFailure = false;
  let bound = false;
  // This fixture exercises the local source form; transport trust is covered by
  // website API tests rather than inferred from Vite's test proxy.
  await page.route("**/v1/automation/runtime", (route) =>
    route.fulfill({ json: { local_browser: true } }),
  );
  await page.route("**/v1/agent-workbench/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/v1/agent-workbench", "");
    if (path === "/events")
      return route.fulfill({
        contentType: "text/event-stream",
        body: ": connected\n\n",
      });
    if (path === "/sources" && route.request().method() === "POST") {
      bound = true;
      return route.fulfill({ status: 201, json: source });
    }
    if (path === "/sources") return route.fulfill({ json: [source] });
    if (path === "/candidates")
      return route.fulfill({
        json: [
          {
            agent_id: "codex",
            root: "/fixture/codex",
            label: "Codex APP / CLI",
            exists: true,
          },
        ],
      });
    if (path === "/sources/fixture-source") {
      source = { ...source, enabled: false, revision: 1 };
      return route.fulfill({ json: source });
    }
    if (path === "/sessions") {
      const items = workbenchSessions.filter(
        (item) =>
          (!url.searchParams.get("agent_id") ||
            item.agent_id === url.searchParams.get("agent_id")) &&
          (!url.searchParams.get("origin") ||
            item.origins.includes(url.searchParams.get("origin")!)) &&
          (!url.searchParams.get("q") ||
            item.title.includes(url.searchParams.get("q")!)),
      );
      return route.fulfill({
        json: { items, next_cursor: null, change_cursor: 1 },
      });
    }
    if (path.endsWith("/history")) {
      historyRequests++;
      if (historyFailure)
        return route.fulfill({
          status: 503,
          json: { detail: "验收：来源暂时不可达，已保留阅读副本" },
        });
      return route.fulfill({
        json: {
          items: workbenchEntries(historyCount),
          next_cursor: null,
          change_cursor: historyCount,
          branches: [],
          selected_branch: null,
        },
      });
    }
    return route.fulfill({
      json:
        workbenchSessions.find((item) => path.endsWith(item.id)) ??
        workbenchSessions[0],
    });
  });
  const qa = resolve(
    process.env.FPL_WORKBENCH_QA_DIR || "../.local/agent-workbench/qa",
  );
  mkdirSync(qa, { recursive: true });
  await page.setViewportSize({ width: 1616, height: 973 });
  await page.addInitScript(() =>
    localStorage.setItem("future_props_theme", "light"),
  );
  await page.goto("/apps");
  await page.getByRole("button", { name: "开发辅助", exact: true }).click();
  await page
    .getByRole("button", { name: "打开Agent 工作台", exact: true })
    .click();
  await expect(page).toHaveURL(/\/apps\/agent-workbench$/);
  await page.goto("/apps/agent-workbench/sessions/fixture-0");
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectPalette(page);
  await expect(
    page.getByRole("heading", { name: "修复文件上传后的预览状态" }),
  ).toBeVisible();
  await expect(
    page.getByText(/建议在上传成功后立即创建预览 URL/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "发送（待接入）" }),
  ).toBeDisabled();
  await expect(page.getByRole("heading", { name: "会话信息" })).toBeVisible();
  await page.locator(".aw-messages").evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.screenshot({ path: resolve(qa, "workbench-desktop-dark.png") });
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expectPalette(page);
  await page.screenshot({ path: resolve(qa, "workbench-desktop-light.png") });
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectPalette(page);
  await page.locator(".aw-messages").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
    node.dispatchEvent(new Event("scroll"));
  });
  await page.getByText("Read · src/Preview.tsx", { exact: true }).click();
  await expect(page.locator(".aw-tool pre")).toBeVisible();
  await page.getByRole("button", { name: "Claude", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /添加数据导出功能/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /优化首页加载性能/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await page.getByLabel("会话来源", { exact: true }).click();
  await page.getByRole("option", { name: "CLI", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /重构用户认证模块/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /优化首页加载性能/ }),
  ).toHaveCount(0);

  // A view refresh must preserve upward reading position, then expose new content.
  historyCount = 30;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByText("记录 30", { exact: false }).last(),
  ).toBeVisible();
  await page.locator(".aw-messages").evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(100);
  const scrollBefore = await page
    .locator(".aw-messages")
    .evaluate((node) => node.scrollTop);
  historyCount = 31;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "有新内容" })).toBeVisible();
  expect(
    await page.locator(".aw-messages").evaluate((node) => node.scrollTop),
  ).toBe(scrollBefore);
  await page.getByRole("button", { name: "有新内容" }).click();
  await page.getByRole("button", { name: /暂停跟随/ }).click();
  const paused = historyRequests;
  historyCount = 32;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(250);
  expect(historyRequests).toBe(paused);
  await page.getByRole("button", { name: /恢复跟随/ }).click();
  await expect.poll(() => historyRequests).toBeGreaterThan(paused);

  for (const width of [390, 768, 1280, 1616]) {
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 973 });
      await page
        .getByRole("button", {
          name: theme === "dark" ? "深色" : "浅色",
          exact: true,
        })
        .click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expectPalette(page);
      const box = await page.locator(".aw-conversation").boundingBox();
      expect(box?.width).toBeGreaterThan(180);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      const overflow = await page
        .locator(".agent-workbench")
        .evaluate((node) => node.scrollWidth > node.clientWidth + 1);
      expect(overflow).toBe(false);
      if (width < 801) {
        await page.getByRole("button", { name: "打开会话列表" }).click();
        await expect(
          page.getByRole("dialog", { name: "已有会话" }),
        ).toBeVisible();
        await expectMenuPalette(page);
        await page.screenshot({
          path: resolve(qa, `workbench-drawer-${width}-${theme}.png`),
        });
        await page.keyboard.press("Escape");
      } else {
        await expectMenuPalette(
          page,
          width === 1616
            ? resolve(qa, `workbench-menu-${theme}.png`)
            : undefined,
        );
      }
      await page.screenshot({
        path: resolve(qa, `workbench-${width}-${theme}.png`),
      });
      if (width === 390 && theme === "dark")
        await page.screenshot({
          path: resolve(qa, "workbench-mobile-dark.png"),
        });
      if (width === 1616 && theme === "light")
        await page.screenshot({
          path: resolve(qa, "workbench-desktop-light-history.png"),
        });
    }
  }
  historyFailure = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const failure = page.locator(".aw-conversation [role='alert']");
  await expect(failure).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page
      .getByRole("button", {
        name: theme === "dark" ? "深色" : "浅色",
        exact: true,
      })
      .click();
    const palette = await failure.evaluate((node) => {
      const probe = document.createElement("span");
      probe.style.color = "color-mix(in srgb, var(--danger) 85%, var(--text))";
      probe.style.backgroundColor = "var(--danger-soft)";
      document.body.append(probe);
      const expected = getComputedStyle(probe);
      const actual = getComputedStyle(node);
      const context = document.createElement("canvas").getContext("2d")!;
      const luminance = (color: string) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b] = Array.from(context.getImageData(0, 0, 1, 1).data)
          .slice(0, 3)
          .map((v) => {
            const s = v / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
        return r * 0.2126 + g * 0.7152 + b * 0.0722;
      };
      const foreground = luminance(actual.color);
      const background = luminance(actual.backgroundColor);
      const value = {
        foreground: actual.color,
        background: actual.backgroundColor,
        expectedForeground: expected.color,
        expectedBackground: expected.backgroundColor,
        contrast:
          (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05),
      };
      probe.remove();
      return value;
    });
    expect(palette.foreground).toBe(palette.expectedForeground);
    expect(palette.background).toBe(palette.expectedBackground);
    expect(palette.contrast).toBeGreaterThanOrEqual(4.5);
    await page.locator(".aw-messages").evaluate((node) => {
      node.scrollTop = 0;
    });
    await page.screenshot({
      path: resolve(qa, `workbench-error-${theme}.png`),
    });
  }
  historyFailure = false;
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(failure).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "工作台导航" })
    .getByRole("button", { name: "来源" })
    .click();
  const consent = page.getByRole("checkbox", { name: /允许当前账号读取/ });
  await expect(
    page.getByRole("button", { name: "绑定并开始同步" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /Codex APP \/ CLI/ }).click();
  await consent.check();
  await page.getByRole("button", { name: "绑定并开始同步" }).click();
  await expect.poll(() => bound).toBe(true);
  await page.screenshot({ path: resolve(qa, "workbench-sources.png") });
  expect(errors).toEqual([]);
});
