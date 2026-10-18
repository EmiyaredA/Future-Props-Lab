import { expect, test, type Page } from "@playwright/test";
import {
  newDeck,
  newElement,
} from "../src/features/presentation-workshop/templates";

async function create(page: Page, locked = false) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const document = newDeck("blank");
  const label = newElement("text", {
    id: "label",
    x: 350,
    y: 200,
    width: 200,
    height: 80,
  });
  label.paragraphs[0].runs[0].text = "组内文字";
  document.slides[0].elements = [
    newElement("rect", {
      id: "a",
      x: 100,
      y: 200,
      width: 180,
      height: 100,
      locked,
    }),
    label,
    newElement("rect", { id: "b", x: 700, y: 200, width: 180, height: 100 }),
    newElement("rect", {
      id: "outside",
      x: 1050,
      y: 500,
      width: 100,
      height: 80,
    }),
  ];
  document.slides[0].groups = [
    { id: "root", name: "外层组合", parent_id: null, element_ids: ["b"] },
    {
      id: "child",
      name: "内部节点",
      parent_id: "root",
      element_ids: ["a", "label"],
    },
  ];
  const created = await page.request.post(
    "/v1/presentation-workshop/projects",
    { headers, data: { title: "组合逐层选择", document } },
  );
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
  await expect(object(page, "a")).toBeVisible();
  return { project, headers, document };
}
const object = (page: Page, id: string) =>
  page.locator(`.presentation-canvas [data-element-id="${id}"]`);
const scope = (page: Page) =>
  page.getByRole("group", { name: "组内编辑", exact: true });
const toolbar = (page: Page) =>
  page.getByRole("toolbar", { name: "所选元素工具栏" });
const tap = (page: Page, id: string) =>
  object(page, id).click({ position: { x: 35, y: 35 } });
async function drag(
  page: Page,
  target = object(page, "a"),
  dx = 36,
  dy = 22,
  cancel = false,
) {
  const box = (await target.boundingBox())!;
  const x = box.x + Math.min(35, box.width / 2),
    y = box.y + Math.min(35, box.height / 2);
  await page.keyboard.down("Alt");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.keyboard.up("Alt");
}

test("连续点击逐层选择、文字编辑、返回与保存重开", async ({ page }, info) => {
  const { project, document } = await create(page);
  await object(page, "label").dblclick({ position: { x: 35, y: 35 } });
  await expect(scope(page)).toContainText("外层组合");
  await expect(toolbar(page)).toContainText("2 个元素");
  await expect(
    page.getByRole("textbox", { name: "编辑幻灯片文字" }),
  ).toHaveCount(0);
  await tap(page, "label");
  await expect(scope(page)).toContainText("内部节点");
  await expect(toolbar(page).getByLabel("字体", { exact: true })).toBeVisible();
  await object(page, "label").dblclick({ position: { x: 35, y: 35 } });
  const editor = page.getByRole("textbox", { name: "编辑幻灯片文字" });
  await expect(editor).toBeVisible();
  await editor.fill("只修改组内文字");
  await editor.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(scope(page)).toContainText("内部节点");
  await page.keyboard.press("Escape");
  await expect(scope(page)).toContainText("外层组合");
  await expect(toolbar(page)).toContainText("2 个元素");
  await scope(page).getByRole("button", { name: "退出分组" }).click();
  await expect(scope(page)).toHaveCount(0);
  await expect(toolbar(page)).toContainText("3 个元素");
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  const saved = await (
    await page.request.get(`/v1/presentation-workshop/projects/${project.id}`)
  ).json();
  expect(saved.document.slides[0].groups).toEqual(document.slides[0].groups);
  for (const id of ["a", "b", "outside"]) {
    expect(
      saved.document.slides[0].elements.find(
        (e: { id: string }) => e.id === id,
      ),
    ).toEqual(document.slides[0].elements.find((e) => e.id === id));
  }
  await page.reload();
  await expect(object(page, "label")).toContainText("只修改组内文字");
  await expect(scope(page)).toHaveCount(0);
  await tap(page, "a");
  await expect(toolbar(page)).toContainText("3 个元素");
  await tap(page, "a");
  await tap(page, "a");
  await page.screenshot({ path: info.outputPath("group-member-selected.png") });
  await tap(page, "label");
  await object(page, "label").dblclick({ position: { x: 35, y: 35 } });
  await expect(editor).toBeVisible();
  await scope(page).getByRole("button", { name: "退出分组" }).click();
  await expect(editor).toHaveCount(0);
  await expect(scope(page)).toContainText("外层组合");
  await expect(toolbar(page)).toContainText("2 个元素");
  await tap(page, "outside");
  await expect(scope(page)).toHaveCount(0);
});

test("整组与成员拖动、手柄、取消和修饰键不误入分组", async ({ page }) => {
  await create(page);
  await tap(page, "a");
  const before = (await object(page, "a").boundingBox())!;
  const bBefore = (await object(page, "b").boundingBox())!;
  await drag(page, object(page, "a"), 36, 22, true);
  await expect(scope(page)).toHaveCount(0);
  expect((await object(page, "a").boundingBox())!.x).toBeCloseTo(before.x, 0);
  await drag(page);
  await expect(scope(page)).toHaveCount(0);
  expect((await object(page, "a").boundingBox())!.x - before.x).toBeCloseTo(
    36,
    0,
  );
  expect((await object(page, "b").boundingBox())!.x - bBefore.x).toBeCloseTo(
    36,
    0,
  );
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await drag(
    page,
    page.locator('.presentation-selection [data-resize="se"]'),
    20,
    10,
  );
  await expect(scope(page)).toHaveCount(0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await tap(page, "a");
  await tap(page, "a");
  await expect(scope(page)).toContainText("内部节点");
  await drag(page);
  expect((await object(page, "b").boundingBox())!.x).toBeCloseTo(bBefore.x, 0);
  await tap(page, "label");
  await expect(toolbar(page).getByLabel("字体", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await object(page, "a").click({
    position: { x: 35, y: 35 },
    modifiers: ["Shift"],
  });
  await expect(scope(page)).toHaveCount(0);
  await expect(toolbar(page)).toHaveCount(0);
});

test("锁定组合可下钻选择但不能拖动，移动端及暗色主题显示退出入口", async ({
  page,
}, info) => {
  await create(page, true);
  const before = (await object(page, "a").boundingBox())!;
  await tap(page, "a");
  await drag(page);
  expect((await object(page, "a").boundingBox())!.x).toBeCloseTo(before.x, 0);
  await tap(page, "a");
  await tap(page, "a");
  await expect(
    toolbar(page).getByRole("button", { name: "解锁元素" }),
  ).toBeVisible();
  await drag(page);
  expect((await object(page, "a").boundingBox())!.x).toBeCloseTo(before.x, 0);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({ path: info.outputPath("group-scope-dark.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(scope(page)).toBeVisible();
  await expect(
    scope(page).getByRole("button", { name: "退出分组" }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("group-scope-mobile.png") });
  await scope(page).getByRole("button", { name: "退出分组" }).focus();
  await page.keyboard.press("Enter");
  await expect(scope(page)).toContainText("外层组合");
});
