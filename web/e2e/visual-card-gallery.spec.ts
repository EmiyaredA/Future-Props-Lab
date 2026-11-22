import { expect, test } from "@playwright/test";

const libraryPath = "/apps/visual-workshop/card-library";

test("角色组总览展示采用图与参考图，支持大图、归档与窄屏且不写入绑定", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(libraryPath);
  const csrf = (await page.context().cookies()).find(
    ({ name }) => name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const assetIds: string[] = [];
  for (const [index, color] of [
    "#d6c9bd",
    "#ffd1da",
    "#b9d9e8",
    "#d8cef0",
  ].entries()) {
    const data = await page.evaluate(
      ({ color, index }) => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 400;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 640, 400);
        ctx.fillStyle = "#453f3b";
        ctx.font = "32px sans-serif";
        ctx.fillText(`Character reference ${index + 1}`, 40, 65);
        for (let view = 0; view < 3; view++) {
          const x = 120 + view * 200;
          ctx.beginPath();
          ctx.arc(x, 155, 44, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillRect(x - 35, 205, 70, 120);
        }
        return canvas.toDataURL("image/png").split(",")[1];
      },
      { color, index },
    );
    const response = await page.request.post("/v1/files", {
      headers,
      multipart: {
        upload: {
          name: `gallery-${index}.png`,
          mimeType: "image/png",
          buffer: Buffer.from(data, "base64"),
        },
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    assetIds.push((await response.json()).id);
  }
  const create = async (data: Record<string, unknown>) => {
    const response = await page.request.post(
      "/v1/visual-workshop/asset-cards",
      {
        headers,
        data: { kind: "character", ...data },
      },
    );
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const main = await create({
    title: "画廊验收角色",
    adopted_asset_id: assetIds[0],
    candidate_asset_ids: [assetIds[1]],
  });
  const child = await create({
    title: "画廊验收角色 · 常服 Q 版",
    parent_id: main.id,
    parent_asset_id: assetIds[0],
    adopted_asset_id: assetIds[2],
    candidate_asset_ids: [assetIds[3], assetIds[1]],
  });
  await create({
    title: "画廊验收角色 · 归档造型",
    parent_id: main.id,
    parent_asset_id: assetIds[0],
    candidate_asset_ids: [assetIds[0]],
    archived: true,
  });
  const before = await (
    await page.request.get("/v1/visual-workshop/asset-cards")
  ).json();
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      /\/v1\/(visual-workshop|files)/.test(request.url()) &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method())
    )
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  await page.reload();
  await page.getByRole("textbox", { name: "搜索角色卡" }).fill("常服");
  const trigger = page.getByRole("button", {
    name: "查看画廊验收角色的全部关联图片",
  });
  await expect(trigger).toContainText("查看全部图片（4）");
  await trigger.click();
  const gallery = page.getByRole("dialog", {
    name: "画廊验收角色的全部关联图片",
    exact: true,
  });
  await expect(
    gallery.getByRole("region", {
      name: "画廊验收角色的关联图片",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    gallery.getByRole("region", { name: "画廊验收角色 · 归档造型的关联图片" }),
  ).toHaveCount(0);
  const section = gallery.getByRole("region", {
    name: "画廊验收角色 · 常服 Q 版的关联图片",
  });
  await expect(section.getByText("参考图", { exact: true })).toHaveCount(2);
  await expect(section.getByText("已采用", { exact: true })).toHaveCount(1);
  await expect
    .poll(() =>
      section
        .getByRole("img")
        .first()
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath("gallery-desktop-light.png") });
  const large = section.getByRole("button", {
    name: "查看大图 画廊验收角色 · 常服 Q 版 2",
    exact: true,
  });
  await large.focus();
  await page.keyboard.press("Enter");
  const preview = page.getByRole("dialog", {
    name: "画廊验收角色 · 常服 Q 版的图片预览",
    exact: true,
  });
  await expect(preview.getByRole("link", { name: "查看原图" })).toHaveAttribute(
    "href",
    `/v1/files/${assetIds[3]}/content`,
  );
  await expect(preview.getByRole("img")).toHaveJSProperty("naturalWidth", 640);
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(gallery).toBeVisible();
  await expect(large).toBeFocused();
  await section.getByRole("button", { name: "打开设定卡" }).click();
  await expect(gallery).toBeHidden();
  const editor = page.getByRole("dialog", { name: child.title, exact: true });
  await expect(editor).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "保存设定卡" }),
  ).toBeDisabled();
  await editor.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await trigger.click();
  await page.screenshot({ path: info.outputPath("gallery-desktop-dark.png") });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(
      gallery.getByRole("button", { name: "关闭图片总览" }),
    ).toBeInViewport();
    expect(
      await gallery.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBe(0);
    const scroll = gallery.locator(".card-gallery-scroll");
    expect(await scroll.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(
      0,
    );
    await page.screenshot({
      path: info.outputPath(`gallery-mobile-${width}.png`),
    });
  }
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "显示已归档", exact: true }).click();
  await trigger.click();
  await expect(
    gallery.getByRole("region", { name: "画廊验收角色 · 归档造型的关联图片" }),
  ).toBeAttached();
  await gallery.getByRole("button", { name: "关闭图片总览" }).click();
  const after = await (
    await page.request.get("/v1/visual-workshop/asset-cards")
  ).json();
  expect(after).toEqual(before);
  expect(writes).toEqual([]);
});
