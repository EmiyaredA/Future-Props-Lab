import { test, expect } from "@playwright/test";
test("shows recovery UI if the application module cannot load", async ({
  page,
}) => {
  await page.route("**/src/app/main.tsx*", (route) => route.abort());
  await page.goto("/apps/live2d-workshop");
  await expect(
    page.getByRole("heading", { name: "页面资源加载失败" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "重新加载" })).toBeVisible();
});
