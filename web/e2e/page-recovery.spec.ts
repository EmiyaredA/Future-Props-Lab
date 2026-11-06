import { test, expect } from "@playwright/test";
test("shows recovery UI if the application module cannot load", async ({
  page,
}) => {
  await page.route("**/src/studio/assembly/website/application.tsx*", (route) => route.abort());
  await page.goto("/apps/agent-workbench");
  await expect(
    page.getByRole("heading", { name: "页面资源加载失败" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "重新加载" })).toBeVisible();
});
