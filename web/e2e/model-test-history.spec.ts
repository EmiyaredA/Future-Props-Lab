import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

async function mockHistory(page: Page) {
  const first = {
    id: "history-current",
    title: "当前模型测试",
    model_id: null,
    model_slug: "",
    revision: 2,
    created_at: "2026-10-08T00:00:00Z",
    updated_at: "2026-10-08T00:00:00Z",
    system_prompt: "",
    temperature: 0.7,
    max_tokens: 1024,
    messages: [],
  };
  let items = [
    first,
    { ...first, id: "history-older", title: "上一次字幕测试", revision: 5 },
  ];
  const deletions: string[] = [];
  await page.route("**/v1/model-providers", (route) =>
    route.fulfill({ json: { revision: 1, providers: [] } }),
  );
  await page.route("**/v1/model-test/conversations**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "DELETE") {
      const id = url.pathname.split("/").at(-1)!;
      const target = items.find((item) => item.id === id)!;
      expect(url.searchParams.get("expected_revision")).toBe(
        String(target.revision),
      );
      deletions.push(id);
      items = items.filter((item) => item.id !== id);
      await route.fulfill({ json: { deleted: true } });
    } else {
      await route.fulfill({
        json: url.pathname.endsWith("/conversations")
          ? { items }
          : items.find((item) => url.pathname.endsWith(item.id)),
      });
    }
  });
  return deletions;
}

test("model history reveals deletion on hover and keyboard focus without selecting the target", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const deletions = await mockHistory(page);
  await page.goto("/model-test");
  const activeTitle = page.getByRole("textbox", { name: "对话标题" });
  await expect(activeTitle).toHaveValue("当前模型测试");
  const draft = page.getByPlaceholder("输入要测试的问题");
  await draft.fill("保留当前输入草稿");
  const trigger = page.getByRole("button", {
    name: "删除对话「上一次字幕测试」",
  });
  const row = page.locator(".conversation-row").filter({ has: trigger });
  const output = resolve("../.local/model-history");
  await mkdir(output, { recursive: true });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await activeTitle.focus();
    await page.getByRole("heading", { name: "模型测试", exact: true }).hover();
    await expect(trigger).toHaveCSS("opacity", "0");
    await expect(trigger).toHaveCSS("pointer-events", "none");
    const restingBounds = await row.boundingBox();
    if (theme === "light")
      await page.screenshot({ path: resolve(output, "history-rest.png") });
    await row.hover();
    await expect(trigger).toHaveCSS("opacity", "1");
    await expect(trigger).toHaveCSS("pointer-events", "auto");
    expect(await row.boundingBox()).toEqual(restingBounds);
    if (theme === "light")
      await page.screenshot({ path: resolve(output, "history-hover.png") });
    await page.getByRole("heading", { name: "模型测试", exact: true }).hover();
    await expect(trigger).toHaveCSS("opacity", "0");
    await row.locator(".conversation-select").focus();
    await expect(trigger).toHaveCSS("opacity", "1");
    await page.keyboard.press("Tab");
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toContainText("上一次字幕测试");
    await expect(activeTitle).toHaveValue("当前模型测试");
    expect(deletions).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  await row.hover();
  await trigger.click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "删除对话", exact: true })
    .click();
  await expect(trigger).toHaveCount(0);
  expect(deletions).toEqual(["history-older"]);
  await expect(activeTitle).toHaveValue("当前模型测试");
  await expect(draft).toHaveValue("保留当前输入草稿");
});

test.describe("touch model history", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("keeps deletion visible and tappable without hovering", async ({
    page,
  }) => {
    const deletions = await mockHistory(page);
    await page.goto("/model-test");
    await page.getByRole("button", { name: "对话", exact: true }).tap();
    const trigger = page.getByRole("button", {
      name: "删除对话「上一次字幕测试」",
    });
    await expect(trigger).toHaveCSS("opacity", "1");
    await expect(trigger).toHaveCSS("pointer-events", "auto");
    await trigger.tap();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toContainText("上一次字幕测试");
    await confirmation.getByRole("button", { name: "取消" }).tap();
    await expect(confirmation).toHaveCount(0);
    expect(deletions).toEqual([]);
  });
});
