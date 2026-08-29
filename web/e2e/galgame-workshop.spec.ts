import { expect, test, type Page } from "@playwright/test";

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
