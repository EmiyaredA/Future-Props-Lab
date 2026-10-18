import { expect, test } from "@playwright/test";
import {
  newDeck,
  newElement,
} from "../src/features/presentation-workshop/templates";

test("代码高亮预览、取消、撤销、保存重开与导出", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const document = newDeck("blank");
  const code = newElement("text", { x: 100, y: 120, width: 1000, height: 450 });
  const source =
    '{\n  "status": "claimed",\n\n  "count": 3,\n  "active": true\n}';
  code.paragraphs[0].runs[0] = {
    ...code.paragraphs[0].runs[0],
    text: source,
    font: "Consolas",
    size: 28,
  };
  document.slides[0].elements = [code];
  const created = await page.request.post(
    "/v1/presentation-workshop/projects",
    { headers, data: { title: "可编辑代码高亮", document } },
  );
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
  const target = page.locator(
    `.presentation-canvas [data-element-id="${code.id}"]`,
  );
  await target.click({ position: { x: 35, y: 35 } });
  const open = page.getByRole("button", { name: "代码高亮", exact: true });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "代码高亮", exact: true });
  await expect(dialog.getByLabel("代码高亮预览")).toContainText('"status"');
  await page.screenshot({
    path: info.outputPath("code-highlight-preview.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 960 });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(open).toBeFocused();
  await open.click();
  await dialog.getByRole("button", { name: "应用高亮", exact: true }).click();
  await expect(target.locator("span", { hasText: '"status"' })).toHaveCSS(
    "color",
    "rgb(22, 94, 171)",
  );
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(target.locator("p")).toHaveCount(1);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(target.locator("p")).toHaveCount(6);
  await page.getByRole("button", { name: "保存文稿" }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  await page.reload();
  await expect(target.locator("p")).toHaveCount(6);
  await page.screenshot({ path: info.outputPath("code-highlight-saved.png") });
  const saved = await (
    await page.request.get(`/v1/presentation-workshop/projects/${project.id}`)
  ).json();
  const actual = saved.document.slides[0].elements[0];
  expect(
    actual.paragraphs
      .map((p: { runs: { text: string }[] }) =>
        p.runs.map((r) => r.text).join(""),
      )
      .join("\n"),
  ).toBe(source);
  expect({ ...actual, paragraphs: code.paragraphs }).toEqual(code);
  await page.getByRole("button", { name: "代码块", exact: true }).click();
  const insertDialog = page.getByRole("dialog", {
    name: "插入代码块",
    exact: true,
  });
  await insertDialog.getByRole("combobox", { name: "高亮配色" }).click();
  await page.getByRole("option", { name: "适合深色背景" }).click();
  await insertDialog
    .getByRole("textbox", { name: "代码内容" })
    .fill('{\n  "message": "整块可编辑"\n}');
  await insertDialog
    .getByRole("button", { name: "插入代码块", exact: true })
    .click();
  await expect(
    page.locator(".presentation-canvas [data-element-id]"),
  ).toHaveCount(5);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(
    page.locator(".presentation-canvas [data-element-id]"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(
    page.locator(".presentation-canvas [data-element-id]"),
  ).toHaveCount(5);
  await page.getByRole("button", { name: "保存文稿" }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  const withBlock = await (
    await page.request.get(`/v1/presentation-workshop/projects/${project.id}`)
  ).json();
  expect(withBlock.document.slides[0].groups[0].name).toBe("代码块 · JSON");
  expect(withBlock.document.slides[0].groups[0].element_ids).toHaveLength(4);
  await page.reload();
  await expect(
    page.locator(".presentation-canvas [data-element-id]"),
  ).toHaveCount(5);
  await page.screenshot({ path: info.outputPath("inserted-code-block.png") });
  const exported = await page.request.post(
    `/v1/presentation-workshop/projects/${project.id}/export`,
    { headers, data: { expected_revision: withBlock.revision } },
  );
  expect(exported.ok()).toBeTruthy();
});
