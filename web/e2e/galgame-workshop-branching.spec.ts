import { expect, test, type Page } from "@playwright/test";

async function expectOfficialScriptGeometry(
  page: Page,
  viewport: { width: number; height: number },
  expected: {
    left: [number, number];
    center: [number, number];
    right: [number, number];
  },
) {
  await page.setViewportSize(viewport);
  const grid = page.locator(".galgame-script-workbench");
  const left = grid.locator(":scope > .galgame-fragment-panel");
  const center = grid.locator(":scope > .galgame-block-panel");
  const preview = grid.locator(".galgame-preview-focus");
  await expect(grid).toBeVisible();

  const bounds = await Promise.all(
    [grid, left, center, preview].map((locator) => locator.boundingBox()),
  );
  const [gridBounds, leftBounds, centerBounds, previewBounds] = bounds;
  expect(gridBounds).not.toBeNull();
  expect(leftBounds?.width).toBeGreaterThanOrEqual(expected.left[0]);
  expect(leftBounds?.width).toBeLessThanOrEqual(expected.left[1]);
  expect(centerBounds?.width).toBeGreaterThanOrEqual(expected.center[0]);
  expect(centerBounds?.width).toBeLessThanOrEqual(expected.center[1]);
  expect(previewBounds?.width).toBeGreaterThanOrEqual(expected.right[0]);
  expect(previewBounds?.width).toBeLessThanOrEqual(expected.right[1]);
  expect(
    (previewBounds?.height ?? 0) / (gridBounds?.height ?? 1),
  ).toBeGreaterThanOrEqual(0.58);
  expect(
    (previewBounds?.height ?? 0) / (gridBounds?.height ?? 1),
  ).toBeLessThanOrEqual(0.62);

  const dialogueHeight = await grid
    .locator(".galgame-dialogue-card:not(.is-editing)")
    .first()
    .evaluate((element) => element.getBoundingClientRect().height);
  const sceneHeight = await grid
    .locator(".galgame-block-card.is-scene .galgame-block-select")
    .first()
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(dialogueHeight).toBeGreaterThanOrEqual(48);
  expect(dialogueHeight).toBeLessThanOrEqual(54);
  expect(sceneHeight).toBeGreaterThanOrEqual(76);
  expect(sceneHeight).toBeLessThanOrEqual(88);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(viewport.width);
}

async function openAssetSection(page: Page, section: string) {
  await page
    .getByRole("navigation", { name: "创作工作区" })
    .getByRole("button", { name: "资产", exact: true })
    .click();
  await page
    .locator(".galgame-asset-center > aside")
    .getByRole("button", { name: section, exact: true })
    .click();
}

test("builds, saves, checks, and plays a branching Galgame slice", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10000);
  let projects: Array<Record<string, unknown>> = [];
  let storyRevision = 0;
  let projectAssets: Array<Record<string, unknown>> = [];
  let includeOverviewLayoutFixtures = false;
  const overviewLayoutFixtures = Array.from({ length: 30 }, (_, index) => ({
    id: `overview-layout-${index}`,
    display_name: `overview-layout-${String(index).padStart(2, "0")}.png`,
    media_kind: "image",
    mime_type: "image/png",
    byte_size: 68,
    revision: 0,
    created_at: "2026-08-05T08:00:00Z",
    updated_at: "2026-08-05T08:00:00Z",
    orphaned: index % 5 === 0,
  }));
  let document: Record<string, unknown> = {
    schemaVersion: "1.0",
    synopsis: "",
    characters: [],
    scenes: [],
    variables: [],
    assets: [],
    chapters: [
      {
        id: "chapter-1",
        title: "第一章",
        order: 1,
        entryFragmentId: "main",
        fragments: [{ id: "main", title: "main", blocks: [] }],
      },
    ],
  };

  const report = () => {
    const chapter = (document.chapters as Array<Record<string, unknown>>)[0];
    const fragments = chapter.fragments as Array<Record<string, unknown>>;
    const main = fragments.find((fragment) => fragment.id === "main");
    const mainBlocks = (main?.blocks ?? []) as Array<Record<string, unknown>>;
    const branch = mainBlocks.find((block) => block.type === "branch");
    const endingFragments = fragments.filter((fragment) =>
      ((fragment.blocks ?? []) as Array<Record<string, unknown>>).some(
        (block) => block.type === "endChapter",
      ),
    );
    const ready = Boolean(branch) && endingFragments.length === 2;
    return {
      project_id: "e2e-galgame",
      story_revision: storyRevision,
      ready,
      errors: ready
        ? []
        : [
            {
              code: "open_fragment",
              message: "线路尚未完成",
              path: "/chapters/0/fragments/0",
              fragment_id: "main",
            },
          ],
      warnings: [],
      chapters: [
        {
          chapter_id: "chapter-1",
          reachable_fragment_ids: ready
            ? fragments.map((fragment) => fragment.id)
            : ["main"],
          unreachable_fragment_ids: [],
          ending_ids: endingFragments.map((fragment) => String(fragment.id)),
          cycles: [],
        },
      ],
    };
  };

  await page.route("**/v1/file-folders**", (route) =>
    route.fulfill({ contentType: "application/json", body: '{"items":[]}' }),
  );
  await page.route("**/v1/files**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/content")) {
      await route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "global-expression",
            project_id: null,
            folder_id: null,
            original_filename: "smile.png",
            display_name: "微笑.png",
            media_kind: "image",
            mime_type: "image/png",
            byte_size: 68,
            revision: 0,
            created_at: "2026-08-05T08:00:00Z",
            updated_at: "2026-08-05T08:00:00Z",
            source: "library",
            is_reference: false,
            reference_id: null,
          },
          {
            id: "global-background",
            project_id: null,
            folder_id: null,
            original_filename: "rainy-night.png",
            display_name: "雨夜.png",
            media_kind: "image",
            mime_type: "image/png",
            byte_size: 68,
            revision: 0,
            created_at: "2026-08-05T08:00:00Z",
            updated_at: "2026-08-05T08:00:00Z",
            source: "library",
            is_reference: false,
            reference_id: null,
          },
        ],
      }),
    });
  });

  await page.route("**/v1/galgame-workshop/projects**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.includes("/assets/") && request.method() === "DELETE") {
      const assetId = path.split("/").at(-1);
      projectAssets = projectAssets.filter((asset) => asset.id !== assetId);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ deleted: true }),
      });
      return;
    }
    if (path.endsWith("/assets/package-manifest")) {
      const sourceAssets = includeOverviewLayoutFixtures
        ? [...projectAssets, ...overviewLayoutFixtures]
        : projectAssets;
      const packagedAssets = sourceAssets.filter((asset) => !asset.orphaned);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ready: true,
          totalBytes: packagedAssets.reduce(
            (sum, asset) => sum + Number(asset.byte_size ?? 0),
            0,
          ),
          items: packagedAssets.map((asset) => ({
            assetId: asset.id,
            virtualPath: `assets/${asset.display_name}`,
            byteSize: asset.byte_size,
            reason: "referenced",
          })),
          issues: [],
        }),
      });
      return;
    }
    if (path.endsWith("/assets/overview")) {
      const sourceAssets = includeOverviewLayoutFixtures
        ? [...projectAssets, ...overviewLayoutFixtures]
        : projectAssets;
      const items = sourceAssets.map((asset) => {
        const audio = asset.media_kind === "audio";
        const orphaned = Boolean(asset.orphaned);
        const category = audio
          ? "bgm"
          : String(asset.display_name).includes("research")
            ? "scene"
            : "character";
        return {
          ...asset,
          category,
          virtualPath: `${category}/${asset.display_name}`,
          packagingPolicy: "auto",
          missing: false,
          orphaned,
          reference_count: orphaned ? 0 : 1,
          references: [],
          transcriptRevision: 0,
          transcriptStatus: "pending",
        };
      });
      const totalBytes = items.reduce(
        (sum, asset) => sum + Number(asset.byte_size ?? 0),
        0,
      );
      const estimatedPackageBytes = items
        .filter((asset) => !asset.orphaned)
        .reduce((sum, asset) => sum + Number(asset.byte_size ?? 0), 0);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          items,
          missing_items: [],
          totalBytes,
          referencedCount: items.filter((asset) => !asset.orphaned).length,
          orphanedCount: items.filter((asset) => asset.orphaned).length,
          estimatedPackageBytes,
          largestAssetIds: items.map((asset) => asset.id),
          moduleHealth: { character: "ready", scene: "ready", bgm: "ready" },
        }),
      });
      return;
    }
    if (path.endsWith("/assets/batch") && request.method() === "POST") {
      const uploaded = {
        id: `private-portrait-${projectAssets.length}`,
        display_name: "galgame-workshop-mark.png",
        media_kind: "image",
        mime_type: "image/png",
        byte_size: 128,
        revision: 0,
        created_at: "2026-08-05T08:00:00Z",
        updated_at: "2026-08-05T08:00:00Z",
      };
      projectAssets = [...projectAssets, uploaded];
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          items: [uploaded],
          importItems: [
            {
              originalName: uploaded.display_name,
              finalName: uploaded.display_name,
              virtualPath: `characters/${uploaded.display_name}`,
              reasons: [],
            },
          ],
        }),
      });
      return;
    }
    if (path.endsWith("/assets")) {
      if (request.method() === "POST") {
        const uploadKind =
          ["portrait", "background", "bgm", "voice", "interface"][
            projectAssets.length
          ] ?? `interface-${projectAssets.length}`;
        const audio = uploadKind === "bgm" || uploadKind === "voice";
        const uploaded = {
          id: `private-${uploadKind}`,
          display_name:
            uploadKind === "portrait"
              ? "galgame-workshop-mark.png"
              : uploadKind === "background"
                ? "research-lab.png"
                : uploadKind === "bgm"
                  ? "rainy-cafe.mp3"
                  : uploadKind === "voice"
                    ? "dialogue-line.mp3"
                    : "date-hud.png",
          media_kind: audio ? "audio" : "image",
          mime_type: audio ? "audio/mpeg" : "image/png",
          byte_size: 128,
          revision: 0,
          created_at: "2026-08-05T08:00:00Z",
          updated_at: "2026-08-05T08:00:00Z",
        };
        projectAssets = [...projectAssets, uploaded];
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(uploaded),
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ items: projectAssets }),
      });
      return;
    }
    if (path.endsWith("/story/report")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(report()),
      });
      return;
    }
    if (path.endsWith("/story")) {
      if (request.method() === "PUT") {
        const body = request.postDataJSON() as {
          document: Record<string, unknown>;
        };
        document = body.document;
        storyRevision += 1;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          project_id: "e2e-galgame",
          document,
          revision: storyRevision,
          updated_at: "2026-08-05T08:00:00Z",
        }),
      });
      return;
    }
    const id = path.split("/").at(-1);
    if (request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          id === "projects"
            ? { items: projects }
            : projects.find((project) => project.id === id),
        ),
      });
      return;
    }
    if (request.method() === "POST") {
      const body = request.postDataJSON() as { title: string };
      const project = {
        id: "e2e-galgame",
        title: body.title,
        status: "draft",
        revision: 0,
        created_at: "2026-08-05T08:00:00Z",
        updated_at: "2026-08-05T08:00:00Z",
      };
      projects = [project];
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(project),
      });
      return;
    }
    if (request.method() === "PATCH") {
      const body = request.postDataJSON() as Record<string, unknown>;
      projects = projects.map((project) =>
        project.id === id
          ? { ...project, ...body, revision: Number(project.revision) + 1 }
          : project,
      );
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(projects.find((project) => project.id === id)),
      });
      return;
    }
    projects = projects.filter((project) => project.id !== id);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ deleted: true }),
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/apps/galgame-workshop");
  await page.getByRole("button", { name: /新建第一个工程/ }).click();
  await expect(page).toHaveURL(
    /\/apps\/galgame-workshop\/projects\/e2e-galgame\/overview$/,
  );
  await expect(page.locator(".workshop-sidebar")).toBeVisible();
  await expect(page.getByRole("button", { name: "标记完成" })).toBeDisabled();
  await page.getByRole("button", { name: /剧本编辑/ }).click();
  await expect(page).toHaveURL(/\/editor$/);
  await expect(page.locator(".workshop-sidebar")).toHaveCount(0);
  await expect(page.locator(".galgame-editor-grid")).toBeVisible();

  includeOverviewLayoutFixtures = true;
  await openAssetSection(page, "资源总览");
  await expect(page.getByText(/共 30 项 · 6 项游离/)).toBeVisible();
  const resourceResults = page.locator(".galgame-assets-results");
  const resourceCards = resourceResults.locator(":scope > button");
  await expect(resourceCards).toHaveCount(30);
  const gridCardHeight = await resourceCards
    .first()
    .evaluate((element) => element.getBoundingClientRect().height);
  const gridCardWidth = await resourceCards
    .first()
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(gridCardHeight).toBeGreaterThan(160);
  expect(gridCardWidth).toBeLessThan(210);
  await expect(page.getByLabel("卡片大小")).toHaveCount(0);
  expect(
    await resourceResults.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);

  const summary = page.getByRole("region", { name: "资源统计" });
  const summaryDivider = page.getByRole("separator", {
    name: "调整资源统计与资源列表高度",
  });
  const summaryBeforeResize = await summary.boundingBox();
  const summaryDividerBounds = await summaryDivider.boundingBox();
  expect(summaryBeforeResize).not.toBeNull();
  expect(summaryDividerBounds).not.toBeNull();
  await page.mouse.move(
    summaryDividerBounds!.x + summaryDividerBounds!.width / 2,
    summaryDividerBounds!.y + summaryDividerBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    summaryDividerBounds!.x + summaryDividerBounds!.width / 2,
    summaryDividerBounds!.y + summaryDividerBounds!.height / 2 + 40,
  );
  await page.mouse.up();
  const summaryAfterResize = await summary.boundingBox();
  expect(summaryAfterResize?.height).toBeGreaterThan(
    (summaryBeforeResize?.height ?? 0) + 30,
  );
  await summaryDivider.dblclick();

  await page.getByRole("button", { name: "列表视图" }).click();
  const listRowHeight = await resourceCards
    .first()
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(listRowHeight).toBeGreaterThanOrEqual(60);
  await page
    .getByRole("button", { name: /overview-layout-00.png，游离/ })
    .click();
  await expect(
    page.getByRole("complementary", { name: "资源详情" }),
  ).toContainText("overview-layout-00.png");
  await page.getByRole("button", { name: "关闭资源详情" }).click();
  includeOverviewLayoutFixtures = false;

  await openAssetSection(page, "角色");
  await expect(page.getByRole("button", { name: "位置与尺寸" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "资源引用", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "位置与尺寸" }).click();
  await expect(
    page.getByRole("application", { name: "位置与尺寸舞台预览" }),
  ).toBeVisible();
  await expect(page.locator(".galgame-character-reference-panel")).toBeHidden();
  await page.setViewportSize({ width: 2048, height: 1200 });
  const wideStagePanels = await Promise.all(
    ["is-presets", "is-position", "is-size"].map((className) =>
      page.locator(`.galgame-stage-parameter-panel.${className}`).boundingBox(),
    ),
  );
  expect(wideStagePanels.every(Boolean)).toBe(true);
  expect(wideStagePanels[0]?.y).toBe(wideStagePanels[1]?.y);
  expect(wideStagePanels[1]?.y).toBe(wideStagePanels[2]?.y);
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.getByRole("button", { name: "角色详情", exact: true }).click();
  const compactStagePanels = await Promise.all(
    ["is-presets", "is-position", "is-size"].map((className) =>
      page.locator(`.galgame-stage-parameter-panel.${className}`).boundingBox(),
    ),
  );
  expect(compactStagePanels.every(Boolean)).toBe(true);
  for (const panel of compactStagePanels) {
    expect(panel!.width).toBeGreaterThan(100);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(1200);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "新建角色" }).click();
  await expect(page.getByText("选择一个表情查看详情")).toBeVisible();
  await page.getByRole("button", { name: "显示名" }).click();
  await page
    .getByRole("textbox", { name: "角色名称", exact: true })
    .fill("调查员");
  await page.getByRole("button", { name: "表情资源" }).click();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "批量导入", exact: true }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles("public/brand/galgame-workshop-mark.png");
  await expect(
    page.getByRole("button", { name: /galgame-workshop-mark/ }),
  ).toBeVisible({ timeout: 3000 });
  await expect(page.getByText("舞台显示", { exact: true })).toBeVisible();
  await expect(page.getByText("呈现方式", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Spine" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Live2D" })).toBeDisabled();
  await page
    .locator("label.galgame-expression-setting-toggle")
    .filter({ hasText: "左右翻转" })
    .click();
  await page.getByRole("button", { name: "自定义" }).click();
  await page.getByRole("spinbutton", { name: "自定义画面高度" }).fill("135");
  await expect.poll(() => JSON.stringify(document)).toContain('"flipX":true');
  await expect
    .poll(() => JSON.stringify(document))
    .toContain('"heightPercent":135');
  await page.getByText("高级设置", { exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "缩略图裁剪 X" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "替换图片" }).click();
  const replacePicker = page.getByRole("dialog", { name: "替换角色立绘" });
  await replacePicker.getByRole("button", { name: "全局文件库" }).click();
  await replacePicker.getByRole("button", { name: /雨夜.png/ }).click();
  await page.getByRole("button", { name: "添加表情" }).click();
  const assetPicker = page.getByRole("dialog", { name: "添加角色表情" });
  await assetPicker.getByRole("button", { name: "全局文件库" }).click();
  await assetPicker.getByRole("button", { name: /微笑.png/ }).click();
  await page.getByRole("button", { name: "新建角色" }).click();
  await page.getByRole("button", { name: "显示名" }).click();
  await page
    .getByRole("textbox", { name: "角色名称", exact: true })
    .fill("助手");
  await openAssetSection(page, "场景");
  await page.getByRole("button", { name: "新建场景" }).click();
  await page
    .getByRole("textbox", { name: "场景名称", exact: true })
    .fill("夜间研究所");
  const backgroundChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入图片" }).click();
  const backgroundChooser = await backgroundChooserPromise;
  await backgroundChooser.setFiles("public/brand/galgame-workshop-mark.png");
  await expect(
    page.locator(".galgame-visual-stage-panel > header").getByText(/1 层/),
  ).toBeVisible({
    timeout: 3000,
  });
  await page.getByRole("button", { name: "素材库添加" }).click();
  const backgroundPicker = page.getByRole("dialog", {
    name: "添加场景图层",
  });
  await backgroundPicker.getByRole("button", { name: "全局文件库" }).click();
  await backgroundPicker.getByRole("button", { name: /雨夜.png/ }).click();
  await page.getByRole("button", { name: "剧情 CG" }).click();
  await page.getByRole("button", { name: "新建 CG" }).click();
  await page.getByRole("button", { name: "添加差分" }).click();
  const cgPicker = page.getByRole("dialog", { name: "添加 CG 差分" });
  await cgPicker.getByRole("button", { name: "全局文件库" }).click();
  await cgPicker.getByRole("button", { name: /雨夜.png/ }).click();
  await expect(
    page.getByRole("button", { name: "设为默认差分 雨夜" }),
  ).toBeDisabled({ timeout: 3000 });

  await openAssetSection(page, "BGM");
  await page.getByRole("button", { name: "导入", exact: true }).click();
  const audioPicker = page.getByRole("dialog", { name: "添加背景音乐" });
  const bgmChooserPromise = page.waitForEvent("filechooser");
  await audioPicker.getByRole("button", { name: "上传声音" }).click();
  const bgmChooser = await bgmChooserPromise;
  await bgmChooser.setFiles({
    name: "rainy-cafe.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.from("ID3-e2e-bgm"),
  });
  await expect(
    page.getByRole("button", { name: "选择声音 rainy-cafe" }),
  ).toBeVisible({ timeout: 3000 });
  await openAssetSection(page, "资源总览");
  await expect(page.getByText(/共 3 项 · 0 项游离/)).toBeVisible();
  const resourceFilters = page.getByRole("complementary", {
    name: "资源筛选",
  });
  await resourceFilters.getByRole("button", { name: /音频/ }).click();
  await expect(
    page.getByRole("button", { name: /rainy-cafe.mp3，1 处引用/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "列表视图" }).click();
  await page.getByRole("button", { name: /rainy-cafe.mp3，1 处引用/ }).click();
  await expect(
    page.getByRole("complementary", { name: "资源详情" }),
  ).toContainText("rainy-cafe.mp3");
  await page.getByRole("button", { name: "关闭资源详情" }).click();
  if (process.env.FPL_CAPTURE_SCREENSHOTS === "1") {
    await page.screenshot({
      path: testInfo.outputPath("galgame-assets-overview-1440x1000.png"),
    });
    await page.setViewportSize({ width: 2048, height: 1200 });
    await page.screenshot({
      path: testInfo.outputPath("galgame-assets-overview-2048x1200.png"),
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await page.getByRole("button", { name: "剧本", exact: true }).click();
  await page.getByRole("button", { name: "演出", exact: true }).click();
  const addAtPlayhead = async (name: string | RegExp) => {
    const menu = page.locator(".galgame-playhead-add-menu");
    if ((await menu.getAttribute("open")) === null) {
      await menu.getByRole("button", { name: "在播放头添加内容" }).click();
    }
    const popover = page.getByLabel("可添加内容");
    const target =
      typeof name === "string"
        ? popover.getByRole("button", { name, exact: true })
        : popover.getByRole("button", { name });
    await target.click();
  };

  await page.getByRole("button", { name: "Fragment", exact: true }).click();
  await addAtPlayhead(/章节结局/);
  await page.getByLabel("结局名称").fill("设备结局");
  await page.getByRole("button", { name: "Fragment", exact: true }).click();
  await addAtPlayhead(/章节结局/);
  await page.getByLabel("结局名称").fill("时钟结局");

  await page
    .getByRole("button", { name: "展开第一章片段", exact: true })
    .click();
  await page.getByRole("button", { name: /main/ }).click();
  await addAtPlayhead(/场景/);
  await addAtPlayhead(/显示 CG/);
  await page.getByLabel("CG 显示模式").click();
  await page.getByRole("option", { name: "叠加 CG" }).click();
  await page.getByLabel("CG X 位置数值").fill("35");
  await page.getByLabel("CG Y 位置数值").fill("42");
  await page.getByLabel("CG 画面宽度数值").fill("68");
  await page.getByRole("textbox", { name: "CG 结束时间" }).fill("00:03.000");
  await page.getByRole("textbox", { name: "CG 结束时间" }).press("Enter");
  await addAtPlayhead(/角色登场 \/ 调整/);
  await page.getByLabel("角色位置预设").click();
  await page.getByRole("option", { name: /^左(?: ✓)?$/ }).click();
  await addAtPlayhead(/角色登场 \/ 调整/);
  await page.getByLabel("登场或调整角色").click();
  await page.getByRole("option", { name: "助手" }).click();
  await page.getByLabel("角色位置预设").click();
  await page.getByRole("option", { name: /^右(?: ✓)?$/ }).click();
  await page.getByRole("slider", { name: "角色亮度", exact: true }).fill("0.8");
  await page.getByRole("slider", { name: "角色层级", exact: true }).fill("20");
  await addAtPlayhead("背景音乐");
  await addAtPlayhead(/旁白/);
  await page.getByLabel("旁白正文").fill("研究所只剩下应急灯。");
  await addAtPlayhead(/对白/);
  await page.locator("summary", { hasText: "高级设置" }).click();
  const dialogueEditor = page.getByLabel("对白正文");
  await dialogueEditor.fill("线索只允许一次选择。");
  await dialogueEditor.click();
  await dialogueEditor.press("ControlOrMeta+A");
  await expect(page.getByLabel("文字排版工具条")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  const editorBounds = await dialogueEditor
    .locator("..")
    .evaluate((element) => element.getBoundingClientRect().toJSON());
  const toolbarBounds = await page
    .getByLabel("文字排版工具条")
    .evaluate((element) => element.getBoundingClientRect().toJSON());
  expect(toolbarBounds.right).toBeLessThanOrEqual(editorBounds.right + 1);
  expect(toolbarBounds.left).toBeGreaterThanOrEqual(editorBounds.left - 1);
  await page
    .getByRole("group", { name: "同时说话角色" })
    .getByRole("checkbox", { name: "助手" })
    .check();
  await page.getByRole("button", { name: "手动选择…" }).click();
  const voicePicker = page.getByRole("dialog", { name: "选择对白配音" });
  await expect(voicePicker).toBeVisible();
  const pickerCoversEditorChrome = await page.evaluate(() => {
    const backdrop = document.querySelector(".galgame-asset-picker-backdrop");
    const toolbar = document.querySelector(".galgame-block-toolbar");
    const editorHeader = document.querySelector(".galgame-editor-header");
    if (!(backdrop instanceof HTMLElement)) return false;
    return [toolbar, editorHeader].every((element) => {
      if (!(element instanceof HTMLElement)) return false;
      const bounds = element.getBoundingClientRect();
      const topmost = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
      return topmost === backdrop || backdrop.contains(topmost);
    });
  });
  expect(pickerCoversEditorChrome).toBe(true);
  await voicePicker.getByRole("button", { name: "关闭声音选择器" }).click();
  const voiceChooserPromise = page.waitForEvent("filechooser");
  await page.locator("summary", { hasText: "更多语音设置" }).click();
  await page.getByRole("button", { name: "上传配音" }).click();
  const voiceChooser = await voiceChooserPromise;
  await voiceChooser.setFiles({
    name: "dialogue-line.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.from("ID3-e2e-voice"),
  });
  await expect(page.getByText("dialogue-line").first()).toBeVisible({
    timeout: 3000,
  });
  await page.getByLabel("对白表情").click();
  await page
    .locator('[role="listbox"]:visible')
    .getByRole("option", { name: "微笑" })
    .click();
  await addAtPlayhead("停止背景音乐");
  await addAtPlayhead(/分支/);
  await page.getByLabel("选项 1 文案").fill("检查设备");
  await page.getByLabel("选项 2 文案").fill("检查时钟");
  await expect(page.getByText("已保存")).toBeVisible({ timeout: 3000 });

  await page.getByRole("button", { name: "样式", exact: true }).click();
  await page.getByRole("button", { name: "添加组件" }).click();
  await page.getByLabel("组件 1 名称").fill("实验状态条");
  const componentChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "上传实验状态条" }).click();
  const componentChooser = await componentChooserPromise;
  await componentChooser.setFiles("public/brand/galgame-workshop-mark.png");
  await expect(
    page.getByRole("button", { name: "替换实验状态条" }),
  ).toBeVisible({ timeout: 3000 });

  await page.getByRole("button", { name: "试玩", exact: true }).click();
  const player = page.getByRole("region", { name: "游戏预览" });
  const advanceDialogue = async (name: RegExp) => {
    const dialogue = player.getByRole("button", { name });
    await dialogue.click();
    if (await dialogue.isVisible().catch(() => false)) await dialogue.click();
  };
  await player.getByRole("button", { name: "开始试玩", exact: true }).click();
  await expect(player.locator(".galgame-player-background")).toHaveCount(2);
  await expect(
    player.locator(".galgame-player-background").first(),
  ).toBeVisible();
  const overlayCg = player.locator(
    '.galgame-player-cg[data-display-mode="overlay"]',
  );
  await expect(overlayCg).toBeVisible();
  await expect(overlayCg).toHaveCSS("left", /.+/);
  await expect(player.locator(".galgame-player-ui-component")).toBeVisible();
  await expect(player.locator(".galgame-stage-actor")).toHaveCount(2);
  const dialogueLayer = await player
    .locator(".galgame-dialogue-box")
    .evaluate((element) => Number(getComputedStyle(element).zIndex));
  const actorLayers = await player
    .locator(".galgame-stage-actor")
    .evaluateAll((elements) =>
      elements.map((element) => Number(getComputedStyle(element).zIndex)),
    );
  const cgLayer = await overlayCg.evaluate((element) =>
    Number(getComputedStyle(element).zIndex),
  );
  expect(cgLayer).toBeGreaterThan(Math.max(...actorLayers));
  expect(dialogueLayer).toBeGreaterThan(Math.max(...actorLayers));
  await advanceDialogue(/研究所只剩下应急灯/);
  await expect(player.getByText("调查员、助手")).toBeVisible();
  await expect(player.locator(".galgame-player-portrait-image")).toBeVisible();
  await advanceDialogue(/线索只允许一次选择/);
  await player.getByRole("button", { name: "检查设备" }).click();
  await player.getByRole("button", { name: "点击继续" }).click();
  await expect(player.getByText("设备结局")).toBeVisible();
  await player.getByRole("button", { name: "重新开始", exact: true }).click();
  await advanceDialogue(/研究所只剩下应急灯/);
  await advanceDialogue(/线索只允许一次选择/);
  await player.getByRole("button", { name: "检查时钟" }).click();
  await player.getByRole("button", { name: "点击继续" }).click();
  await expect(player.getByText("时钟结局")).toBeVisible();

  await page.getByRole("button", { name: /main/ }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: /新剧情 CG 00:00.000 到 00:03.000/,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /rainy-cafe 00:/ }).click();
  await page.getByRole("button", { name: "删除事件" }).click();
  await openAssetSection(page, "BGM");
  await page.getByRole("button", { name: "选择声音 rainy-cafe" }).click();
  await page.getByRole("button", { name: "删除BGM" }).click();
  await expect(page.getByText("rainy-cafe", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "剧本", exact: true }).click();

  await page.getByRole("button", { name: "检查", exact: true }).click();
  await expect(page.getByText("线路检查通过")).toBeVisible();
  await expect(
    page.locator(".galgame-inspector-metrics").getByText("3", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "查看完整报告" }).click();
  let routeDialog = page.getByRole("dialog", { name: "工程检查" });
  await expect(routeDialog).toContainText("3/3 可达 · 2 个结局");
  await expect(routeDialog).toContainText("检查结果0 项");
  await routeDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(routeDialog).toBeHidden();

  await page.getByRole("button", { name: "属性", exact: true }).click();
  await page
    .getByRole("navigation", { name: "剧本编辑视图" })
    .getByRole("button", { name: "卡片", exact: true })
    .click();
  await expectOfficialScriptGeometry(
    page,
    { width: 2048, height: 1200 },
    { left: [330, 346], center: [790, 815], right: [875, 910] },
  );
  await expectOfficialScriptGeometry(
    page,
    { width: 1440, height: 1000 },
    { left: [230, 246], center: [555, 575], right: [610, 640] },
  );
  await page.getByRole("button", { name: "检查", exact: true }).click();

  for (const viewport of [
    { width: 1536, height: 960 },
    { width: 1280, height: 800 },
    { width: 900, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".galgame-editor-grid")).toBeVisible();
    if (viewport.width <= 1200)
      await page
        .getByRole("button", { name: "预览与属性", exact: true })
        .click();
    await page.getByRole("button", { name: "查看完整报告" }).click();
    routeDialog = page.getByRole("dialog", { name: "工程检查" });
    await expect(routeDialog).toBeVisible();
    const dialogBounds = await routeDialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    });
    expect(dialogBounds.left).toBeGreaterThanOrEqual(0);
    expect(dialogBounds.right).toBeLessThanOrEqual(viewport.width);
    expect(dialogBounds.scrollWidth).toBeLessThanOrEqual(
      dialogBounds.clientWidth,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    if (process.env.FPL_CAPTURE_SCREENSHOTS === "1") {
      await page.screenshot({
        path: testInfo.outputPath(
          `galgame-editor-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: viewport.width < 980,
      });
    }
    await routeDialog
      .getByRole("button", { name: "关闭", exact: true })
      .click();
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await expect(page.locator(".galgame-editor-page")).toHaveCSS(
    "color",
    "rgb(237, 243, 251)",
  );
  if (process.env.FPL_CAPTURE_SCREENSHOTS === "1") {
    await page.screenshot({
      path: testInfo.outputPath("galgame-editor-dark-1280x800.png"),
    });
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });

  await openAssetSection(page, "角色");
  await page
    .locator(".galgame-character-list")
    .getByRole("button", { name: /调查员/ })
    .click();
  await page.getByRole("button", { name: /galgame-workshop-mark/ }).click();
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1536, height: 960 },
    { width: 1280, height: 800 },
    { width: 900, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".galgame-character-workspace")).toBeVisible();
    if (viewport.width <= 1200)
      await page.getByRole("button", { name: "角色详情", exact: true }).click();
    const [
      expressionPreviewBounds,
      expressionSettingsBounds,
      expressionRailBounds,
      flipControlBounds,
      portraitImageBounds,
    ] = await Promise.all([
      page.locator(".galgame-expression-detail-preview").boundingBox(),
      page.locator(".galgame-expression-form").boundingBox(),
      page.locator(".galgame-expression-grid").boundingBox(),
      page.locator(".galgame-expression-setting-toggle").boundingBox(),
      page.locator(".galgame-portrait-stage-image").boundingBox(),
    ]);
    expect(expressionPreviewBounds).not.toBeNull();
    expect(expressionSettingsBounds).not.toBeNull();
    expect(expressionRailBounds).not.toBeNull();
    expect(flipControlBounds).not.toBeNull();
    expect(portraitImageBounds).not.toBeNull();
    const visiblePortraitWidth = Math.max(
      0,
      Math.min(
        portraitImageBounds!.x + portraitImageBounds!.width,
        expressionPreviewBounds!.x + expressionPreviewBounds!.width,
      ) - Math.max(portraitImageBounds!.x, expressionPreviewBounds!.x),
    );
    const visiblePortraitHeight = Math.max(
      0,
      Math.min(
        portraitImageBounds!.y + portraitImageBounds!.height,
        expressionPreviewBounds!.y + expressionPreviewBounds!.height,
      ) - Math.max(portraitImageBounds!.y, expressionPreviewBounds!.y),
    );
    expect(visiblePortraitWidth).toBeGreaterThan(0);
    expect(visiblePortraitWidth).toBeLessThanOrEqual(
      expressionPreviewBounds!.width,
    );
    expect(visiblePortraitHeight).toBeGreaterThan(0);
    expect(visiblePortraitHeight).toBeLessThanOrEqual(
      expressionPreviewBounds!.height,
    );
    await expect(page.locator(".galgame-expression-detail-preview")).toHaveCSS(
      "overflow",
      "hidden",
    );
    await expect(page.locator(".galgame-portrait-stage-image")).toHaveCSS(
      "object-fit",
      "contain",
    );
    expect(expressionPreviewBounds!.width).toBeLessThanOrEqual(
      expressionSettingsBounds!.width,
    );
    if (viewport.width >= 1500) {
      expect(expressionSettingsBounds!.width).toBeGreaterThanOrEqual(700);
      expect(expressionPreviewBounds!.width).toBeGreaterThanOrEqual(630);
    }
    expect(expressionRailBounds!.width).toBeLessThanOrEqual(
      viewport.width <= 1200 ? viewport.width : 261,
    );
    expect(flipControlBounds!.height).toBeLessThanOrEqual(71);
    const expressionPreviewCenter =
      expressionPreviewBounds!.x + expressionPreviewBounds!.width / 2;
    const expressionSettingsCenter =
      expressionSettingsBounds!.x + expressionSettingsBounds!.width / 2;
    expect(
      Math.abs(expressionSettingsCenter - expressionPreviewCenter),
    ).toBeLessThanOrEqual(36);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    if (process.env.FPL_CAPTURE_SCREENSHOTS === "1") {
      await page.screenshot({
        path: testInfo.outputPath(
          `galgame-characters-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: viewport.width < 980,
      });
    }
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "序列帧" }).click();
  const frameChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "从本地导入" }).click();
  const frameChooser = await frameChooserPromise;
  await frameChooser.setFiles("public/brand/galgame-workshop-mark.png");
  await page.getByRole("spinbutton", { name: "播放帧率" }).fill("13");
  await page.getByRole("checkbox", { name: "循环播放" }).click();
  await expect
    .poll(() => JSON.stringify(document))
    .toContain('"renderMode":"frameSequence"');
  await expect.poll(() => JSON.stringify(document)).toContain('"fps":13');
  await expect.poll(() => JSON.stringify(document)).toContain('"loop":false');
  await expect
    .poll(
      () => document.characters?.[0]?.expressions?.[0]?.sequence?.frames.length,
    )
    .toBe(2);
  const thirdFrameChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "从本地导入" }).click();
  const thirdFrameChooser = await thirdFrameChooserPromise;
  await thirdFrameChooser.setFiles("public/brand/galgame-workshop-mark.png");
  await expect
    .poll(
      () => document.characters?.[0]?.expressions?.[0]?.sequence?.frames.length,
    )
    .toBe(3);
  await page.getByRole("button", { name: "语音口型" }).click();
  await expect
    .poll(
      () => document.characters?.[0]?.expressions?.[0]?.sequence?.playbackMode,
    )
    .toBe("lipSync");
  await expect(page.getByRole("checkbox", { name: "循环播放" })).toHaveCount(0);
  await expect(page.getByText("语音驱动", { exact: true })).toBeVisible();

  await openAssetSection(page, "场景");
  for (const viewport of [
    { width: 1536, height: 960 },
    { width: 1280, height: 800 },
    { width: 900, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      page.locator(".galgame-unified-visual-workspace"),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    if (process.env.FPL_CAPTURE_SCREENSHOTS === "1") {
      await page.screenshot({
        path: testInfo.outputPath(
          `galgame-scenes-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: viewport.width < 980,
      });
    }
  }

  await page.getByRole("button", { name: "工程概览" }).click();
  await expect(page.locator(".workshop-sidebar")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "标记完成" })).toBeEnabled();
  await page.getByRole("button", { name: "标记完成" }).click();
  await expect(page.getByText("已完成")).toBeVisible();
});
