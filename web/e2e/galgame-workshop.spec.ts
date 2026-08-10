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

test("builds, saves, checks, and plays a branching Galgame slice", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  let projects: Array<Record<string, unknown>> = [];
  let storyRevision = 0;
  let projectAssets: Array<Record<string, unknown>> = [];
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
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ready: true,
          totalBytes: projectAssets.reduce(
            (sum, asset) => sum + Number(asset.byte_size ?? 0),
            0,
          ),
          items: projectAssets.map((asset) => ({
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
      const items = projectAssets.map((asset) => {
        const audio = asset.media_kind === "audio";
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
          orphaned: false,
          reference_count: 1,
          references: [],
          transcriptRevision: 0,
          transcriptStatus: "pending",
        };
      });
      const totalBytes = items.reduce(
        (sum, asset) => sum + Number(asset.byte_size ?? 0),
        0,
      );
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          items,
          missing_items: [],
          totalBytes,
          referencedCount: items.length,
          orphanedCount: 0,
          estimatedPackageBytes: totalBytes,
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

  await openAssetSection(page, "角色");
  await expect(page.getByRole("button", { name: "位置与锚点" })).toBeVisible();
  await expect(page.getByRole("button", { name: "角色预览" })).toBeVisible();
  await page.getByRole("button", { name: "新建角色" }).click();
  await expect(page.getByText("选择一个表情查看详情")).toBeVisible();
  await page.getByRole("button", { name: "显示名" }).click();
  await page.getByLabel("角色名称").fill("调查员");
  await page.getByRole("button", { name: "表情资源" }).click();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "批量导入", exact: true }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles("public/brand/galgame-workshop-mark.png");
  await expect(
    page.getByRole("button", { name: /galgame-workshop-mark/ }),
  ).toBeVisible({ timeout: 3000 });
  await page.getByRole("button", { name: "添加表情" }).click();
  const assetPicker = page.getByRole("dialog", { name: "添加角色表情" });
  await assetPicker.getByRole("button", { name: "全局文件库" }).click();
  await assetPicker.getByRole("button", { name: /微笑.png/ }).click();
  await page.getByRole("button", { name: "新建角色" }).click();
  await page.getByRole("button", { name: "显示名" }).click();
  await page.getByLabel("角色名称").fill("助手");
  await openAssetSection(page, "场景");
  await page.getByRole("button", { name: "新建场景" }).click();
  await page.getByLabel("场景名称").fill("夜间研究所");
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
  await expect(page.getByText("默认差分", { exact: true })).toBeVisible({
    timeout: 3000,
  });

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
  await page
    .getByRole("navigation", { name: "剧本编辑视图" })
    .getByRole("button", { name: "演出", exact: true })
    .click();
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
  await page
    .getByLabel("角色站位预设")
    .getByRole("button", { name: "左" })
    .click();
  await addAtPlayhead(/角色登场 \/ 调整/);
  await page.getByLabel("登场或调整角色").click();
  await page.getByRole("option", { name: "助手" }).click();
  await page
    .getByLabel("角色站位预设")
    .getByRole("button", { name: "右" })
    .click();
  await page.getByRole("slider", { name: "角色亮度", exact: true }).fill("0.8");
  await page.getByRole("slider", { name: "角色层级", exact: true }).fill("20");
  await addAtPlayhead("背景音乐");
  await addAtPlayhead(/旁白/);
  await page.getByLabel("旁白正文").fill("研究所只剩下应急灯。");
  await addAtPlayhead(/对白/);
  await page.getByLabel("对白正文").fill("线索只允许一次选择。");
  await page
    .getByRole("group", { name: "同时说话角色" })
    .getByRole("checkbox", { name: "助手" })
    .check();
  const voiceChooserPromise = page.waitForEvent("filechooser");
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
    { left: [330, 346], center: [494, 518], right: [1170, 1212] },
  );
  await expectOfficialScriptGeometry(
    page,
    { width: 1440, height: 1000 },
    { left: [230, 246], center: [344, 364], right: [818, 852] },
  );
  await page.getByRole("button", { name: "检查", exact: true }).click();

  for (const viewport of [
    { width: 1536, height: 960 },
    { width: 1280, height: 800 },
    { width: 900, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".galgame-editor-grid")).toBeVisible();
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
  for (const viewport of [
    { width: 1536, height: 960 },
    { width: 1280, height: 800 },
    { width: 900, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".galgame-character-workspace")).toBeVisible();
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
  await expect(page.locator(".workshop-sidebar")).toBeVisible();
  await expect(page.getByRole("button", { name: "标记完成" })).toBeEnabled();
  await page.getByRole("button", { name: "标记完成" }).click();
  await expect(page.getByText("已完成")).toBeVisible();
});

test("authors two chapters across the four script views and plays into the next chapter", async ({
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
  await expect(page.getByText("多章节旅程")).toBeVisible();
  await page.getByRole("button", { name: "新建章节" }).click();
  await page
    .locator(".galgame-block-toolbar")
    .getByLabel("Fragment 名称")
    .fill("第二章开始");

  const views = page.getByRole("navigation", { name: "剧本编辑视图" });
  await views.getByRole("button", { name: "演出", exact: true }).click();
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

  await views.getByRole("button", { name: "卡片", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Block 卡片编辑器" }),
  ).toBeVisible();
  await views.getByRole("button", { name: "纯文本", exact: true }).click();
  await expect(page.locator(".galgame-plain-view")).toBeVisible();
  await views.getByRole("button", { name: "Ren’Py", exact: true }).click();
  await expect(page.getByLabel("Ren’Py 剧本")).toBeVisible();
  await views.getByRole("button", { name: "JSON OP", exact: true }).click();
  await expect(page.getByText("规范化 JSON OP · 只读")).toBeVisible();

  await page.getByRole("button", { name: "开始试玩", exact: true }).click();
  for (const scope of [
    "从项目入口开始",
    "从当前章节开始",
    "从当前 Block 开始",
  ]) {
    const scopeButton = page.getByRole("button", { name: scope });
    await expect(scopeButton).toBeEnabled();
    await scopeButton.click();
    await expect(page.getByRole("region", { name: "游戏预览" })).toBeVisible();
  }

  await page.getByRole("button", { name: "开始试玩", exact: true }).click();
  const player = page.getByRole("region", { name: "游戏预览" });
  await player.getByRole("button", { name: "点击继续" }).click();
  await expect(player.getByText("欢迎来到第二章")).toBeVisible();
  await player.getByRole("button", { name: "点击继续" }).click();
  await expect(player.getByText("全篇完成")).toBeVisible();
});

test("edits shared boundaries and persists a ripple trim on the visual timeline", async ({
  page,
}) => {
  test.setTimeout(30_000);
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
  await page
    .getByRole("navigation", { name: "剧本编辑视图" })
    .getByRole("button", { name: "演出", exact: true })
    .click();
  expect(revision).toBe(0);
  const timeline = page.getByRole("region", {
    name: "多轨剧情时间轴",
  });
  await expect(timeline).toBeVisible();
  const stickyControls = timeline.locator(".galgame-timeline-controls");
  const toolbar = timeline.locator(".galgame-timeline-toolbar");
  const advancedSettings = timeline.locator(".galgame-timeline-advanced");
  const trackScroller = timeline.locator(".galgame-timeline-scroll");
  await expect(
    page.getByRole("button", { name: "切换场景", exact: true }),
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
  await expect.poll(() => revision, { timeout: 3000 }).toBeGreaterThan(0);
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
  await page
    .getByRole("navigation", { name: "剧本编辑视图" })
    .getByRole("button", { name: "演出", exact: true })
    .click();

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
