import { expect, test, type Page } from "@playwright/test";
import {
  newDeck,
  newSlide,
  newElement,
} from "../src/features/presentation-workshop/templates";

async function open(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const document = newDeck();
  document.slides.push(newSlide("blank"));
  document.slides[1].elements.push(
    newElement("rect", { x: 100, y: 100, width: 200, height: 150 }),
  );
  const response = await page.request.post(
    "/v1/presentation-workshop/projects",
    {
      headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
      data: { title: "撤销测试", document },
    },
  );
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
  await expect(page.getByLabel("文稿名称", { exact: true })).toHaveValue(
    "撤销测试",
  );
}
async function save(page: Page) {
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
}

test("名称、备注、属性统一撤销重做，保存保留历史，重开清空历史", async ({
  page,
}) => {
  await open(page);
  const title = page.getByLabel("文稿名称", { exact: true });
  await title.fill("修改名称");
  await page.getByRole("button", { name: /演示者备注/ }).click();
  const notes = page.getByLabel("演示者备注", { exact: true });
  await notes.fill("第一页备注");
  await page.getByRole("button", { name: "幻灯片 2", exact: true }).click();
  await page.locator(".presentation-canvas [data-element-id]").click();
  const x = page.getByLabel("X", { exact: true });
  await x.fill("320");
  await save(page);
  await x.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(x).toHaveValue("100");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(
    page.getByRole("button", { name: "幻灯片 1", exact: true }),
  ).toHaveAttribute("aria-current", "true");
  await expect(notes).toHaveValue("");
  // The previous undo removed the focused property field; focus returns to the canvas.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(title).toHaveValue("撤销测试");
  await expect(
    page.getByRole("button", { name: "撤销", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(title).toHaveValue("修改名称");
  await page.keyboard.press("Control+y");
  await expect(notes).toHaveValue("第一页备注");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(x).toHaveValue("320");
  await save(page);
  await page.reload();
  await expect(title).toHaveValue("修改名称");
  await expect(
    page.getByRole("button", { name: "撤销", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "重做", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "幻灯片 2", exact: true }),
  ).toHaveAttribute("aria-current", "true");
  await page.getByRole("button", { name: "幻灯片 1", exact: true }).click();
  await page.getByRole("button", { name: /演示者备注/ }).click();
  await expect(notes).toHaveValue("第一页备注");
  await page.getByRole("button", { name: "幻灯片 2", exact: true }).click();
  await page.locator(".presentation-canvas [data-element-id]").click();
  await expect(x).toHaveValue("320");
});

test("富文本键盘撤销只执行一次，未提交的弹窗输入不穿透文稿", async ({
  page,
}) => {
  await open(page);
  const canvas = page.getByRole("group", { name: "幻灯片画布" });
  await canvas.getByText("让想法，被看见", { exact: true }).dblclick();
  const text = page.getByRole("textbox", { name: "编辑幻灯片文字" });
  await text.fill("新的文字");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(text).toHaveText("让想法，被看见");
  await expect(
    page.getByRole("button", { name: "撤销", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(text).toHaveText("新的文字");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "代码块", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("textbox").first();
  await input.fill("临时代码");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(canvas.getByText("新的文字", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(
    canvas.getByText("让想法，被看见", { exact: true }),
  ).toBeVisible();
});

test("文字快捷键复制粘贴追加内容，支持撤销重做并保存", async ({ page }) => {
  await open(page);
  const canvas = page.getByRole("group", { name: "幻灯片画布" });
  await canvas.getByText("让想法，被看见", { exact: true }).dblclick();
  const text = page.getByRole("textbox", { name: "编辑幻灯片文字" });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(text).toHaveText("让想法，被看见让想法，被看见");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(text).toHaveText("让想法，被看见");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(text).toHaveText("让想法，被看见让想法，被看见");
  await page.keyboard.press("Escape");
  await expect(canvas.locator("[data-element-id]")).toHaveCount(3);
  await save(page);
  await page.reload();
  await expect(
    canvas.getByText("让想法，被看见让想法，被看见", { exact: true }),
  ).toBeVisible();
});

test("粘贴使用尚未触发选区事件的当前光标", async ({ page }) => {
  await open(page);
  const canvas = page.getByRole("group", { name: "幻灯片画布" });
  await canvas.getByText("让想法，被看见", { exact: true }).dblclick();
  const text = page.getByRole("textbox", { name: "编辑幻灯片文字" });
  await expect(text).toBeFocused();
  await text.press("ControlOrMeta+a");
  await text.evaluate((editor) => {
    const selection = window.getSelection()!;
    selection.collapseToEnd();
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "，也被记住");
    editor.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, clipboardData }),
    );
  });
  await expect(text).toHaveText("让想法，被看见，也被记住");
});

test("拖拽中的首次撤销只取消预览，页面删除撤销定位到恢复页面", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "幻灯片 2", exact: true }).click();
  const title = page.getByLabel("文稿名称", { exact: true });
  await title.fill("保留此前操作");
  const element = page.locator(".presentation-canvas [data-element-id]");
  await element.click();
  const box = (await element.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 80,
    box.y + box.height / 2 + 40,
    { steps: 5 },
  );
  await page.keyboard.press("ControlOrMeta+z");
  await page.mouse.up();
  await expect(page.getByLabel("X", { exact: true })).toHaveValue("100");
  await expect(title).toHaveValue("保留此前操作");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(title).toHaveValue("撤销测试");
  await page.getByRole("button", { name: "删除幻灯片", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "幻灯片 2", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "幻灯片 2", exact: true }),
  ).toHaveAttribute("aria-current", "true");
  await expect(element).toHaveCount(1);
});
