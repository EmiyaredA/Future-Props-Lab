import { expect, test } from "@playwright/test";

test("retired workbench links open Amadeus without a session ID", async ({
  page,
}) => {
  await page.goto("/cloud-control");
  await expect(
    page.getByRole("heading", { name: "云控", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  for (const path of [
    "/agents",
    "/cloud-control?view=agent",
    "/agents/sources",
    "/apps/agent-workbench/sessions/private",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/amadeus$/);
    await expect(
      page.getByRole("region", { name: "Amadeus", exact: true }),
    ).toBeVisible();
  }
});
