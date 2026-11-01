import { expect, test } from "@playwright/test";
import { captureResponsive as capture } from "./responsive-capture";

test("icon rail keeps base-model flyout reachable on narrow screens", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/home");
  const rail = page.getByRole("navigation", { name: "栏目导航", exact: true });
  await expect(rail).toBeVisible();
  await expect(
    page.getByRole("button", { name: "打开主导航", exact: true }),
  ).toHaveCount(0);
  await rail.getByRole("button", { name: "AI 能力，点击展开菜单" }).click();
  const menu = page.getByRole("menu", { name: "AI 能力", exact: true });
  await expect(menu).toBeVisible();
  await capture(page, info, "base-model-flyout");
  await menu.getByRole("menuitem", { name: "模型服务" }).click();
  await expect(page).toHaveURL(/\/model-service$/);
  await expect(menu).toBeHidden();
  await page.getByRole("button", { name: "账号菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "账号设置", exact: true }).click();
  const account = page.getByRole("dialog", { name: "账号设置", exact: true });
  await expect(account).toBeVisible();
  for (const label of ["个人资料", "密码与会话", "API 密钥"]) {
    await account.getByRole("button", { name: label, exact: true }).click();
    await capture(page, info, `account-${label}`);
  }
  await page.keyboard.press("Escape");
  await expect(account).toBeHidden();
});

test("login tolerates long content", async ({ page }, info) => {
  test.setTimeout(180000);
  await page.context().clearCookies();
  await page.goto("/home");
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  await capture(page, info, "login");
});

test("model capabilities keep controls reachable at compact sizes", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await page.route("**/v1/model-providers", (route) =>
    route.fulfill({
      json: {
        revision: 1,
        providers: [
          ["openai", "chat"],
          ["senseaudio_image", "image_generation"],
          ["senseaudio_video", "video_generation"],
          ["senseaudio_asr", "speech_recognition"],
          ["senseaudio_realtime", "voice"],
        ].map(([kind, capability]) => ({
          id: kind,
          name: `测试 ${kind}`,
          kind,
          base_url: "",
          enabled: true,
          has_api_key: false,
          api_key_hint: "",
          models: [
            {
              id: `responsive-${kind}`,
              provider_id: kind,
              slug: `responsive-${kind}`,
              label: `适配检查 · ${capability}`,
              description: "",
              capabilities: [capability],
              categories: [],
              enabled: true,
            },
          ],
        })),
      },
    }),
  );
  await page.route("**/v1/model-test/conversations", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.goto("/model-test");
  await expect(page.getByRole("tab", { name: "文本对话" })).toBeVisible();
  for (const label of [
    "文本对话",
    "图像生成",
    "视频生成",
    "语音识别",
    "实时语音",
  ]) {
    const tab = page.getByRole("button", { name: label, exact: true });
    await expect(tab).toBeEnabled();
    await tab.click();
    await capture(page, info, `model-${label}`);
    const compactTabs = page.locator(".compact-panel-tabs button");
    const count = await compactTabs.count();
    for (let index = 0; index < count; index++) {
      await page.setViewportSize({ width: 390, height: 844 });
      await compactTabs.nth(index).click();
      await capture(page, info, `model-${label}-panel-${index}`);
    }
  }
});
