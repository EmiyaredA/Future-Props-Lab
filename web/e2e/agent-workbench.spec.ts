import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import {
  workbenchEntries,
  workbenchSessions,
  workbenchSource,
} from "./fixtures/agent-workbench";

test("Agent workbench APP/CLI reading, filters, source consent and responsive themes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let source = { ...workbenchSource };
  let historyCount = 4;
  let historyRequests = 0;
  let bound = false;
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
    localStorage.setItem("future-props-theme", "dark"),
  );
  await page.goto("/apps/agent-workbench/sessions/fixture-0");
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
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
        await page.keyboard.press("Escape");
      }
      if (width === 390 && theme === "dark")
        await page.screenshot({
          path: resolve(qa, "workbench-mobile-dark.png"),
        });
      if (width === 1616 && theme === "light")
        await page.screenshot({
          path: resolve(qa, "workbench-desktop-light.png"),
        });
    }
  }
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
