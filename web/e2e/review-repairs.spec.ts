import { expect, test } from "@playwright/test";

test("director production chunks initialize the scene renderer", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/home");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const response = await page.request.post("/v1/director-desk/projects", {
    headers,
    data: { title: "构建分块验收" },
  });
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  try {
    await page.goto(`/apps/director-desk/projects/${project.id}`);
    await expect(
      page.locator(".director-desk-root canvas").first(),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await page.goto("/home");
    const latest = await (
      await page.request.get(`/v1/director-desk/projects/${project.id}`)
    ).json();
    await page.request.delete(
      `/v1/director-desk/projects/${project.id}?expected_revision=${latest.revision}`,
      { headers },
    );
  }
});

test("nested project files remain selected on narrow screens", async ({
  page,
}, info) => {
  await page.goto("/home");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const response = await page.request.post("/v1/visual-workshop/projects", {
    headers,
    data: { title: "文件夹修复验收", kind: "canvas" },
  });
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  try {
    const folderResponse = await page.request.post("/v1/file-folders", {
      headers,
      data: { name: "子文件夹", scope: "project", project_id: project.id },
    });
    expect(folderResponse.ok()).toBeTruthy();
    const folder = await folderResponse.json();
    for (const [name, folderId] of [
      ["root.txt", undefined],
      ["nested.txt", folder.id],
    ]) {
      const upload = await page.request.post("/v1/files", {
        headers,
        multipart: {
          project_id: project.id,
          ...(folderId ? { folder_id: folderId } : {}),
          upload: {
            name: name!,
            mimeType: "text/plain",
            buffer: Buffer.from("test"),
          },
        },
      });
      expect(upload.ok()).toBeTruthy();
    }
    await page.goto(`/apps/visual-workshop/projects/${project.id}/assets`);
    await page.getByRole("tab", { name: "总文件", exact: true }).click();
    await page
      .getByRole("button", { name: "从本项目选取", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "从本项目选取" });
    await dialog.getByRole("option", { name: /root/ }).click();
    await dialog.getByRole("button", { name: "子文件夹", exact: true }).click();
    await dialog.getByRole("option", { name: /nested/ }).click();
    await dialog.getByLabel("搜索素材").fill("missing");
    await expect(dialog.getByText("没有找到匹配的文件")).toBeVisible();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);
        const bounds = await dialog.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
        await page.screenshot({
          path: info.outputPath(`file-picker-${width}-${theme}.png`),
        });
      }
    }
    await dialog.getByRole("button", { name: "下一步（2）" }).click();
    await expect(
      page.getByRole("dialog", { name: "确认上传并改名" }),
    ).toBeVisible();
  } finally {
    const latest = await (
      await page.request.get(`/v1/visual-workshop/projects/${project.id}`)
    ).json();
    await page.request.delete(
      `/v1/visual-workshop/projects/${project.id}?expected_revision=${latest.revision}`,
      { headers },
    );
  }
});

test("rapid timeline edits save in order and failed writes are not replayed", async ({
  page,
}) => {
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
  const project = await (await created).json();
  const base = `/v1/video-editor/projects/${project.id}`;
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const timeline = async () =>
    (await page.request.get(base + "/timeline")).json();
  try {
    await expect(page.locator(".ve-save-state")).toContainText("已自动保存");
    const before = await timeline();
    const count = before.document.tracks.length;
    const revisions: number[] = [];
    await page.route("**/timeline/operations", async (route) => {
      revisions.push(route.request().postDataJSON().expectedRevision);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await route.continue();
    });
    await page.evaluate(() => {
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>("button"),
      ].find((button) => button.textContent?.includes("视觉轨"))!;
      button.click();
      button.click();
    });
    await expect
      .poll(async () => (await timeline()).document.tracks.length)
      .toBe(count + 2);
    expect(revisions).toEqual([before.revision, before.revision + 1]);
    await page.unroute("**/timeline/operations");
    let requests = 0;
    await page.route("**/timeline/operations", async (route) => {
      requests++;
      await new Promise((resolve) => setTimeout(resolve, 100));
      const response = await route.fetch({
        postData: JSON.stringify({
          ...route.request().postDataJSON(),
          expectedRevision: 0,
        }),
      });
      await route.fulfill({ response });
    });
    await page.evaluate(() => {
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>("button"),
      ].find((button) => button.textContent?.includes("视觉轨"))!;
      button.click();
      button.click();
    });
    await page.getByRole("button", { name: "查看未保存操作（2）" }).click();
    await page
      .getByRole("button", { name: "放弃未保存操作", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /查看未保存操作/ }),
    ).toHaveCount(0);
    expect(requests).toBe(1);
    expect((await timeline()).document.tracks.length).toBe(count + 2);
  } finally {
    await page.unroute("**/timeline/operations");
    const latest = await (await page.request.get(base)).json();
    await page.request.delete(base + `?expected_revision=${latest.revision}`, {
      headers,
    });
  }
});
