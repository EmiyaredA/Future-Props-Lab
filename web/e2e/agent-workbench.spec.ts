import { expect, test } from "@playwright/test";

test("retired workbench links open the Happier pane without a session ID", async ({
  page,
}) => {
  await page.goto("/cloud-control");
  await expect(
    page.getByRole("heading", { name: "云控", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  for (const path of [
    "/agents",
    "/agents/sources",
    "/apps/agent-workbench/sessions/private",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/cloud-control\?view=agent$/);
    await expect(
      page.getByRole("region", { name: "Agent 工作台" }),
    ).toBeVisible();
  }
});
