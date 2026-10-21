import { unzipSync, strFromU8 } from "fflate";
import { expect, test, type Page, type Locator } from "@playwright/test";
import {
  newDeck,
  newElement,
} from "../src/features/presentation-workshop/templates";
import { cosineFormula } from "../src/features/presentation-workshop/objects/formula/formulaTemplates";

async function create(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const document = newDeck("blank");
  document.slides[0].elements = [newElement("text", { name: "公式演示标题" })];
  document.slides[0].elements[0].paragraphs[0].runs[0].text =
    "余弦相似度：向量如何变成排序";
  const response = await page.request.post(
    "/v1/presentation-workshop/projects",
    { headers, data: { title: "公式编辑验收", document } },
  );
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
  await expect(page.getByRole("group", { name: "幻灯片画布" })).toBeVisible();
  const snapshot = async () => {
    await page.getByRole("button", { name: "保存文稿", exact: true }).click();
    await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
    return (
      await page.request.get(`/v1/presentation-workshop/projects/${project.id}`)
    ).json();
  };
  return { project, headers, snapshot };
}
async function submit(dialog: Locator, label = "插入公式") {
  const button = dialog.getByRole("button", { name: label, exact: true });
  await expect(button).toBeEnabled({ timeout: 30000 });
  await button.click();
  await expect(dialog).toHaveCount(0, { timeout: 30000 });
}

test("公式插入、双击编辑、撤销、保存重开、放映及 PPTX 保留矢量与源码", async ({
  page,
}, info) => {
  const { project, headers, snapshot } = await create(page);
  await page.getByRole("button", { name: "公式", exact: true }).click();
  const insert = page.getByRole("dialog", { name: "插入公式", exact: true });
  await insert.getByRole("button", { name: "余弦相似度", exact: true }).click();
  await expect(insert.getByRole("textbox", { name: "LaTeX 公式" })).toHaveValue(
    cosineFormula,
  );
  await submit(insert);
  const inserted = await snapshot();
  const formula = inserted.document.slides[0].elements.find(
    (e: { kind: string }) => e.kind === "formula",
  );
  expect(formula.formula.latex).toBe(cosineFormula);
  const element = page.locator(
    `.presentation-canvas [data-element-id="${formula.id}"]`,
  );
  await element.dblclick();
  const edit = page.getByRole("dialog", { name: "编辑公式", exact: true });
  await expect(edit).toBeVisible();
  await edit.getByRole("spinbutton", { name: "公式字号" }).fill("54");
  await edit.getByRole("button", { name: "公式颜色", exact: true }).click();
  await page
    .getByRole("button", { name: "选择颜色 #E75B55", exact: true })
    .click();
  await submit(edit, "应用修改");
  const changed = await snapshot();
  const updated = changed.document.slides[0].elements.find(
    (e: { id: string }) => e.id === formula.id,
  );
  expect(updated.formula).toMatchObject({ size: 54, color: "#E75B55" });
  expect(updated.width / formula.width).toBeCloseTo(1.5, 4);
  expect(updated.height / formula.height).toBeCloseTo(1.5, 4);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  const undone = await snapshot();
  expect(
    undone.document.slides[0].elements.find(
      (e: { id: string }) => e.id === formula.id,
    ).formula.size,
  ).toBe(36);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  const saved = await snapshot();
  await page.reload();
  await element.dblclick();
  await expect(edit.getByRole("spinbutton", { name: "公式字号" })).toHaveValue(
    "54",
  );
  await expect(
    edit.getByRole("button", { name: "公式颜色", exact: true }),
  ).toContainText("#E75B55");
  await edit.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "从头放映", exact: true }).click();
  await expect(page.locator(".presentation-show")).toBeVisible();
  await expect(
    page.locator(`.presentation-show [data-element-id="${formula.id}"] img`),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const exported = await page.request.post(
    `/v1/presentation-workshop/projects/${project.id}/export`,
    { headers, data: { expected_revision: saved.revision } },
  );
  expect(exported.ok()).toBeTruthy();
  const files = unzipSync(await exported.body());
  expect(Object.keys(files).some((name) => name.endsWith(".svg"))).toBe(true);
  const xml = strFromU8(files["ppt/slides/slide1.xml"]);
  expect(xml).toContain("FPL:formula:");
  expect(xml).toContain("asvg:svgBlip");
  expect(xml).toContain("54");
  await page.screenshot({ path: info.outputPath("formula-saved.png") });
});

test("模板弹窗在明暗主题、窄屏和低高度保持可操作，Esc 分层关闭并恢复焦点", async ({
  page,
}, info) => {
  await create(page);
  const trigger = page.getByRole("button", { name: "公式", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "插入公式", exact: true });
  await dialog.getByRole("button", { name: "余弦相似度", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "插入公式", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    for (const [width, height] of [
      [2048, 1220],
      [1440, 900],
      [1024, 600],
      [768, 900],
      [390, 844],
      [360, 600],
    ]) {
      await page.setViewportSize({ width, height });
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(11);
      expect(box.y).toBeGreaterThanOrEqual(11);
      expect(box.x + box.width).toBeLessThanOrEqual(width - 11);
      expect(box.y + box.height).toBeLessThanOrEqual(height - 11);
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      await expect(
        dialog.getByRole("button", { name: "插入公式", exact: true }),
      ).toBeInViewport();
      if (width >= 1024) {
        const templates = (await dialog
          .locator(".presentation-formula-templates")
          .boundingBox())!;
        const content = (await dialog
          .locator(".presentation-formula-content")
          .boundingBox())!;
        expect(content.x).toBeGreaterThan(templates.x + templates.width);
      }
      await page.screenshot({
        path: info.outputPath(`formula-${theme}-${width}-${height}.png`),
      });
      if (width === 390) {
        await dialog
          .getByRole("textbox", { name: "LaTeX 公式" })
          .scrollIntoViewIfNeeded();
        await expect(
          dialog.getByRole("textbox", { name: "LaTeX 公式" }),
        ).toBeInViewport();
        await page.screenshot({
          path: info.outputPath(`formula-${theme}-390-source.png`),
        });
        await dialog
          .locator(".presentation-dialog-body")
          .evaluate((el) => (el.scrollTop = 0));
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const apply = dialog.getByRole("button", { name: "插入公式", exact: true });
  await apply.focus();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "关闭公式编辑" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(apply).toBeFocused();
  await dialog.getByRole("button", { name: "公式颜色", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "更多编辑工具" }).click();
  await page.getByRole("menuitem", { name: "插入公式", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
});
