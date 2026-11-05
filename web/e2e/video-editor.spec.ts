import { expect, test } from "@playwright/test";

const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("keeps vertical clip dragging stable across tracks and saves the drop", async ({
  page,
}, testInfo) => {
  await page.goto("/apps/video-editor");
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/video-editor/projects") &&
      response.request().method() === "POST",
  );
  await page
    .locator(".workshop-app-chrome")
    .getByRole("button", { name: "新建剪辑" })
    .click();
  await expect(page.getByText("视频剪辑工坊 · revision")).toBeVisible();
  const project = await (await created).json();
  try {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator(".ve-track-kind")).toHaveText([
        "视觉轨",
        "混合轨",
        "音频轨",
      ]);
      for (const head of await page.locator(".ve-track-head").all()) {
        const heading = (await head
          .locator(".ve-track-heading")
          .boundingBox())!;
        const badge = (await head.locator(".ve-track-kind").boundingBox())!;
        const name = (await head.locator("strong").boundingBox())!;
        const actions = (await head
          .locator(".ve-track-actions")
          .boundingBox())!;
        expect(badge.width).toBeGreaterThan(35);
        expect(name.width).toBeGreaterThan(40);
        expect(badge.x + badge.width).toBeLessThanOrEqual(name.x);
        expect(name.x + name.width).toBeLessThanOrEqual(
          heading.x + heading.width,
        );
        expect(actions.y).toBeGreaterThanOrEqual(heading.y + heading.height);
        const last = (await head.locator("button").last().boundingBox())!;
        expect(last.x + last.width).toBeLessThanOrEqual(
          actions.x + actions.width,
        );
      }
    }
    await page
      .locator(".ve-track-head.mixed")
      .getByRole("button", { name: "锁定轨道" })
      .focus();
    await expect(
      page
        .locator(".ve-track-head.mixed")
        .getByRole("button", { name: "锁定轨道" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page
        .locator(".ve-track-head.mixed")
        .getByRole("button", { name: "解锁轨道" }),
    ).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      const heads = page.locator(".ve-track-heads");
      await expect(heads.locator("strong").first()).toHaveCSS(
        "color",
        "rgb(223, 232, 239)",
      );
      await expect(heads.getByRole("button", { name: "解锁轨道" })).toHaveCSS(
        "color",
        "rgb(223, 232, 239)",
      );
      await heads.screenshot({
        path: testInfo.outputPath(`track-labels-${theme}.png`),
      });
    }
    await page.getByRole("button", { name: "纯色黑幕" }).click();
    await expect(page.locator(".ve-clip.color")).toHaveCount(1);
    await page.getByRole("button", { name: "视觉轨", exact: true }).click();
    const rows = page.locator(".ve-track-row.visual");
    await expect(rows).toHaveCount(2);
    const source = rows.first();
    const target = rows.last();
    const clip = page.locator(".ve-clip.color");
    const original = (await clip.boundingBox())!;
    const sourceBounds = (await source.boundingBox())!;
    const targetBounds = (await target.boundingBox())!;
    const x = original.x + 30;
    const sourceY = sourceBounds.y + 25;
    const targetY = targetBounds.y + 25;
    await page.mouse.move(x, sourceY);
    await page.mouse.down();
    for (const y of [
      targetY,
      targetY + 1,
      targetY + 2,
      sourceY,
      sourceY + 1,
      targetY,
      targetY + 1,
    ]) {
      await page.mouse.move(x, y);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
      const expectedY =
        y < sourceBounds.y + sourceBounds.height
          ? original.y
          : original.y + targetBounds.y - sourceBounds.y;
      await expect
        .poll(async () => (await clip.boundingBox())!.y)
        .toBeCloseTo(expectedY, 0);
    }
    await page.mouse.up();
    await expect(target.locator(".ve-clip.color")).toHaveCount(1);
    expect((await clip.boundingBox())!.x).toBeCloseTo(original.x, 0);
    await page.reload();
    await expect(target.locator(".ve-clip.color")).toHaveCount(1);
    await page.mouse.move(x, targetY);
    await page.mouse.down();
    await page.mouse.move(x, sourceY, { steps: 4 });
    await page.mouse.up();
    await expect(source.locator(".ve-clip.color")).toHaveCount(1);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(target.locator(".ve-clip.color")).toHaveCount(1);
  } finally {
    const response = await page.request.get(
      `/v1/video-editor/projects/${project.id}`,
    );
    const current = await response.json();
    const csrf = (await page.context().cookies()).find(
      (cookie) => cookie.name === "fpl_csrf",
    )!.value;
    const removed = await page.request.delete(
      `/v1/video-editor/projects/${project.id}?expected_revision=${current.revision}`,
      {
        headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
      },
    );
    expect(removed.ok()).toBeTruthy();
  }
});

test("builds a deterministic image, black-card, and title edit", async ({
  page,
}, info) => {
  await page.goto("/apps/video-editor");
  await page
    .locator(".workshop-app-chrome")
    .getByRole("button", { name: "新建剪辑" })
    .click();
  await expect(page.getByText("视频剪辑工坊 · revision")).toBeVisible();

  await page.getByLabel("上传素材（可多选）").setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: pixel,
  });
  const asset = page.locator(".ve-asset", { hasText: "pixel" });
  await expect(asset.getByText("图片", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await asset
    .getByRole("button", { name: "预览素材“pixel”，双击添加到时间轴" })
    .dblclick();
  await expect(page.locator(".ve-clip.image")).toHaveCount(1);

  await page.locator(".ve-ruler").click({ position: { x: 160, y: 10 } });
  await page.locator(".ve-clip.image").click();
  await page.getByRole("button", { name: "分割" }).click();
  await expect(page.locator(".ve-clip.image")).toHaveCount(2);
  await page.locator(".ve-clip.image").nth(1).click();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.locator(".ve-clip.image")).toHaveCount(1);

  await page.getByRole("button", { name: "纯色黑幕" }).click();
  await expect(page.locator(".ve-clip.color")).toHaveCount(1);
  await page.locator(".ve-ruler").click({ position: { x: 400, y: 10 } });
  await page.getByRole("combobox", { name: "添加文字" }).click();
  await page.getByRole("option", { name: /居中标题/ }).click();
  await expect(page.locator(".ve-clip.text")).toHaveCount(1);

  await page.screenshot({
    path: info.outputPath("video-editor-timeline.jpg"),
    type: "jpeg",
    quality: 85,
  });

  await page.getByRole("button", { name: "导出视频" }).click();
  await page.locator(".ve-preset-grid button").first().click();
  await page.getByRole("button", { name: "运行预检" }).click();
  await expect(page.getByText(/预检通过/)).toBeVisible();
  await page.getByRole("button", { name: "开始确定性渲染" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.goto("/apps/video-editor");
  await expect(page.locator(".workshop-project-card")).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("video-editor-projects.jpg"),
    type: "jpeg",
    quality: 85,
  });
});
