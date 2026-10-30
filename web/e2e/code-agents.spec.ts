import { expect, test } from "@playwright/test";

test("Code Agents navigation, scoped grants, keyboard and responsive themes", async ({
  page,
}, testInfo) => {
  let revision = 0;
  let grants: Array<{ user_id: string; agent_id: string; purpose: string }> =
    [];
  let managed: string[] = [];
  let detections = 0;
  await page.route("**/v1/code-agents**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/grants")) {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        expect(body.expected_revision).toBe(revision);
        revision++;
        grants = body.grants;
        managed = body.managed;
      }
      await route.fulfill({
        json: {
          revision,
          grants,
          managed,
          legacy: [],
          accounts: [{ id: "fixture-user", name: "测试账号" }],
        },
      });
    } else {
      if (path.endsWith("/detect")) detections++;
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
  await expect(page.getByLabel("授权账号")).toBeVisible();
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
  await page.getByLabel("授权账号").focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Enter");
  const amadeus = page.getByRole("switch", {
    name: "测试账号 · Codex · Amadeus 授权",
    exact: true,
  });
  await amadeus.click();
  await expect(amadeus).toHaveAttribute("aria-checked", "true");
  await expect(amadeus).toBeEnabled();
  await amadeus.click();
  await expect(amadeus).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "重新检测", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => detections).toBe(1);
  for (const theme of ["light", "dark"]) {
    for (const width of [390, 768, 1280, 1600]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
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
      if (width >= 1280) {
        await expect
          .poll(async () => {
            const account = await page.getByLabel("授权账号").boundingBox();
            const config = await page
              .getByRole("button", { name: "展开配置", exact: true })
              .boundingBox();
            return Math.abs(
              account!.x + account!.width - config!.x - config!.width,
            );
          })
          .toBeLessThan(1);
      }
      await page.screenshot({
        path: testInfo.outputPath(`code-agents-${theme}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
  await page.getByRole("button", { name: "展开配置", exact: true }).click();
  await expect(page.getByText("需要桌面版", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "复制 codex MCP 配置" }),
  ).toBeVisible();
});
