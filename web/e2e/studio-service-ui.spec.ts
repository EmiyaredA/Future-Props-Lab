import { expect, test } from "@playwright/test";
import {
  mountIndependentPrograms,
  restoredStudioPages,
} from "./studio-service-fixtures";

for (const [path, service, title] of restoredStudioPages) {
  test(`旧版 Studio 布局对照 ${service}`, async ({ page, baseURL }, info) => {
    test.setTimeout(90_000);
    const heading = page.getByRole("heading", { name: title, exact: true });
    await page.goto(path);
    await expect(heading).toBeVisible({ timeout: 20_000 });
    const before = new Map<string, { x: number; width: number }>();
    for (const version of ["website", "independent"]) {
      if (version === "independent") {
        await mountIndependentPrograms(page, baseURL!);
        await page.reload();
      }
      await expect(page.locator(".studio-main")).toContainText(title);
      await expect(page.locator(".studio-global-header")).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: "打开 Amadeus" }),
      ).toBeVisible();
      for (const width of [390, 768, 1470]) {
        await page.setViewportSize({ width, height: 900 });
        for (const [label, theme] of [
          ["浅色", "light"],
          ["深色", "dark"],
        ]) {
          await page.getByRole("button", { name: label, exact: true }).click();
          await expect(page.locator("html")).toHaveAttribute(
            "data-theme",
            theme,
          );
          const main = page.locator(".studio-main");
          const box = (await main.boundingBox())!;
          const key = `${width}-${theme}`;
          if (version === "website")
            before.set(key, { x: box.x, width: box.width });
          else {
            expect(box.x).toBeCloseTo(before.get(key)!.x, 0);
            expect(box.width).toBeCloseTo(before.get(key)!.width, 0);
          }
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(width);
          await expect(heading).toBeVisible();
          await page.screenshot({
            path: info.outputPath(`${version}-${key}.png`),
          });
        }
      }
    }
  });
}

test("独立工具返回、集成标签深链接和未保存保护", async ({ page, baseURL }) => {
  await mountIndependentPrograms(page, baseURL!);
  await page.goto("/tools/video-frame-exporter");
  await page.getByRole("button", { name: "返回工具导航" }).click();
  await expect(page).toHaveURL(/\/tools$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "视频帧导出" })).toBeVisible();
  await page.goto("/integrations/tool-apis");
  const tabs = page.getByRole("tablist", { name: "集成类型" });
  await tabs.getByRole("tab", { name: "MCP", exact: true }).click();
  await expect(page).toHaveURL(/\/integrations\/mcp$/);
  await expect(
    tabs.getByRole("tab", { name: "MCP", selected: true }),
  ).toBeVisible();
  await page.goBack();
  await page.getByRole("button", { name: "新建工具 API" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("名称", { exact: true })
    .fill("未保存工具");
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      return !window.dispatchEvent(event);
    }),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeVisible();
});

test("独立 AI 能力保持跨页键盘焦点和侧栏入口", async ({ page, baseURL }) => {
  await mountIndependentPrograms(page, baseURL!);
  await page.setViewportSize({ width: 1470, height: 900 });
  await page.goto("/model-service");
  const tabs = page.getByRole("tablist", { name: "模型与智能体视图" });
  const catalog = tabs.getByRole("tab", { name: "模型服务" });
  await catalog.press("ArrowRight");
  await expect(page).toHaveURL(/\/code-agents$/);
  const agents = tabs.getByRole("tab", { name: "编程智能体" });
  await expect(agents).toBeFocused();
  await agents.press("ArrowLeft");
  await expect(page).toHaveURL(/\/model-service$/);
  await expect(catalog).toBeFocused();
  await expect(
    page.getByRole("navigation", { name: "模型服务页面" }),
  ).toHaveCount(0);
  const sidebar = page.getByRole("navigation", { name: "AI 能力子菜单" });
  await sidebar.getByRole("button", { name: "模型测试", exact: true }).click();
  await expect(page).toHaveURL(/\/model-test$/);
  await sidebar.getByRole("button", { name: "模型调用日志" }).click();
  await expect(page).toHaveURL(/\/model-call-logs$/);
});

test("独立创意工坊保护编辑草稿并保留浏览器返回", async ({ page, baseURL }) => {
  await mountIndependentPrograms(page, baseURL!);
  await page.goto("/creative-workshop");
  await page.getByRole("button", { name: "＋ 发布创作" }).click();
  await page.locator(".creative-kind-card").first().click();
  await expect(page).toHaveURL(/\/creative-workshop\/edit\//);
  await page.getByLabel("名称", { exact: true }).fill("未保存创作");
  await page.getByRole("button", { name: "我的创作", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "草稿尚未保存" });
  await dialog.getByRole("button", { name: "留在此页" }).click();
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue(
    "未保存创作",
  );
  await page.getByRole("button", { name: "我的创作", exact: true }).click();
  await dialog.getByRole("button", { name: "放弃填写并继续" }).click();
  await expect(page).toHaveURL(/\/creative-workshop\/mine$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "编辑创作" })).toBeVisible();
});

test("独立入口按账号权限显示只读界面", async ({ page, baseURL }) => {
  await mountIndependentPrograms(page, baseURL!);
  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const account = await response.json();
    account.user.platform_role = "user";
    account.user.is_platform_admin = false;
    account.permission_keys = ["content.read"];
    await route.fulfill({ response, json: account });
  });
  await page.goto("/integrations/tool-apis");
  await expect(page.getByText(/当前为只读模式/)).toBeVisible();
  await expect(page.getByRole("button", { name: "新建工具 API" })).toHaveCount(
    0,
  );
  await page.goto("/creative-workshop");
  await expect(page.getByRole("heading", { name: "创意工坊" })).toBeVisible();
  await expect(page.getByRole("button", { name: "＋ 发布创作" })).toHaveCount(
    0,
  );
  await page.goto("/model-call-logs");
  await expect(page.getByRole("alert")).toContainText("没有调用日志读取权限");
  await expect(page.getByRole("button", { name: "模型调用日志" })).toHaveCount(
    0,
  );
});
