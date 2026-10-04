import { OFFICIAL_KNOWLEDGE_BASES } from "../src/features/thought-workshop/official/catalog";
import { expect, test } from "@playwright/test";
import { importAndPublish, legacyTarget } from "./official-import-helpers";

test("imported callouts, code and cross-library references use ordinary note rendering", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { publication } = await importAndPublish(page, "director-desk");
  const target = await legacyTarget(
    page,
    "director-desk",
    "delivery",
    publication.id,
  );
  await page.goto(
    `/apps/thought-workshop/community/${publication.id}/documents/${target.note_id}`,
  );
  await expect(page.locator(".thought-prose")).toContainText(
    "给拍摄团队看节奏与构图",
  );
  await expect(page.locator(".thought-prose")).not.toContainText("[!NOTE]");
  await expect(page.locator(".thought-callout").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "复制代码", exact: true }),
  ).toBeVisible();
  const links = page.locator(".thought-reference a[href*='/community/']");
  await expect(links.first()).toBeVisible();
  const href = await links.first().getAttribute("href");
  await links.first().click();
  await expect(page).toHaveURL(href!);
  await expect(page.locator(".community-note-title")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".thought-prose")).toContainText(
    "给拍摄团队看节奏与构图",
  );
});

test("all 93 imported source articles render as standard published notes without external services", async ({
  page,
}) => {
  test.setTimeout(240000);
  const { publications } = await importAndPublish(page, "general");
  await page.route("**/*", (route) =>
    ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
      ? route.fallback()
      : route.abort(),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let count = 0;
  for (const library of OFFICIAL_KNOWLEDGE_BASES) {
    const publication = publications.find((p) => p.title === library.title)!;
    for (const document of library.documents) {
      const target = await legacyTarget(
        page,
        library.id,
        document.id,
        publication.id,
      );
      await page.goto(
        `/apps/thought-workshop/community/${publication.id}/documents/${target.note_id}`,
      );
      await expect(
        page.getByRole("heading", { name: document.title, exact: true }),
      ).toBeVisible();
      await expect(page.locator(".thought-prose")).not.toBeEmpty();
      await expect(page.getByText("图表语法有误，请编辑源码")).toHaveCount(0);
      count++;
    }
  }
  expect(count).toBe(93);
  expect(errors).toEqual([]);
});
