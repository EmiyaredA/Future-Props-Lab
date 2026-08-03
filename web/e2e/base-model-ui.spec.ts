import { expect, test } from "@playwright/test";

test("sidebar and custom select chevrons stay centered", async ({ page }) => {
  await page.goto("/model-call-logs");
  await expect(
    page.getByRole("heading", { name: "模型调用日志" }),
  ).toBeVisible();
  await expect(page.locator(".studio-sidebar")).toHaveCSS("width", "220px");
  await expect(page.locator("select")).toHaveCount(0);

  const offsets = await page.locator(".select-chevron").evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const parent = node.parentElement?.getBoundingClientRect();
      return parent
        ? rect.top + rect.height / 2 - (parent.top + parent.height / 2)
        : 99;
    }),
  );
  expect(offsets.length).toBeGreaterThan(3);
  expect(offsets.every((offset) => Math.abs(offset) < 0.6)).toBe(true);

  const navOffset = await page.locator(".nav-chevron").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const parent = node.parentElement?.getBoundingClientRect();
    return parent
      ? rect.top + rect.height / 2 - (parent.top + parent.height / 2)
      : 99;
  });
  expect(Math.abs(navOffset)).toBeLessThan(0.6);
});

test("model test workspace keeps panels readable on desktop and narrow screens", async ({
  page,
}) => {
  const conversation = {
    id: "conversation-e2e",
    title: "效果测试",
    model_id: "model-e2e",
    model_slug: "demo-chat",
    revision: 1,
    created_at: "2026-08-03T00:00:00Z",
    updated_at: "2026-08-03T00:00:00Z",
    system_prompt: "",
    temperature: 0.7,
    max_tokens: 1024,
    messages: [
      {
        id: "message-e2e",
        turn_id: "turn-e2e",
        role: "assistant",
        content: "调用示例\n\n```bash\ncurl https://example.test/v1\n```",
        model_slug: "demo-chat",
        status: "completed",
        error_message: null,
        created_at: "2026-08-03T00:00:00Z",
      },
    ],
  };
  await page.route("**/v1/model-providers", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        revision: 1,
        providers: [
          {
            id: "provider-e2e",
            name: "测试供应商",
            kind: "openai",
            base_url: "",
            enabled: true,
            has_api_key: false,
            api_key_hint: "",
            models: [
              {
                id: "model-e2e",
                provider_id: "provider-e2e",
                slug: "demo-chat",
                label: "Demo Chat",
                description: "",
                capabilities: ["chat"],
                enabled: true,
              },
            ],
          },
        ],
      }),
    });
  });
  await page.route("**/v1/model-test/conversations", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items: [conversation] }),
    });
  });
  await page.route(
    "**/v1/model-test/conversations/conversation-e2e",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(conversation),
      });
    },
  );

  await page.goto("/model-test");
  await expect(
    page.getByRole("heading", { name: "模型测试", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "测试模型" })).toContainText(
    "Demo Chat",
  );
  await expect(page.locator("select")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "复制原始输出" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "复制代码" })).toBeVisible();
  await expect(page.locator("code.hljs")).toBeVisible();

  await page.goto("/model-service");
  await expect(page.locator(".model-table-head")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "编辑 Demo Chat" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "删除 Demo Chat" }),
  ).toBeVisible();
  await page.goto("/model-test");

  await page.setViewportSize({ width: 900, height: 760 });
  await expect(
    page.getByRole("button", { name: "对话", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "对话", exact: true }).click();
  await expect(page.locator(".conversation-panel")).toHaveClass(/mobile-open/);
  await page
    .locator(".conversation-panel")
    .getByRole("button", { name: "收起" })
    .click();
  await page.getByRole("button", { name: "参数", exact: true }).click();
  await expect(page.locator(".settings-panel")).toHaveClass(/mobile-open/);
  await page.getByRole("button", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
