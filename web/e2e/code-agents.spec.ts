import { expect, test } from "@playwright/test";
import { setResponsiveTheme } from "./responsive-capture";

test("Code Agents navigation, local detection, keyboard and responsive themes", async ({
  page,
}, testInfo) => {
  const retiredGrants: string[] = [];
  let detections = 0;
  await page.route("**/v1/code-agents**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/grants")) {
      retiredGrants.push(path);
      await route.abort();
    } else {
      if (path.endsWith("/detect")) {
        expect(route.request().method()).toBe("POST");
        detections++;
      }
      await route.fulfill({
        json: {
          items: [
            {
              id: "codex",
              name: "Codex",
              executable: "/fixture/bin/codex",
              version: "0.163.0",
              enabled: true,
              available: true,
              status: "ready",
              message: "已连接",
              models: [],
            },
            {
              id: "claude-code",
              name: "Claude Code",
              executable: "",
              version: "",
              enabled: false,
              available: false,
              status: "disabled",
              message: "部署尚未启用此 Agent",
              models: [],
            },
            ...[
              ["opencode", "OpenCode"],
              ["dsh", "DeepSeek Harness"],
              ["pi", "Pi"],
            ].map(([id, name]) => ({
              id,
              name,
              executable: "",
              version: "",
              enabled: false,
              available: false,
              status: "disabled",
              message: "部署尚未启用此 Agent",
              models: [],
            })),
          ],
        },
      });
    }
  });
  await page.goto("/code-agents");
  await expect(
    page.getByRole("heading", { name: "模型与智能体", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "本机编程智能体" }),
  ).toBeVisible();
  const models = page.getByRole("tab", { name: "模型服务", exact: true });
  const agents = page.getByRole("tab", { name: "编程智能体", exact: true });
  await agents.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page).toHaveURL(/\/model-service$/);
  await expect(models).toHaveAttribute("aria-selected", "true");
  await expect(models).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/code-agents$/);
  await expect(agents).toHaveAttribute("aria-selected", "true");
  await expect(agents).toBeFocused();
  await page.goBack();
  await expect(models).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(agents).toHaveAttribute("aria-selected", "true");
  expect(detections).toBe(0);
  await page
    .getByRole("button", { name: "OpenCode 未启用", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: "OpenCode 连接" }),
  ).toBeVisible();
  await expect(
    page.getByText("opencode auth login", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Codex 已连接", exact: true }).click();
  await expect(page.getByRole("article", { name: "Codex 连接" })).toBeVisible();
  await expect(page.getByLabel("授权账号")).toHaveCount(0);
  await page.getByRole("button", { name: "重新检测", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => detections).toBe(1);
  for (const theme of ["light", "dark"]) {
    for (const width of [390, 768, 1280, 1600]) {
      await page.setViewportSize({ width, height: 1000 });
      await setResponsiveTheme(page, theme);
      await expect(
        page.getByRole("heading", { name: "模型与智能体", exact: true }),
      ).toBeVisible();
      const overflowing = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(overflowing).toBe(false);
      const command = page.locator(".code-agent-commands code");
      const commandBox = await command.boundingBox();
      expect(commandBox!.height).toBeLessThan(24);
      expect(
        await command.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`code-agents-${theme}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
  await page.getByRole("button", { name: "展开配置", exact: true }).click();
  await expect(page.getByText(/在网站账号设置中创建 API 密钥/)).toBeVisible();
  expect(retiredGrants).toEqual([]);
  await expect(
    page.getByRole("button", { name: "复制 codex MCP 配置" }),
  ).toBeVisible();
});
