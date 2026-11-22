import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const libraryPath = "/apps/visual-workshop/card-library";

test("角色语音上传和解除绑定可保存并重新打开", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(libraryPath);
  await page.getByRole("button", { name: "语音验收角色", exact: true }).click();
  const editor = page.getByRole("dialog");
  await editor.getByRole("textbox", { name: "名称", exact: true }).fill("语音验收角色");
  await expect(editor.getByText("剧本依据与待确认设计")).toHaveCount(0);
  const wav = Buffer.alloc(44 + 16000 * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < 16000; i++)
    wav.writeInt16LE(
      Math.round(2000 * Math.sin((2 * Math.PI * 440 * i) / 16000)),
      44 + i * 2,
    );
  await editor
    .getByLabel("上传角色语音")
    .setInputFiles({
      name: "角色参考.wav",
      mimeType: "audio/wav",
      buffer: wav,
    });
  const audio = editor.getByLabel("语音验收角色的角色语音");
  await expect(audio).toHaveAttribute("src", /^blob:/);
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.readyState),
    )
    .toBeGreaterThan(0);
  await editor.getByRole("button", { name: "保存设定卡" }).click();
  await expect(
    editor.getByRole("button", { name: "保存设定卡" }),
  ).toBeDisabled();
  const cards = await (
    await page.request.get("/v1/visual-workshop/asset-cards")
  ).json();
  const saved = cards.find(
    (entry: { title: string; voice_asset_id?: string }) =>
      entry.title === "语音验收角色" && entry.voice_asset_id,
  );
  expect(saved.voice_asset_id).toBeTruthy();
  expect(saved).not.toHaveProperty("facts");
  expect(saved).not.toHaveProperty("proposed_design");
  await page.screenshot({ path: info.outputPath("角色语音-桌面.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(audio).toBeVisible();
  await page.screenshot({ path: info.outputPath("角色语音-窄屏.png") });
  await editor.getByRole("button", { name: "解除语音绑定" }).click();
  await editor.getByRole("button", { name: "保存设定卡" }).click();
  await expect(
    editor.getByRole("button", { name: "保存设定卡" }),
  ).toBeDisabled();
  await page.reload();
  await page
    .getByRole("button", { name: "语音验收角色 待确认", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "语音验收角色", exact: true })
      .getByText("尚未绑定角色语音"),
  ).toBeVisible();
});

test("三类设定卡优先展示采用图，编辑和保存可通过键盘操作", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(libraryPath);
  const csrf = (await page.context().cookies()).find(
    ({ name }) => name === "fpl_csrf",
  )!.value;
  const headers = {
    "X-CSRF-Token": csrf,
    Origin: new URL(page.url()).origin,
  };
  const image = await readFile(
    new URL(
      "../src/features/visual-workshop/creative/design-library-empty.webp",
      import.meta.url,
    ),
  );
  const assetIds: string[] = [];
  for (const name of [
    "reference.webp",
    "alternate.webp",
    "detail.webp",
    "angle.webp",
  ]) {
    const uploaded = await page.request.post("/v1/files", {
      headers,
      multipart: { upload: { name, mimeType: "image/webp", buffer: image } },
    });
    expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
    assetIds.push((await uploaded.json()).id);
  }
  const entries = [
    {
      kind: "character",
      title: "银发旅人",
      label: "角色卡",
      design:
        "银白长发，搭配深色外套和浅色针织内搭。正面与侧面参考采用一致的服装细节。",
    },
    {
      kind: "scene",
      title: "晨光里的排练室",
      label: "场景卡",
      design: "保留中央空地。光线从左侧窗户进入，背景是一面暖白色墙。",
    },
    {
      kind: "prop",
      title: "旧式摄影机",
      label: "道具卡",
      design: "深色金属机身，圆形镜头与顶部提手。",
    },
  ];
  for (const { kind, title, design } of entries) {
    const response = await page.request.post(
      "/v1/visual-workshop/asset-cards",
      {
        headers,
        data: {
          kind,
          title,
          design,
          adopted_asset_id: assetIds[0],
          candidate_asset_ids:
            kind === "prop" ? assetIds.slice(1) : [assetIds[1]],
        },
      },
    );
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  await page.reload();

  const toolbar = page.locator(".card-library-toolbar");
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      toolbar.getByRole("button", { name: "新建角色卡" }),
    ).toBeVisible();
    const layout = await toolbar.evaluate((row) => {
      const controls = row.querySelectorAll(
        ".card-library-categories, .workshop-header-search, .card-library-actions > button",
      );
      const centers = [...controls].map((control) => {
        const box = control.getBoundingClientRect();
        return box.top + box.height / 2;
      });
      return {
        spread: Math.max(...centers) - Math.min(...centers),
        overflow: row.scrollWidth - row.clientWidth,
      };
    });
    expect(layout.spread).toBeLessThan(2);
    expect(layout.overflow).toBe(0);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  for (const { title, label } of entries) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.getByRole("button", { name: `${title} 已采用图片` }).click();
    const editor = page.getByRole("dialog", { name: title, exact: true });
    const preview = editor.getByRole("img", { name: `${title}的采用图` });
    const save = editor.getByRole("button", { name: "保存设定卡" });
    const options = editor
      .locator("summary")
      .filter({ hasText: "素材与 3D 模型" });

    // A click on dialog padding stays inside; the backdrop closes all card kinds.
    const bounds = (await editor.boundingBox())!;
    await page.mouse.click(bounds.x + 3, bounds.y + 3);
    await expect(editor).toBeVisible();
    await page.mouse.click(4, 4);
    await expect(editor).toBeHidden();
    await page.getByRole("button", { name: `${title} 已采用图片` }).click();
    await expect(preview).toBeInViewport();
    const fitsPreview = await preview.evaluate((image) => {
      const frame = image
        .closest(".card-editor-preview")!
        .getBoundingClientRect();
      const bounds = image.getBoundingClientRect();
      return bounds.top >= frame.top && bounds.bottom <= frame.bottom;
    });
    expect(fitsPreview).toBe(true);
    await expect(
      editor.getByRole("textbox", { name: "确认的设定" }),
    ).toBeInViewport();
    await expect(save).toBeInViewport();
    await expect(
      editor.getByRole("textbox", { name: "生成提示词" }),
    ).toBeHidden();
    await expect(
      editor.getByRole("button", { name: "选择采用图" }),
    ).toBeHidden();
    await options.focus();
    await page.keyboard.press("Enter");
    await expect(
      editor.getByRole("button", { name: "选择采用图" }),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(
      editor.getByRole("button", { name: "选择采用图" }),
    ).toBeHidden();
    await editor.getByRole("heading", { name: title }).click();
    await editor.screenshot({ path: info.outputPath(`${label}-desktop.png`) });

    await editor.getByRole("button", { name: "采用候选图 1" }).click();
    await expect(
      editor.getByRole("link", { name: "查看原图" }),
    ).toHaveAttribute("href", `/v1/files/${assetIds[1]}/content`);
    // Unsaved changes still require an explicit discard decision.
    page.once("dialog", (confirmation) => confirmation.dismiss());
    await page.mouse.click(4, 4);
    await expect(editor).toBeVisible();
    await save.click();
    await expect(editor.getByText("有未保存的修改")).toBeHidden();
    await expect(save).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();
  }

  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 680 });
  await page.getByRole("button", { name: "旧式摄影机 已采用图片" }).click();
  const mobile = page.getByRole("dialog", { name: "旧式摄影机", exact: true });
  await expect(
    mobile.getByRole("heading", { name: "旧式摄影机" }),
  ).toBeInViewport();
  await expect(
    mobile.getByRole("button", { name: "保存设定卡" }),
  ).toBeInViewport();
  const candidates = mobile.locator(".card-editor-candidates");
  expect(
    await candidates.evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBe(true);
  const scroll = mobile.locator(".card-editor-scroll");
  expect(await scroll.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(
    0,
  );
  await scroll.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(
    mobile.getByRole("button", { name: "保存设定卡" }),
  ).toBeInViewport();
  await expect(mobile.getByRole("button", { name: "关闭" })).toBeInViewport();
  await scroll.evaluate((el) => (el.scrollTop = 0));
  await mobile.screenshot({ path: info.outputPath("道具卡-mobile-dark.png") });
});

test("采用图搜索覆盖项目和总文件的子目录，项目归属可搜索", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(libraryPath);
  const csrf = (await page.context().cookies()).find(
    ({ name }) => name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const project = async (title: string) => {
    const response = await page.request.post("/v1/visual-workshop/projects", {
      headers,
      data: { title, kind: "canvas" },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return (await response.json()).id as string;
  };
  const projectId = await project("星海项目归属");
  await project("不匹配的项目");
  const image = await readFile(
    new URL(
      "../src/features/visual-workshop/creative/design-library-empty.webp",
      import.meta.url,
    ),
  );
  const storeImage = async (name: string, projectId?: string) => {
    const folder = async (name: string, parent_id?: string) => {
      const response = await page.request.post("/v1/file-folders", {
        headers,
        data: {
          name,
          scope: projectId ? "project" : "library",
          project_id: projectId,
          parent_id,
        },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return (await response.json()).id as string;
    };
    const parent = await folder("设定参考");
    const folderId = await folder("细节图", parent);
    const response = await page.request.post("/v1/files", {
      headers,
      multipart: {
        upload: { name: `${name}.webp`, mimeType: "image/webp", buffer: image },
        folder_id: folderId,
        ...(projectId ? { project_id: projectId } : {}),
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return (await response.json()).id as string;
  };
  const libraryId = await storeImage("银发三视图");
  const localId = await storeImage("星海旅行者设定", projectId);
  await page.reload();
  await page.getByRole("button", { name: "新建角色卡", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新建角色卡", exact: true });
  const trigger = editor.getByRole("button", {
    name: "选择采用图",
    exact: true,
  });
  await trigger.click();
  const picker = page.getByRole("dialog", { name: "选择采用图", exact: true });
  // Dismiss only the topmost picker, retaining the editor beneath it.
  await page.mouse.click(4, 4);
  await expect(picker).toBeHidden();
  await expect(editor).toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  const search = picker.getByRole("searchbox", { name: "搜索图片" });
  await expect(search).toBeFocused();
  await search.fill("不存在的文件");
  await expect(picker.getByText("没有匹配的结果")).toBeVisible();
  await search.fill("银发");
  const imageChoice = picker.getByRole("button", { name: /银发三视图/ });
  await expect(imageChoice).toContainText("总文件 / 设定参考 / 细节图");
  await imageChoice.click();
  await picker.screenshot({
    path: info.outputPath("search-adopted-image.png"),
  });
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(editor.getByText("暂无采用图")).toBeVisible();
  await trigger.click();
  await search.fill("银发");
  await imageChoice.click();
  await picker.getByRole("button", { name: "确认选择" }).click();
  await expect(editor.getByRole("link", { name: "查看原图" })).toHaveAttribute(
    "href",
    `/v1/files/${libraryId}/content`,
  );
  await trigger.click();
  await picker.getByRole("button", { name: "选择素材来源" }).click();
  const sources = page.getByRole("dialog", {
    name: "选择素材来源",
    exact: true,
  });
  await sources.getByRole("searchbox", { name: "搜索项目" }).fill("星海");
  await sources
    .getByRole("button", { name: "星海项目归属", exact: true })
    .click();
  await sources.getByRole("button", { name: "确认选择" }).click();
  await expect(sources).toBeHidden();
  await search.fill("旅行者");
  await picker.getByRole("button", { name: /星海旅行者设定/ }).click();
  await picker.getByRole("button", { name: "确认选择" }).click();
  await expect(editor.getByRole("link", { name: "查看原图" })).toHaveAttribute(
    "href",
    `/v1/files/${localId}/content`,
  );
  await editor.getByRole("button", { name: "保存设定卡" }).click();
  await expect(editor.getByText("有未保存的修改")).toBeHidden();
  await expect(
    editor.getByRole("link", { name: "查看原图" }),
  ).not.toHaveAttribute("href", `/v1/files/${localId}/content`);
  const cards = await (
    await page.request.get("/v1/visual-workshop/asset-cards")
  ).json();
  const saved = cards.find(
    (card: { title: string }) => card.title === "新建角色卡",
  );
  expect(saved.adopted_asset_id).toBeTruthy();
  expect(saved.media_projects[saved.adopted_asset_id]).toBeNull();

  await editor.getByText("候选图生成", { exact: true }).click();
  const ownership = editor.getByRole("button", { name: "生成任务归属项目" });
  await ownership.click();
  const projectPicker = page.getByRole("dialog", {
    name: "生成任务归属项目",
    exact: true,
  });
  await projectPicker.getByRole("searchbox", { name: "搜索项目" }).fill("星海");
  await expect(
    projectPicker.getByRole("button", { name: "不匹配的项目", exact: true }),
  ).toHaveCount(0);
  await projectPicker
    .getByRole("button", { name: "星海项目归属", exact: true })
    .click();
  await projectPicker.getByRole("button", { name: "确认选择" }).click();
  await expect(ownership).toHaveText("星海项目归属");
});
