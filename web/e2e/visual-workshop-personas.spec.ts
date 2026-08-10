import { expect } from "@playwright/test";
import { test } from "./fixtures/visual-workshop";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("素材管理员上传后，生成面板立即看到项目素材且不污染公共库", async ({
  page,
  visualWorkshop,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/apps/visual-workshop/projects/persona-project/assets");
  await expect(page.getByRole("heading", { name: "项目素材库" })).toBeVisible();
  await expect(page.getByText("公共素材.png")).toHaveCount(0);

  await page.getByLabel("选择要上传的文件").setInputFiles({
    name: "Persona 新素材.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.getByText("已成功上传 1 个文件")).toBeVisible();
  await expect(
    page.getByText("Persona 新素材", { exact: true }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "返回画布" }).click();
  await page.getByText("图片1", { exact: true }).click();
  await page.getByRole("button", { name: "展开图片生成器" }).click();
  await expect(
    page.getByRole("button", { name: "Persona 新素材.png" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "公共素材.png" })).toHaveCount(
    0,
  );
  await expect
    .poll(
      () =>
        visualWorkshop.fileListRequests.filter(
          (request) =>
            request.projectId === "persona-project" &&
            request.mediaKind === "image",
        ).length,
    )
    .toBeGreaterThan(0);

  await page.goto("/files");
  await expect(page.getByRole("heading", { name: "文件管理" })).toBeVisible();
  await expect(page.getByText("公共素材", { exact: true })).toBeVisible();
  await expect(page.getByText("Persona 新素材", { exact: true })).toHaveCount(
    0,
  );
});

test("创作者从其他项目复制参考图后可直接提交生成任务", async ({
  page,
  visualWorkshop,
}) => {
  await page.goto("/apps/visual-workshop/projects/persona-project/canvas");
  await page.getByText("图片1", { exact: true }).click();
  const sourceTrigger = page.getByRole("button", {
    name: "上传参考图片（可选）",
  });
  await expect(sourceTrigger).toBeVisible();
  await sourceTrigger.click();
  await page.getByRole("menuitem", { name: /跨项目素材/ }).click();

  const dialog = page.getByRole("dialog", { name: "选择跨项目素材" });
  await expect(dialog.getByLabel("来源项目")).toHaveValue(
    "persona-source-project",
  );
  await dialog.getByRole("option", { name: "跨项目参考图.png" }).click();
  await dialog.getByRole("button", { name: "导入并选择" }).click();
  await expect(
    page.getByRole("button", { name: "跨项目参考图.png", exact: true }),
  ).toBeVisible();

  const prompt = page.getByRole("textbox", { name: "图片提示词" });
  await prompt.click();
  await prompt.type("使用跨项目参考图生成新海报");
  await page.getByRole("button", { name: "生成图片" }).click();

  await expect
    .poll(() => visualWorkshop.generationRequests.at(-1))
    .toMatchObject({
      kind: "image",
      reference_asset_id: "persona-cross-imported",
    });
});

test("故障恢复值班员只重试一次，并在列表重读后看到完成态", async ({
  page,
  visualWorkshop,
}) => {
  await page.goto("/apps/visual-workshop/tasks");
  const taskCard = page.getByRole("article");
  await expect(page.getByText("生成已完成，但保存素材失败")).toBeVisible();
  await expect(taskCard.getByText("失败", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "重试保存" }).click();

  await expect(taskCard.getByText("已完成", { exact: true })).toBeVisible();
  await expect(page.getByText("生成已完成，但保存素材失败")).toHaveCount(0);
  expect(visualWorkshop.retryRequests).toBe(1);
  expect(visualWorkshop.taskListRequests).toBeGreaterThanOrEqual(2);
});
