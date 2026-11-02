import { expect, test } from "@playwright/test";

test("cloud control is the administrator entry for the independent workbench", async ({
  page,
}) => {
  await page.goto("/apps");
  await expect(
    page.getByRole("button", { name: "打开Agent 工作台", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "云控", exact: true }).click();
  await expect(page).toHaveURL(/\/cloud-control$/);
  for (const width of [390, 768, 1280, 1616]) {
    await page.setViewportSize({ width, height: 973 });
    for (const theme of ["浅色", "深色"]) {
      await page.getByRole("button", { name: theme, exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "云控", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page
        .getByRole("button", { name: "打开Agent 工作台", exact: true })
        .focus();
      await expect(
        page.getByRole("button", { name: "打开Agent 工作台", exact: true }),
      ).toBeFocused();
    }
  }
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/agents$/);
  await expect(
    page.getByRole("region", { name: "Agent 工作台" }),
  ).toBeVisible();
});

test("ordinary accounts cannot mount cloud control or workbench requests", async ({
  page,
}) => {
  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const me = await response.json();
    me.user.platform_role = "user";
    me.user.is_platform_admin = false;
    me.permission_keys = me.permission_keys.filter(
      (key: string) => key !== "cloud-control.access",
    );
    await route.fulfill({ response, json: me });
  });
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/v1/agent-workbench/"))
      requests.push(request.url());
  });
  for (const path of [
    "/cloud-control",
    "/agents",
    "/agents/sources",
    "/agents/sessions/private",
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "云控仅限管理员访问" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "云控", exact: true }),
    ).toHaveCount(0);
  }
  expect(requests).toEqual([]);
});

test("retired host tools are absent even with old favorites and usage", async ({
  page,
}) => {
  await page.route("**/v1/tool-navigation/state", (route) =>
    route.fulfill({
      json: {
        items: ["storage-usage", "codex-model-source"].map((tool_id) => ({
          tool_id,
          is_favorite: true,
          last_used_at: "2026-11-03T00:00:00Z",
          favorite_updated_at: "2026-11-03T00:00:00Z",
          use_count: 4,
        })),
      },
    }),
  );
  for (const path of [
    "/tools",
    "/tools/storage-usage",
    "/tools/codex-model-source",
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "工具导航", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("空间占用", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Codex 模型源", { exact: true })).toHaveCount(
      0,
    );
  }
});
