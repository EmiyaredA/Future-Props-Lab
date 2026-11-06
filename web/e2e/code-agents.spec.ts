import { expect, test } from "@playwright/test";
import type { Agent } from "../src/features/code-agents/api";

const codex: Agent = {
  id: "codex",
  name: "Codex",
  executable: "/fixture/bin/codex",
  version: "0.166.0",
  enabled: true,
  available: false,
  status: "not_authenticated",
  message: "请在本机为 FPL 的 Codex 单独登录",
  models: [],
};

const disabledAgents: Agent[] = (
  [
    ["claude-code", "Claude Code"],
    ["opencode", "OpenCode"],
    ["dsh", "DeepSeek Harness"],
    ["pi", "Pi"],
  ] as const
).map(([id, name]) => ({
  id,
  name,
  executable: "",
  version: "",
  enabled: false,
  available: false,
  status: "disabled",
  message: "部署尚未启用此 Agent",
  models: [],
}));

test("Code Agents guide, keyboard detection and responsive themes", async ({
  page,
}, testInfo) => {
  let detections = 0;
  await page.route("**/v1/code-agents**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/detect")) {
      expect(route.request().method()).toBe("POST");
      detections++;
    }
    await route.fulfill({
      json: {
        can_enable: false,
        items: [
          detections
            ? { ...codex, available: true, status: "ready", message: "已连接" }
            : codex,
          ...disabledAgents,
        ],
      },
    });
  });

  await page.goto("/code-agents");
  const models = page.getByRole("tab", { name: "模型服务", exact: true });
  const agents = page.getByRole("tab", { name: "编程智能体", exact: true });
  const heading = page.getByRole("heading", {
    name: "模型与智能体",
    exact: true,
  });
  await expect(heading).toBeVisible();
  await agents.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page).toHaveURL(/\/model-service$/);
  await expect(models).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/code-agents$/);
  await expect(agents).toBeFocused();
  await page.goBack();
  await expect(models).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(agents).toHaveAttribute("aria-selected", "true");

  const openCode = page.getByRole("button", {
    name: "OpenCode 未启用",
    exact: true,
  });
  await openCode.focus();
  await page.keyboard.press("Space");
  const openCodeGuide = page.getByRole("region", { name: "OpenCode 接入教程" });
  await expect(
    openCodeGuide.getByText("opencode auth login", { exact: true }),
  ).toBeVisible();
  await expect(
    openCodeGuide.getByText(/请联系运行 FPL 的 Mac 上的管理员/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "启用 CLI 连接" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Codex 未登录", exact: true }).click();
  const guide = page.getByRole("region", { name: "Codex 接入教程" });
  const current = guide.locator('[aria-current="step"]');
  const command = guide.getByText(
    'npm --prefix "<FPL 安装目录>" run codex:login',
    { exact: true },
  );
  const copy = guide.getByRole("button", { name: "复制 Codex 登录命令" });
  const detect = guide.getByRole("button", { name: "重新检测", exact: true });
  await expect(current.getByRole("heading")).toHaveText(
    "为 FPL 单独登录 Codex",
  );
  await expect(command).toHaveCount(1);
  expect(detections).toBe(0);

  for (const theme of ["light", "dark"]) {
    for (const width of [390, 768, 1280, 1600]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await expect(heading).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width + 1);
      expect(
        await command.evaluate((element) => element.scrollWidth),
      ).toBeLessThanOrEqual(
        (await command.evaluate((element) => element.clientWidth)) + 1,
      );
      await page.screenshot({
        path: testInfo.outputPath(`code-agents-${theme}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
      if (width === 390) {
        await copy.scrollIntoViewIfNeeded();
        await expect(copy).toBeInViewport();
        await detect.scrollIntoViewIfNeeded();
        await expect(detect).toBeInViewport();
        await heading.scrollIntoViewIfNeeded();
      }
      await expect(copy).toBeVisible();
    }
  }

  await page.setViewportSize({ width: 1583, height: 993 });
  await page.getByRole("button", { name: "收起二级导航" }).click();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
    window.scrollTo(0, 0);
  });
  const consoleFillsPage = await page
    .locator(".code-agent-console")
    .evaluate((panel) => {
      const main = panel.closest("main")!;
      const page = panel.closest(".code-agents-page")!;
      const gutter = Number.parseFloat(getComputedStyle(page).paddingBottom);
      return (
        main.getBoundingClientRect().bottom -
          panel.getBoundingClientRect().bottom <=
        gutter + 2
      );
    });
  expect(consoleFillsPage).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("code-agents-reference-state.png"),
    animations: "disabled",
  });

  await detect.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Codex 已连接", exact: true }),
  ).toBeVisible();
  expect(detections).toBe(1);
  await expect(current).toHaveCount(0);
  await expect(guide.getByText(/可在有权限的功能中选择 Codex/)).toBeVisible();
  await expect(command).toBeVisible();
  const config = guide.getByRole("button", {
    name: "展开 MCP 配置",
    exact: true,
  });
  await config.focus();
  await page.keyboard.press("Enter");
  const copyConfig = guide.getByRole("button", { name: "复制 Codex MCP 配置" });
  await expect(copyConfig).toBeVisible();
  await page.setViewportSize({ width: 390, height: 780 });
  await copyConfig.scrollIntoViewIfNeeded();
  await expect(copyConfig).toBeInViewport();
  expect(
    await page
      .locator(".code-agent-console")
      .evaluate((panel) => panel.scrollWidth <= panel.clientWidth),
  ).toBe(true);
});
