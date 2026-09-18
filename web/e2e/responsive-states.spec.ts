import { expect, test } from "@playwright/test";
import { captureResponsive } from "./responsive-capture";

const remotePages = [
  "/files",
  "/integrations/tool-apis",
  "/integrations/mcp",
  "/integrations/skills",
  "/apps/audio-annotation",
  "/model-service",
  "/model-call-logs",
  "/model-test-tools",
  "/apps/thought-workshop",
  "/apps/visual-workshop",
  "/apps/visual-workshop/tasks",
  "/apps/galgame-workshop",
  "/apps/video-editor",
  "/apps/video-editor/tasks",
];
for (const path of remotePages) {
  test(`loading and failed request layout: ${path}`, async ({ page }, info) => {
    test.setTimeout(90000);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/v1/**", async (route) => {
      if (
        route.request().method() !== "GET" ||
        route.request().url().includes("/auth/")
      )
        return route.continue();
      await pending;
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        json: {
          title: "服务暂不可用",
          detail: "这是一段用于检查错误提示自动换行的隔离测试信息。".repeat(8),
          status: 503,
        },
      });
    });
    await page.goto(path);
    await expect(page.locator("main").first()).toBeVisible();
    try {
      await captureResponsive(page, info, "loading");
    } finally {
      release();
    }
    await expect(
      page.getByText(/失败|不可用|错误|加载.*出错|暂时无法/).first(),
    ).toBeVisible({ timeout: 20000 });
    await captureResponsive(page, info, "error-long");
  });
}
