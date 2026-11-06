import { proofStep } from "./proof-checkpoint";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { expect, test, type Page } from "@playwright/test";
import { newDeck } from "../src/features/presentation-workshop/templates";

async function create(page: Page) {
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const response = await page.request.post(
    "/v1/presentation-workshop/projects",
    {
      headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
      data: { title: "导出反馈验收", document: newDeck() },
    },
  );
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
  await expect(page.getByRole("group", { name: "幻灯片画布" })).toBeVisible();
  return project.id as string;
}

test("真实 PPTX 下载期间持续显示进度，完成后明确提示下载位置入口", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const id = await create(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `**/v1/presentation-workshop/projects/${id}/export`,
    async (route) => {
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    },
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PPTX", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导出 PPTX", exact: true });
  try {
    await proofStep(
      info,
      "检查 PPTX 导出进度",
      "生成期间显示进度，且不能关闭对话框。",
      async () => {
        await expect(dialog.getByText(/正在生成 PPTX/)).toBeVisible();
        await expect(dialog.getByRole("progressbar")).toBeVisible();
        await expect(
          dialog.getByRole("button", { name: "关闭", exact: true }),
        ).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeVisible();
        await info.attach("导出生成进度", {
          body: await page.screenshot(),
          contentType: "image/png",
        });
      },
    );
  } finally {
    release();
  }
  const file = await download;
  expect(file.suggestedFilename()).toBe("导出反馈验收.pptx");
  await proofStep(
    info,
    "打开导出的 PPTX 包并核对封面文字",
    "PPTX 结构有效，封面包含预期文字。",
    async () => {
      const path = info.outputPath("导出反馈验收.pptx");
      await file.saveAs(path);
      const archive = unzipSync(await readFile(path));
      expect(archive["[Content_Types].xml"]).toBeDefined();
      expect(archive["ppt/presentation.xml"]).toBeDefined();
      expect(strFromU8(archive["ppt/slides/slide1.xml"])).toContain(
        "让想法，被看见",
      );
      await info.attach("导出文稿", {
        path,
        contentType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });
    },
  );
  await expect(dialog.getByText(/已发起下载/)).toBeVisible();
  await expect(dialog.getByText(/浏览器下载列表/)).toBeVisible();
  await expect(dialog.getByRole("progressbar")).toHaveCount(0);
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("浏览器导出失败后可重试，并在窄屏提示下载位置", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const id = await create(page);
  let exports = 0;
  await page.route(
    `**/v1/presentation-workshop/projects/${id}/export`,
    async (route) => {
      exports++;
      if (exports === 1) {
        await route.fulfill({
          status: 503,
          json: { detail: "导出暂时不可用" },
        });
        return;
      }
      await route.continue();
    },
  );
  await page.getByRole("button", { name: "导出选项" }).click();
  await page
    .getByRole("menuitem", { name: "导出 PPTX 文件", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "导出 PPTX", exact: true });
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("progressbar")).toHaveCount(0);

  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "导出文件", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("导出反馈验收.pptx");
  expect(exports).toBe(2);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByText(/已发起下载/)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByText(/浏览器下载列表/)).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath("export-saved-mobile.png") });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({
    path: info.outputPath("export-saved-mobile-dark.png"),
  });
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
