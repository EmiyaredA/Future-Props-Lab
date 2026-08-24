import { expect, test } from "@playwright/test";
function silentWav(durationMs: number) {
  const sampleRate = 8000;
  const sampleCount = Math.max(1, Math.round((sampleRate * durationMs) / 1000));
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

test("authors two chapters across card and performance views and plays into the next chapter", async ({
  page,
}) => {
  test.setTimeout(60_000);
  let revision = 0;
  let document: Record<string, unknown> = {
    schemaVersion: "1.0",
    entryChapterId: "chapter-1",
    synopsis: "",
    characters: [],
    characterAttributeTemplates: [],
    scenes: [],
    cgs: [],
    variables: [],
    assets: [],
    chapters: [
      {
        id: "chapter-1",
        title: "第一章",
        order: 1,
        entryFragmentId: "main",
        disabled: false,
        fragments: [{ id: "main", title: "开始", blocks: [] }],
      },
    ],
  };
  await page.route(
    "**/v1/galgame-workshop/projects/multi-chapter**",
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith("/assets/overview")) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ items: [], missing_items: [] }),
        });
        return;
      }
      if (path.endsWith("/assets")) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ items: [] }),
        });
        return;
      }
      if (path.endsWith("/story/report")) {
        const chapters = document.chapters as Array<Record<string, unknown>>;
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            project_id: "multi-chapter",
            story_revision: revision,
            ready: true,
            errors: [],
            warnings: [],
            chapters: chapters.map((chapter) => ({
              chapter_id: chapter.id,
              reachable_fragment_ids: (
                chapter.fragments as Array<Record<string, unknown>>
              ).map((fragment) => fragment.id),
              unreachable_fragment_ids: [],
              ending_ids: [chapter.id],
              cycles: [],
            })),
          }),
        });
        return;
      }
      if (path.endsWith("/story")) {
        if (request.method() === "PUT") {
          document = request.postDataJSON().document;
          revision += 1;
        }
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            project_id: "multi-chapter",
            document,
            revision,
            updated_at: "2026-08-09T08:00:00Z",
          }),
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "multi-chapter",
          title: "多章节旅程",
          status: "draft",
          revision: 0,
          created_at: "2026-08-09T08:00:00Z",
          updated_at: "2026-08-09T08:00:00Z",
        }),
      });
    },
  );

  await page.goto("/apps/galgame-workshop/projects/multi-chapter/editor");
  await expect(page.getByText("多章节旅程")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "新建章节" }).click();
  await page
    .locator(".galgame-block-toolbar")
    .getByLabel("Fragment 名称")
    .fill("第二章开始");

  const views = page.getByRole("navigation", { name: "剧本编辑视图" });
  await page.getByRole("button", { name: "演出", exact: true }).click();
  const addAtPlayhead = async (name: string | RegExp) => {
    const menu = page.locator(".galgame-playhead-add-menu");
    if ((await menu.getAttribute("open")) === null)
      await menu.getByRole("button", { name: "在播放头添加内容" }).click();
    const popover = page.getByLabel("可添加内容");
    await (
      typeof name === "string"
        ? popover.getByRole("button", { name, exact: true })
        : popover.getByRole("button", { name })
    ).click();
  };
  await addAtPlayhead("旁白");
  await page.getByLabel("旁白正文").fill("欢迎来到第二章");
  await addAtPlayhead(/章节结局/);
  await page.getByLabel("结局名称").fill("全篇完成");

  await page.getByRole("button", { name: /第一章.*入口章/ }).click();
  await addAtPlayhead(/章节结局/);
  await page.getByLabel("结局名称").fill("进入第二章");

  await page.setViewportSize({ width: 2048, height: 1200 });
  const performanceWorkbench = page.locator(".galgame-script-workbench");
  const [performanceCenter, performancePreview] = await Promise.all([
    performanceWorkbench.locator(":scope > .galgame-block-panel").boundingBox(),
    performanceWorkbench.locator(".galgame-preview-focus").boundingBox(),
  ]);
  expect(performanceCenter?.width).toBeGreaterThanOrEqual(1180);
  expect(performanceCenter?.width).toBeLessThanOrEqual(1210);
  expect(performancePreview?.width).toBeGreaterThanOrEqual(495);
  expect(performancePreview?.width).toBeLessThanOrEqual(525);

  await views.getByRole("button", { name: "卡片", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Block 卡片编辑器" }),
  ).toBeVisible();
  await expect(views.getByRole("button", { name: "纯文本" })).toHaveCount(0);
  await expect(views.getByRole("button", { name: "Ren’Py" })).toHaveCount(0);
  await views.getByRole("button", { name: "JSON", exact: true }).click();
  const jsonView = page.getByRole("region", { name: "JSON OP 只读视图" });
  await expect(jsonView).toBeVisible();
  await expect(jsonView).toContainText('"type": "endChapter"');
  await jsonView.getByRole("button", { name: "复制 JSON" }).click();
  await page.getByRole("button", { name: "多语言", exact: true }).click();
  await expect(page.getByRole("heading", { name: /译稿校对台/ })).toBeVisible();
  const translation = page
    .locator(".galgame-localization-target textarea")
    .first();
  await translation.fill("Continue to chapter two");
  await expect
    .poll(() =>
      JSON.stringify(
        (document.localizations as Record<string, unknown> | undefined) ?? {},
      ),
    )
    .toContain("Continue to chapter two");
  await page.reload();
  await expect(page.getByText("多章节旅程")).toBeVisible();
  await expect(page.getByRole("heading", { name: /译稿校对台/ })).toBeVisible();
  await expect(translation).toHaveValue("Continue to chapter two");
  await views.getByRole("button", { name: "卡片", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Block 卡片编辑器" }),
  ).toBeVisible();

  const workbench = page.locator(".galgame-script-workbench");
  for (const { viewport, expected } of [
    {
      viewport: { width: 2048, height: 1200 },
      expected: { left: [330, 346], center: [790, 815], right: [875, 910] },
    },
    {
      viewport: { width: 1440, height: 1000 },
      expected: { left: [230, 246], center: [555, 575], right: [610, 640] },
    },
    {
      viewport: { width: 1280, height: 800 },
      expected: { left: [202, 216], center: [492, 510], right: [548, 568] },
    },
  ]) {
    await page.setViewportSize(viewport);
    const [left, center, right] = await Promise.all(
      [
        workbench.locator(":scope > .galgame-fragment-panel"),
        workbench.locator(":scope > .galgame-block-panel"),
        workbench.locator(".galgame-preview-focus"),
      ].map((locator) => locator.boundingBox()),
    );
    expect(left?.width).toBeGreaterThanOrEqual(expected.left[0]);
    expect(left?.width).toBeLessThanOrEqual(expected.left[1]);
    expect(center?.width).toBeGreaterThanOrEqual(expected.center[0]);
    expect(center?.width).toBeLessThanOrEqual(expected.center[1]);
    expect(right?.width).toBeGreaterThanOrEqual(expected.right[0]);
    expect(right?.width).toBeLessThanOrEqual(expected.right[1]);
  }

  await page.setViewportSize({ width: 1100, height: 900 });
  const drawerToggle = page.getByRole("button", { name: "打开剧本结构" });
  await expect(drawerToggle).toBeVisible();
  await drawerToggle.click();
  await expect(
    workbench.locator(":scope > .galgame-fragment-panel"),
  ).toBeInViewport();
  await page
    .getByRole("button", { name: "关闭剧本结构" })
    .click({ position: { x: 1000, y: 400 } });

  await page.setViewportSize({ width: 900, height: 900 });
  const [structureBox, cardsBox, previewBox, inspectorBox] = await Promise.all(
    [
      workbench.locator(":scope > .galgame-fragment-panel"),
      workbench.locator(":scope > .galgame-block-panel"),
      workbench.locator(".galgame-preview-focus"),
      workbench.locator(".galgame-inspector-tabs"),
    ].map((locator) => locator.boundingBox()),
  );
  expect(structureBox?.y).toBeLessThan(cardsBox?.y ?? 0);
  expect(cardsBox?.y).toBeLessThan(previewBox?.y ?? 0);
  expect(previewBox?.y).toBeLessThan(inspectorBox?.y ?? 0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(900);
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.getByRole("button", { name: "开始试玩", exact: true }).click();
  const player = page
    .locator(".galgame-fast-preview")
    .getByRole("region", { name: "游戏预览" });
  await expect(player).toBeVisible();
  await player.getByRole("button", { name: "点击继续" }).click();
  await expect(player.getByText("欢迎来到第二章")).toBeVisible();
  await player.getByRole("button", { name: "点击继续" }).click();
  await expect(player.getByText("全篇完成")).toBeVisible();
});

test("opens Block insertion from the selected card and closes it from the outside", async ({
  page,
}) => {
  let revision = 0;
  let document = {
    schemaVersion: "1.0",
    synopsis: "",
    characters: [],
    scenes: [],
    variables: [],
    chapters: [
      {
        id: "chapter-1",
        title: "第一章",
        order: 1,
        entryFragmentId: "main",
        fragments: [
          {
            id: "main",
            title: "main",
            blocks: [
              { id: "first", type: "narration", text: "第一段" },
              { id: "second", type: "narration", text: "第二段" },
            ],
          },
        ],
      },
    ],
  };
  await page.route(
    "**/v1/galgame-workshop/projects/block-insert-project**",
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith("/story/report")) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            project_id: "block-insert-project",
            story_revision: revision,
            ready: true,
            errors: [],
            warnings: [],
            chapters: [],
          }),
        });
        return;
      }
      if (path.endsWith("/story")) {
        if (request.method() === "PUT") {
          document = request.postDataJSON().document;
          revision += 1;
        }
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            project_id: "block-insert-project",
            document,
            revision,
            updated_at: "2026-08-11T08:00:00Z",
          }),
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "block-insert-project",
          title: "Block 插入工程",
          status: "draft",
          revision: 0,
          created_at: "2026-08-11T08:00:00Z",
          updated_at: "2026-08-11T08:00:00Z",
        }),
      });
    },
  );

  await page.goto(
    "/apps/galgame-workshop/projects/block-insert-project/editor",
  );
  const editor = page.getByRole("region", { name: "Block 卡片编辑器" });
  await expect(editor).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "在这里插入 Block" }),
  ).toHaveCount(0);
  const firstCard = editor.locator('[data-block-id="first"]');
  await firstCard.click();
  await firstCard.press("Tab");
  const palette = page.getByRole("dialog", { name: "插入 Block" });
  await expect(palette).toBeVisible();
  await expect(
    palette.getByRole("button", { name: "在右侧属性中编辑" }),
  ).toBeVisible();
  const hideDialogue = palette.getByRole("button", {
    name: "本句后隐藏对话框",
  });
  await hideDialogue.click();
  await expect(palette).toBeVisible();
  await expect(hideDialogue).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => document.chapters[0].fragments[0].blocks[0].hideDialogueAfter)
    .toBe(true);
  for (const group of ["角色", "文本", "演出", "逻辑"])
    await expect(palette.getByText(group, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "插入 Block" })).toHaveCount(0);
  await expect(firstCard).toBeFocused();

  await firstCard.press("Tab");
  await page.mouse.click(4, 4);
  await expect(page.getByRole("dialog", { name: "插入 Block" })).toHaveCount(0);

  await firstCard.press("Tab");
  await page.getByLabel("搜索可插入 Block").fill("注释");
  await page.getByRole("button", { name: "注释", exact: true }).click();
  await expect
    .poll(() =>
      document.chapters[0].fragments[0].blocks.map((block) => block.type),
    )
    .toEqual(["comment", "narration", "narration"]);
});

test("edits shared boundaries and persists a ripple trim on the visual timeline", async ({
  page,
}) => {
  test.setTimeout(60_000);
  let revision = 0;
  let document = {
    schemaVersion: "1.0",
    synopsis: "",
    characters: [
      { id: "hero", name: "调查员", description: "" },
      { id: "partner", name: "助手", description: "" },
      { id: "observer", name: "观察员", description: "" },
    ],
    scenes: [{ id: "lab", name: "研究所", backgrounds: [] }],
    variables: [],
    assets: [
      {
        id: "bgm",
        type: "audio",
        role: "backgroundMusic",
        label: "完整广播剧",
        fileId: "bgm-file",
        status: "ready",
      },
      {
        id: "ambient",
        type: "audio",
        role: "ambientSound",
        label: "设备低鸣",
        fileId: "ambient-file",
        status: "ready",
      },
      {
        id: "sfx",
        type: "audio",
        role: "soundEffect",
        label: "提示音",
        fileId: "sfx-file",
        status: "ready",
      },
    ],
    chapters: [
      {
        id: "chapter-1",
        title: "第一章",
        order: 1,
        entryFragmentId: "main",
        fragments: [
          {
            id: "main",
            title: "时间轴场景",
            timeline: { durationMs: 15_000 },
            blocks: [
              {
                id: "scene",
                type: "scene",
                sceneId: "lab",
                clearCharacters: true,
              },
              {
                id: "line-one",
                type: "dialogue",
                characterId: "hero",
                text: "第一句",
                portrait: {
                  mode: "stage",
                  keepAfter: true,
                  transform: null,
                  transition: { durationMs: 0, fade: false },
                },
                startMs: 1000,
                endMs: 3000,
              },
              {
                id: "line-two",
                type: "dialogue",
                characterId: "partner",
                text: "第二句",
                portrait: {
                  mode: "stage",
                  keepAfter: true,
                  transform: null,
                  transition: { durationMs: 0, fade: false },
                },
                startMs: 3000,
                endMs: 6000,
              },
              {
                id: "line-three",
                type: "dialogue",
                characterId: "hero",
                text: "第三句",
                portrait: {
                  mode: "stage",
                  keepAfter: true,
                  transform: null,
                  transition: { durationMs: 0, fade: false },
                },
                startMs: 6500,
                endMs: 10_000,
              },
              ...["hero", "partner", "observer"].map((characterId, index) => ({
                id: `show-${characterId}`,
                type: "showCharacter",
                characterId,
                atMs: 0,
                transform: {
                  x: 25 + index * 25,
                  y: 100,
                  scale: 1,
                  brightness: 1,
                  opacity: 1,
                  flipX: false,
                  layer: 10 + index,
                },
                transition: { durationMs: 0, fade: false },
              })),
              {
                id: "play-bgm",
                type: "audio",
                action: "play",
                channel: "bgm",
                assetId: "bgm",
                volume: 100,
                loop: false,
                fadeMs: 0,
                atMs: 0,
              },
              {
                id: "play-ambient",
                type: "audio",
                action: "play",
                channel: "ambient",
                assetId: "ambient",
                volume: 60,
                loop: true,
                fadeMs: 0,
                atMs: 0,
              },
              ...["sfx-one", "sfx-two"].map((id) => ({
                id,
                type: "audio",
                action: "play",
                channel: "sfx",
                assetId: "sfx",
                volume: 100,
                loop: false,
                fadeMs: 0,
                atMs: 0,
              })),
              {
                id: "ending",
                type: "endChapter",
                endingId: "timeline-ending",
                label: "完成",
              },
            ],
          },
        ],
      },
    ],
  };

  await page.route("**/v1/files/*/content", (route) =>
    route.fulfill({
      contentType: "audio/wav",
      body: silentWav(1000),
    }),
  );
  await page.route(
    "**/v1/galgame-workshop/projects/timeline-project**",
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith("/story/report")) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            project_id: "timeline-project",
            story_revision: revision,
            ready: true,
            errors: [],
            warnings: [],
            chapters: [
              {
                chapter_id: "chapter-1",
                reachable_fragment_ids: ["main"],
                unreachable_fragment_ids: [],
                ending_ids: ["timeline-ending"],
                cycles: [],
              },
            ],
          }),
        });
        return;
      }
      if (path.endsWith("/story")) {
        if (request.method() === "PUT") {
          document = request.postDataJSON().document;
          revision += 1;
        }
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            project_id: "timeline-project",
            document,
            revision,
            updated_at: "2026-08-06T08:00:00Z",
          }),
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "timeline-project",
          title: "时间轴工程",
          status: "draft",
          revision: 0,
          created_at: "2026-08-06T08:00:00Z",
          updated_at: "2026-08-06T08:00:00Z",
        }),
      });
    },
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/apps/galgame-workshop/projects/timeline-project/editor");
  const blockEditor = page.getByRole("region", {
    name: "Block 卡片编辑器",
  });
  await expect(blockEditor).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "剧本编辑视图" })
      .getByRole("button", { name: "卡片", exact: true }),
  ).toHaveClass(/active/);
  await expect(blockEditor.getByText("第一句", { exact: true })).toBeVisible();
  await page.waitForTimeout(800);
  expect(revision).toBe(0);
  if (process.env.UPDATE_GALGAME_DOCS_SCREENSHOT === "1") {
    await page.screenshot({
      path: "public/docs/galgame-editor.jpg",
      type: "jpeg",
      quality: 90,
      animations: "disabled",
    });
  }
  await page.getByRole("button", { name: "多语言", exact: true }).click();
  await expect(page.getByRole("heading", { name: /译稿校对台/ })).toBeVisible();
  await page
    .locator(".galgame-localization-target textarea")
    .first()
    .fill("The first line");
  await expect.poll(() => revision).toBe(1);
  if (process.env.UPDATE_GALGAME_DOCS_SCREENSHOT === "1") {
    await page.screenshot({
      path: "public/docs/galgame-localization.jpg",
      type: "jpeg",
      quality: 90,
      animations: "disabled",
    });
  }
  await page.getByRole("button", { name: "卡片", exact: true }).click();
  await page.locator('[data-block-id="scene"] .galgame-block-select').click();
  await page.getByRole("button", { name: "演出", exact: true }).click();
  expect(revision).toBe(1);
  const timeline = page.getByRole("region", {
    name: "多轨剧情时间轴",
  });
  await expect(timeline).toBeVisible();
  const stickyControls = timeline.locator(".galgame-timeline-controls");
  const toolbar = timeline.locator(".galgame-timeline-toolbar");
  const advancedSettings = timeline.locator(".galgame-timeline-advanced");
  const trackScroller = timeline.locator(".galgame-timeline-scroll");
  await expect(
    page.getByRole("combobox", { name: "切换场景", exact: true }),
  ).toBeVisible();
  await expect(timeline.getByLabel("剧情段选择带")).toHaveCount(0);
  await timeline.getByRole("button", { name: /调查员 00:01\.000/ }).click();
  await expect(stickyControls.locator(":scope > *")).toHaveCount(2);
  await expect(
    stickyControls.locator(".galgame-timeline-settings-row"),
  ).toHaveCount(0);
  await expect(
    stickyControls.locator(".galgame-timeline-ruler-row"),
  ).toContainText("时间");
  await expect(stickyControls).toHaveCSS("position", "sticky");
  await expect(toolbar).toBeInViewport();
  await advancedSettings.scrollIntoViewIfNeeded();
  await expect(advancedSettings).toBeInViewport();
  await timeline.locator(".galgame-timeline-context-menu > summary").click();
  const calibration = timeline.locator(".galgame-timeline-calibration");
  await calibration.scrollIntoViewIfNeeded();
  await expect(calibration).toBeInViewport();
  await timeline.locator(".galgame-timeline-context-menu > summary").click();
  await expect(
    timeline.getByRole("button", { name: "播放编辑时间轴" }),
  ).toBeEnabled();
  await expect(timeline.getByLabel("时间轴缩放")).toBeEnabled();
  await timeline.getByRole("button", { name: "适配时间轴宽度" }).click();
  const stickyRipple = timeline.getByRole("checkbox", { name: "波纹编辑" });
  await stickyRipple.check();
  await expect(stickyRipple).toBeChecked();
  await stickyRipple.uncheck();
  await trackScroller.evaluate((element) => {
    element.scrollTop = 0;
  });
  if (process.env.UPDATE_GALGAME_DOCS_SCREENSHOT === "1") {
    await page.screenshot({
      path: "public/docs/galgame-timeline.jpg",
      type: "jpeg",
      quality: 90,
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(stickyControls).toHaveCSS("position", "static");
  await expect(timeline.getByText("时间轴试听")).toHaveCSS(
    "white-space",
    "nowrap",
  );
  await expect(
    timeline.getByRole("button", { name: "适配时间轴宽度" }),
  ).toHaveCSS("white-space", "nowrap");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(stickyControls).toHaveCSS("position", "sticky");
  const trackLabels = timeline.getByLabel("时间轴轨道");
  await expect(trackLabels).toBeVisible();
  await expect(trackLabels).toHaveCSS("position", "sticky");
  const trackLabelWidth = await trackLabels.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  const rulerLabelWidth = await timeline
    .locator(".galgame-timeline-ruler-row > strong")
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(Math.abs(trackLabelWidth - rulerLabelWidth)).toBeLessThanOrEqual(1);
  await expect(trackLabels).not.toContainText("剧情段");
  await expect(timeline.getByRole("button", { name: "结局" })).toBeVisible();
  const performanceDetails = timeline.getByRole("checkbox", {
    name: "演出细节",
  });
  await expect(performanceDetails).not.toBeChecked();
  await expect(
    timeline.getByRole("button", { name: /登场 · 调查员/ }),
  ).toBeVisible();
  await performanceDetails.check();
  await expect(trackLabels).toContainText("调查员");
  await expect(trackLabels).toContainText("助手");
  await expect(trackLabels).toContainText("观察员");
  await expect(
    timeline.getByRole("button", { name: /登场 · 调查员/ }),
  ).toBeVisible();
  await expect(
    timeline.getByRole("button", { name: /登场 · 助手/ }),
  ).toBeVisible();
  await expect(
    timeline.getByRole("button", { name: /登场 · 观察员/ }),
  ).toBeVisible();
  await performanceDetails.uncheck();
  await expect(trackLabels).not.toContainText("调查员");
  await expect(
    timeline.getByRole("button", { name: /登场 · 调查员/ }),
  ).toBeVisible();
  await expect(
    timeline.getByRole("button", { name: /完整广播剧/ }),
  ).toBeVisible();
  await expect(
    timeline.getByRole("button", { name: /设备低鸣/ }),
  ).toBeVisible();
  await expect(timeline.getByRole("button", { name: /提示音/ })).toHaveCount(2);
  const playheadAdd = page.getByRole("button", {
    name: "在播放头添加内容",
  });
  await expect(playheadAdd).toBeVisible();
  await expect(playheadAdd).toContainText("00:01.000");
  const timeArea = timeline.locator(".galgame-timeline-time-area");
  const timeAreaBox = await timeArea.boundingBox();
  await timeArea.dispatchEvent("contextmenu", {
    clientX: (timeAreaBox?.x ?? 0) + 120,
  });
  await expect(page.locator(".galgame-playhead-add-menu")).toHaveAttribute(
    "open",
    "",
  );
  await playheadAdd.click();
  await timeline.getByLabel("精确设置").click();
  await expect(
    timeline.locator(".galgame-timeline-lengths > span"),
  ).toHaveCount(0);
  await expect(
    timeline.getByRole("textbox", { name: "剧情时间轴总长" }),
  ).toHaveValue("00:15.000");
  const leadingGap = timeline.getByRole("button", {
    name: "无对白 00:00.000 到 00:01.000",
  });
  await expect(leadingGap).toBeVisible();
  await leadingGap.click();
  await expect(page.getByText("开场无对白")).toBeVisible();
  const gapEndTime = page.getByRole("textbox", {
    name: "无对白结束时间",
  });
  await gapEndTime.fill("00:01.500");
  await gapEndTime.press("Enter");
  await expect.poll(() => revision, { timeout: 3000 }).toBeGreaterThan(1);
  expect(document.chapters[0].fragments[0].blocks[1].startMs).toBe(1500);

  await page.reload();
  const reloadedTimeline = page.getByRole("region", {
    name: "多轨剧情时间轴",
  });
  await reloadedTimeline.getByLabel("精确设置").click();
  await expect(
    reloadedTimeline.getByRole("button", {
      name: "无对白 00:00.000 到 00:01.500",
    }),
  ).toBeVisible();
  const firstCue = timeline.getByRole("button", {
    name: /调查员 00:01\.500/,
  });
  await expect(firstCue).toBeVisible();
  await expect(
    timeline.getByRole("button", { name: /助手 00:03\.000/ }),
  ).toBeVisible();
  await firstCue.click();
  await page.locator(".galgame-dialogue-advanced-settings > summary").click();

  const revisionBeforeBoundary = revision;
  const endTime = page.getByRole("textbox", { name: "对白结束时间" });
  await endTime.fill("00:03.500");
  await endTime.press("Enter");
  await expect
    .poll(() => revision, { timeout: 3000 })
    .toBeGreaterThan(revisionBeforeBoundary);
  const blocks = document.chapters[0].fragments[0].blocks;
  expect(blocks[1].endMs).toBe(3500);
  expect(blocks[2].startMs).toBe(3500);

  await timeline.getByRole("checkbox", { name: "波纹编辑" }).check();
  const revisionBeforeRipple = revision;
  await endTime.fill("00:10.000");
  await endTime.press("Enter");
  await expect
    .poll(() => revision, { timeout: 3000 })
    .toBeGreaterThan(revisionBeforeRipple);
  const rippleBlocks = document.chapters[0].fragments[0].blocks;
  expect(rippleBlocks[1]).toMatchObject({ startMs: 1500, endMs: 10_000 });
  expect(rippleBlocks[2]).toMatchObject({ startMs: 10_000, endMs: 12_500 });
  expect(rippleBlocks[3]).toMatchObject({ startMs: 13_000, endMs: 16_500 });
  expect(document.chapters[0].fragments[0].timeline.durationMs).toBe(21_500);
  await expect(
    timeline.getByRole("textbox", { name: "剧情时间轴总长" }),
  ).toHaveValue("00:21.500");

  await page.reload();
  const persistedTimeline = page.getByRole("region", {
    name: "多轨剧情时间轴",
  });
  await expect(
    persistedTimeline.getByRole("button", {
      name: /调查员 00:01\.500 到 00:10\.000/,
    }),
  ).toBeVisible();
  await expect(
    persistedTimeline.getByRole("button", {
      name: /助手 00:10\.000 到 00:12\.500/,
    }),
  ).toBeVisible();
  await expect(
    persistedTimeline.getByRole("button", {
      name: /调查员 00:13\.000 到 00:16\.500/,
    }),
  ).toBeVisible();

  await page
    .getByRole("navigation", { name: "剧本编辑视图" })
    .getByRole("button", { name: "卡片", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Block 卡片编辑器" }),
  ).toBeVisible();
  await expect(page.getByText(/精确演出 00:21\.500/)).toHaveCount(1);
  await page.getByRole("button", { name: "演出", exact: true }).click();

  const player = page.getByRole("region", { name: "游戏预览" });
  await page
    .getByRole("navigation", { name: "预览模式" })
    .getByRole("button", { name: "试玩", exact: true })
    .click();
  await player.getByRole("button", { name: "开始试玩", exact: true }).click();
  const progress = player.getByRole("slider", { name: "剧情时间轴进度" });
  await expect(progress).toBeVisible();
  await expect(player.getByLabel("试玩控制")).toBeVisible();
  const followedTimeline = page.getByRole("region", {
    name: "试玩剧情时间轴",
  });
  await expect(followedTimeline.getByText("跟随试玩")).toBeVisible();
  await expect(
    followedTimeline.getByRole("button", { name: "播放编辑时间轴" }),
  ).toHaveCount(0);
  await expect(
    followedTimeline.getByRole("checkbox", { name: "波纹编辑" }),
  ).toHaveCount(0);
  await expect(followedTimeline.getByLabel("精确设置")).toHaveCount(0);
  await expect(
    followedTimeline.getByRole("button", { name: "在播放头添加内容" }),
  ).toHaveCount(0);
  await player.getByRole("button", { name: "暂停时间轴" }).click();
  await progress.evaluate((element) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, "13000");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(progress).toHaveValue("13000");
  await expect(player.getByText("第三句")).toBeVisible();
  await expect(player.locator('[data-character-id="hero"]')).toBeVisible();
  await expect(player.locator('[data-character-id="partner"]')).toBeVisible();
  await expect(player.locator('[data-character-id="observer"]')).toBeVisible();
});
