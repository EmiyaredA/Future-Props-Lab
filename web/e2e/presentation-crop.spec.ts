import { expect, test, type Locator } from "@playwright/test";
import {
  newDeck,
  newElement,
} from "../src/features/presentation-workshop/templates";

async function proportional(image: Locator) {
  await expect(image).toBeVisible();
  const scales = await image.evaluate((node: HTMLImageElement) => {
    const style = getComputedStyle(node);
    return [
      parseFloat(style.width) / node.naturalWidth,
      parseFloat(style.height) / node.naturalHeight,
    ];
  });
  expect(scales[0] / scales[1]).toBeCloseTo(1, 4);
}

test("旧文稿图片等比填充，裁剪撤销保存重开与放映保持一致", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/presentation-workshop");
  await expect(
    page.getByRole("button", { name: "新建演示文稿", exact: true }),
  ).toBeVisible();
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 200;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 400, 200);
    ctx.strokeStyle = "#bbbbbb";
    for (let x = 0; x <= 400; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 200);
      ctx.stroke();
    }
    for (let y = 0; y <= 200; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(400, y);
      ctx.stroke();
    }
    ctx.lineWidth = 4;
    ctx.strokeStyle = "red";
    ctx.beginPath();
    ctx.arc(200, 100, 50, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "blue";
    ctx.strokeRect(155, 55, 90, 90);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const upload = await page.request.post("/v1/files", {
    headers,
    multipart: {
      upload: {
        name: "crop-grid.png",
        mimeType: "image/png",
        buffer: Buffer.from(base64, "base64"),
      },
    },
  });
  expect(upload.ok()).toBeTruthy();
  const asset = await upload.json();
  const document = newDeck();
  document.slides[0].elements = [
    newElement("image", {
      id: "legacy-grid",
      asset_id: asset.id,
      x: 100,
      y: 100,
      width: 300,
      height: 300,
    }),
  ];
  const created = await page.request.post(
    "/v1/presentation-workshop/projects",
    { headers, data: { title: "旧裁剪文稿", document } },
  );
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  const endpoint = `/v1/presentation-workshop/projects/${project.id}`;
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().endsWith(endpoint))
      writes++;
  });
  await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
  const image = page.locator(".presentation-canvas img");
  await proportional(image);
  await proportional(page.locator(".presentation-filmstrip img").first());
  await image.click();
  await page.getByLabel("旋转角度", { exact: true }).fill("24");
  await proportional(image);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  const before = await (await page.request.get(endpoint)).json();
  expect(before.document).toEqual(project.document);
  writes = 0;
  await page.reload();
  await proportional(image);
  await page.getByRole("button", { name: "从头放映", exact: true }).click();
  await proportional(
    page.getByRole("dialog", { name: "幻灯片放映" }).getByAltText("幻灯片图片"),
  );
  await page.keyboard.press("Escape");
  expect(writes).toBe(0);
  const unchanged = await (await page.request.get(endpoint)).json();
  expect(unchanged.revision).toBe(before.revision);
  expect(unchanged.document).toEqual(before.document);
  await image.click();
  await page.getByLabel("裁剪左侧", { exact: true }).fill("20");
  await proportional(image);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.getByLabel("裁剪左侧", { exact: true })).toHaveValue("0");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(page.getByLabel("裁剪左侧", { exact: true })).toHaveValue("20");
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  await page.reload();
  await proportional(image);
  await image.click();
  await expect(page.getByLabel("裁剪左侧", { exact: true })).toHaveValue("20");
  await expect(page.getByLabel("宽度", { exact: true })).toHaveValue("300");
  await expect(page.getByLabel("高度", { exact: true })).toHaveValue("300");
  await page.getByRole("button", { name: "重置裁剪", exact: true }).click();
  await proportional(image);
  await page.getByLabel("宽度", { exact: true }).fill("450");
  await proportional(image);
  await page.getByRole("button", { name: "文件库", exact: true }).click();
  const preview = page
    .getByRole("dialog", { name: "选择文件库图片" })
    .getByRole("button", {
      name: `插入 ${asset.display_name || asset.original_filename}`,
    })
    .getByAltText("幻灯片图片");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveCSS("object-fit", "contain");
});
