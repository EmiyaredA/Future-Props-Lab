import { expect, test } from "@playwright/test";
import { captureResponsive as capture } from "./responsive-capture";

test("single navigation drawer, account tabs, and focus restoration", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/home");
  const trigger = page.getByRole("button", { name: "打开主导航", exact: true });
  await trigger.click();
  const nav = page.getByRole("dialog", { name: "主导航", exact: true });
  await expect(nav).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await nav.locator(".sidebar-session-card.account").click();
  const account = page.getByRole("dialog", { name: "账号中心" });
  await expect(account).toBeVisible();
  for (const label of ["资料", "安全与密钥", "账号治理"]) {
    await account.getByRole("tab", { name: label, exact: true }).click();
    await capture(page, info, `account-${label}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press("Escape");
  await expect(account).toBeHidden();
  await trigger.click();
  await nav.locator(".sidebar-session-card").first().click();
  const workspace = page.getByRole("dialog", { name: "Workspace 管理" });
  for (const label of ["空间", "成员与邀请"]) {
    await workspace.getByRole("tab", { name: label, exact: true }).click();
    await capture(page, info, `workspace-${label}`);
  }
});

test("login and public showcase tolerate long content", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const me = await response.json();
    me.workspace.access_kind = "public_viewer";
    me.workspace.name =
      "一个用于检查中文与 LongUnbrokenWorkspaceTitleWithoutSpaces 的公开作品空间";
    await route.fulfill({ response, json: me });
  });
  await page.route("**/v1/public-workspace", (route) =>
    route.fulfill({
      json: {
        workspace_name: "作品展示 · 持续创作的长标题空间",
        visual_projects: [],
        galgame_projects: [],
      },
    }),
  );
  await page.goto("/home");
  await expect(page.locator(".public-showcase-shell")).toBeVisible();
  await capture(page, info, "public-showcase");
  await page.unrouteAll({ behavior: "wait" });
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
    "图片生成",
    "视频生成",
    "语音识别",
    "实时语音",
  ]) {
    const tab = page.getByRole("tab", { name: label, exact: true });
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
