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

test("shows migrated lip-sync expressions as one named three-frame item", async ({
  page,
}) => {
  let revision = 554;
  const storyDocument = {
    schemaVersion: "1.4",
    entryChapterId: "chapter-1",
    synopsis: "",
    characterAttributeTemplates: [],
    variables: [],
    settings: {},
    assets: [
      ["portrait-closed", "file-closed"],
      ["portrait-half", "file-half"],
      ["portrait-open", "file-open"],
    ].map(([id, fileId]) => ({
      id,
      type: "image",
      role: "characterPortrait",
      fileId,
      status: "ready",
    })),
    characters: [
      {
        id: "hero",
        name: "测试角色",
        description: "",
        expressions: [
          {
            id: "e001-f000",
            label: "平静",
            assetId: "portrait-closed",
            renderMode: "frameSequence",
            sequence: {
              playbackMode: "lipSync",
              fps: 12,
              loop: true,
              frames: [
                { id: "e001-mouth-closed", assetId: "portrait-closed" },
                { id: "e001-mouth-half", assetId: "portrait-half" },
                { id: "e001-mouth-open", assetId: "portrait-open" },
              ],
            },
          },
        ],
        defaultExpressionId: "e001-f000",
      },
    ],
    sceneGroups: [],
    scenes: [],
    cgs: [],
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
              {
                id: "dialogue-1",
                type: "dialogue",
                characterId: "hero",
                expressionId: "e001-f000",
                text: "口型测试。",
              },
            ],
          },
        ],
      },
    ],
  };
  let savedDocument: typeof storyDocument | undefined;
  const projectAssets = ["closed", "half", "open"].map((mouth) => ({
    id: `file-${mouth}`,
    display_name: `${mouth}.png`,
    media_kind: "image",
    mime_type: "image/png",
    byte_size: 68,
    revision: 0,
    created_at: "2026-08-19T08:00:00Z",
    updated_at: "2026-08-19T08:00:00Z",
  }));

  await page.route("**/v1/file-folders**", (route) =>
    route.fulfill({ contentType: "application/json", body: '{"items":[]}' }),
  );
  await page.route("**/v1/files**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/content")) {
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
      body: '{"items":[]}',
    });
  });
  await page.route(
    "**/v1/galgame-workshop/projects/lip-sync-e2e**",
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith("/story/report")) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            project_id: "lip-sync-e2e",
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
          savedDocument = (
            request.postDataJSON() as { document: typeof storyDocument }
          ).document;
          revision += 1;
        }
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            project_id: "lip-sync-e2e",
            revision,
            updated_at: "2026-08-19T08:00:00Z",
            document: savedDocument ?? storyDocument,
          }),
        });
        return;
      }
      if (path.endsWith("/assets/overview")) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            items: [],
            missing_items: [],
            totalBytes: 204,
            referencedCount: 3,
            orphanedCount: 0,
            estimatedPackageBytes: 204,
            largestAssetIds: [],
            moduleHealth: { character: "ready" },
          }),
        });
        return;
      }
      if (path.endsWith("/assets/package-manifest")) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            ready: true,
            totalBytes: 204,
            items: [],
            issues: [],
          }),
        });
        return;
      }
      if (path.endsWith("/assets")) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ items: projectAssets }),
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "lip-sync-e2e",
          title: "口型迁移验收",
          status: "draft",
          revision: 0,
          created_at: "2026-08-19T08:00:00Z",
          updated_at: "2026-08-19T08:00:00Z",
        }),
      });
    },
  );

  await page.goto("/apps/galgame-workshop/projects/lip-sync-e2e/editor");
  await openAssetSection(page, "角色");
  await page
    .locator(".galgame-character-list")
    .getByRole("button", { name: /测试角色 1 个表情/ })
    .click();
  const expressionGrid = page.locator(".galgame-expression-grid");
  await expect(
    expressionGrid.getByRole("button", { name: /平静/ }),
  ).toHaveCount(1);
  await expect(page.getByText(/原始表情/)).toHaveCount(0);
  await expressionGrid.getByRole("button", { name: /平静/ }).click();

  await expect(page.getByRole("button", { name: "语音口型" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const frames = page.locator(".galgame-expression-frame-list > li");
  await expect(frames).toHaveCount(3);
  await expect(frames.nth(0).locator(":scope > span")).toHaveText("闭");
  await expect(frames.nth(1).locator(":scope > span")).toHaveText("半");
  await expect(frames.nth(2).locator(":scope > span")).toHaveText("张");

  await page.getByRole("button", { name: "定时播放" }).click();
  await expect.poll(() => savedDocument).toBeTruthy();
  expect(savedDocument?.characters[0].defaultExpressionId).toBe("e001-f000");
  expect(savedDocument?.chapters[0].fragments[0].blocks[0].expressionId).toBe(
    "e001-f000",
  );
  expect(savedDocument?.characters[0].expressions).toHaveLength(1);
  expect(
    savedDocument?.characters[0].expressions[0].sequence.frames,
  ).toHaveLength(3);
});

test("builds, saves, checks, and plays a branching Galgame slice", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
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
  await page.setViewportSize({ width: 1440, height: 1000 });
  const compactStagePanels = await Promise.all(
    ["is-presets", "is-position", "is-size"].map((className) =>
      page.locator(`.galgame-stage-parameter-panel.${className}`).boundingBox(),
    ),
  );
  expect(compactStagePanels.every(Boolean)).toBe(true);
  expect(compactStagePanels[0]?.y).toBeLessThan(compactStagePanels[1]?.y ?? 0);
  expect(compactStagePanels[1]?.y).toBe(compactStagePanels[2]?.y);
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
    expect(portraitImageBounds!.width).toBeLessThanOrEqual(
      expressionPreviewBounds!.width,
    );
    expect(portraitImageBounds!.height).toBeLessThanOrEqual(
      expressionPreviewBounds!.height,
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
    expect(expressionRailBounds!.width).toBeLessThanOrEqual(261);
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
  await expect(page.locator(".workshop-sidebar")).toBeVisible();
  await expect(page.getByRole("button", { name: "标记完成" })).toBeEnabled();
  await page.getByRole("button", { name: "标记完成" }).click();
  await expect(page.getByText("已完成")).toBeVisible();
});

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
  await expect(page.getByText("多章节旅程")).toBeVisible();
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
