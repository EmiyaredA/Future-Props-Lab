import { expect, test } from "@playwright/test";

test("knowledge creation dialogs own their styles on a cold route and stay inside the viewport", async ({
  page,
}, testInfo) => {
  await page.goto("/apps/thought-workshop");
  const opener = page.getByRole("button", { name: "创建知识库", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "创建知识库", exact: true });
  const backdrop = page.locator(".text-input-dialog-backdrop");
  const input = dialog.getByRole("textbox", {
    name: "名称或内容",
    exact: true,
  });
  await expect(backdrop).toHaveCSS("position", "fixed");
  await expect(input).toHaveCSS("border-radius", "8px");
  await expect(input).toBeFocused();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  const box = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
  expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(
    2,
  );
  await page.screenshot({
    path: testInfo.outputPath("notebook-dialog-light.png"),
  });
  await input.fill(`浏览器知识库 ${Date.now()}`);
  await input.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "关闭输入弹窗" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "确认", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await opener.click();
  await expect(dialog).toBeVisible();
  const mobileBox = (await dialog.boundingBox())!;
  expect(mobileBox.x).toBeGreaterThanOrEqual(16);
  expect(mobileBox.x + mobileBox.width).toBeLessThanOrEqual(374);
  expect(mobileBox.y + mobileBox.height).toBeLessThan(844);
  await input.fill("窄屏知识库");
  await page.screenshot({
    path: testInfo.outputPath("notebook-dialog-mobile-dark.png"),
  });
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/thought-workshop/knowledge-bases") &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  expect((await created).ok()).toBe(true);
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "窄屏知识库", exact: true }),
  ).toBeVisible();
});

test("a stalled notes request times out and can be retried after recovery", async ({
  page,
}) => {
  let recovered = false;
  await page.route("**/v1/thought-workshop/knowledge-bases?**", (route) => {
    if (recovered) return route.continue();
    // Leave the read request unanswered to reproduce a reloader holding its socket.
  });
  await page.goto("/apps/thought-workshop");
  await expect(
    page.getByText("正在加载知识库…", { exact: true }),
  ).toBeVisible();
  const error = page.getByRole("alert").filter({ hasText: "服务响应超时" });
  await expect(error).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByText("正在加载知识库…", { exact: true }),
  ).not.toBeVisible();
  recovered = true;
  const loaded = page.waitForResponse(
    (response) =>
      response.url().includes("/thought-workshop/knowledge-bases?") &&
      response.request().method() === "GET",
  );
  await error.getByRole("button", { name: "重试", exact: true }).click();
  expect((await loaded).ok()).toBe(true);
  await expect(error).not.toBeVisible();
  await expect(
    page.getByText("正在加载知识库…", { exact: true }),
  ).not.toBeVisible();
});
