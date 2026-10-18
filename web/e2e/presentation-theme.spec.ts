import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import {
  layouts,
  newDeck,
  newElement,
  newSlide,
} from "../src/features/presentation-workshop/templates";
import { slideTheme } from "../src/features/presentation-workshop/slideTheme";

async function create(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const document = newDeck("body");
  const slide = document.slides[0];
  slide.background = "#FFFFFF";
  slide.elements[0].paragraphs[0].runs[0].color = "#24344B";
  slide.elements[0].paragraphs[0].runs[0].text = "把想法，变成清晰的表达";
  slide.elements[1].fill = "#6476DC";
  slide.elements[2].paragraphs[0].runs[0].text =
    "内容先行，让每一页都有明确的观点。\n统一配色，保留原有结构与表达。";
  slide.elements.push(
    newElement("roundRect", {
      id: "legacy-card",
      x: 80,
      y: 510,
      width: 1120,
      height: 100,
      corner_radius: 4,
      fill: "#EFF5FA",
      stroke: "#4A7D9A",
      stroke_width: 1.5,
    }),
  );
  slide.elements.push(
    newElement("rect", {
      id: "warning",
      x: 1170,
      y: 60,
      width: 16,
      height: 16,
      fill: "#E75B55",
    }),
  );
  document.slides.push(...layouts.map((l) => newSlide(l.value)));
  const response = await page.request.post(
    "/v1/presentation-workshop/projects",
    { headers, data: { title: "视觉升级 · 蓝青风格", document } },
  );
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
  await expect(page.getByRole("group", { name: "幻灯片画布" })).toBeVisible();
  return { project, headers };
}

test("旧页换肤预览取消、一次撤销重做、保存重开与原生导出", async ({
  page,
}, info) => {
  const { project, headers } = await create(page);
  const original = project.document.slides[0];
  const canvas = page.locator(".presentation-canvas .presentation-slide");
  const open = page.getByRole("button", { name: "应用蓝青风格", exact: true });
  await open.click();
  const dialog = page.getByRole("dialog", {
    name: "应用蓝青风格",
    exact: true,
  });
  await expect(canvas).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.screenshot({ path: info.outputPath("theme-preview.png") });
  await dialog
    .getByRole("button", { name: "替换颜色 #E75B55", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "替换颜色 #E75B55十六进制值" })
    .fill("#112233");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(open).toBeFocused();
  const unchanged = await (
    await page.request.get(`/v1/presentation-workshop/projects/${project.id}`)
  ).json();
  expect(unchanged.revision).toBe(project.revision);
  expect(unchanged.document).toEqual(project.document);
  await open.click();
  await dialog
    .getByRole("button", { name: "应用到当前页", exact: true })
    .click();
  await expect(canvas).toHaveCSS("background-color", "rgb(251, 252, 253)");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(canvas).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(canvas).toHaveCSS("background-color", "rgb(251, 252, 253)");
  await page.getByRole("button", { name: "保存文稿" }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  const saved = await (
    await page.request.get(`/v1/presentation-workshop/projects/${project.id}`)
  ).json();
  expect(saved.document.slides.slice(1)).toEqual(
    project.document.slides.slice(1),
  );
  const styled = saved.document.slides[0];
  expect(styled.elements[0]).toEqual({
    ...original.elements[0],
    paragraphs: [
      {
        ...original.elements[0].paragraphs[0],
        runs: [
          {
            ...original.elements[0].paragraphs[0].runs[0],
            color: slideTheme.navy,
          },
        ],
      },
    ],
  });
  expect(
    styled.elements.find((e: { id: string }) => e.id === "warning").fill,
  ).toBe("#E75B55");
  expect(
    styled.elements.find((e: { id: string }) => e.id === "legacy-card")
      .corner_radius,
  ).toBe(12);
  await page.reload();
  await expect(canvas).toHaveCSS("background-color", "rgb(251, 252, 253)");
  await open.click();
  await expect(
    dialog.getByRole("button", { name: "应用到当前页" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  for (const [index, layout] of layouts.entries()) {
    await page
      .getByRole("button", { name: `幻灯片 ${index + 2}`, exact: true })
      .click();
    await page.screenshot({
      path: info.outputPath(`template-${layout.value}.png`),
    });
  }
  const exported = await page.request.post(
    `/v1/presentation-workshop/projects/${project.id}/export`,
    { headers, data: { expected_revision: saved.revision } },
  );
  expect(exported.ok()).toBeTruthy();
  await fs.writeFile(
    info.outputPath("blue-teal-templates.pptx"),
    await exported.body(),
  );
});

test("单排工具栏与换肤在明暗主题及四档视口保持可达", async ({ page }, info) => {
  await create(page);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    for (const width of [390, 768, 1100, 1600]) {
      await page.setViewportSize({ width, height: 1000 });
      if (width < 768)
        await page
          .getByRole("button", { name: "文字与格式", exact: true })
          .click();
      await expect(
        page.getByRole("toolbar", { name: "信息图与重建工具" }),
      ).toHaveCount(0);
      const toolbar = page.getByRole("toolbar", { name: "幻灯片工具栏" });
      expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(60);
      const more = page.getByRole("button", { name: "更多编辑工具" });
      await more.click();
      await expect(
        page.getByRole("menuitem", { name: "连接节点" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(more).toBeFocused();
      await page
        .getByRole("button", { name: "应用蓝青风格", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "应用蓝青风格",
        exact: true,
      });
      const bounds = (await dialog.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBeTruthy();
      await page.screenshot({
        path: info.outputPath(`theme-${width}-${theme}.png`),
      });
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "适应页面", exact: true }).click();
      if (width >= 768) {
        const handle = page.getByRole("separator", {
          name: "调整格式面板宽度",
        });
        await handle.press("Shift+ArrowLeft");
        await handle.press("Enter");
        await expect(handle).toHaveAttribute("aria-valuenow", "280");
      }
      await page.screenshot({
        path: info.outputPath(`editor-${width}-${theme}.png`),
      });
    }
  }
});
