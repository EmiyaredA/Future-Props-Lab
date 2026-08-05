import { expect, test } from "@playwright/test";

test("builds, saves, checks, and plays a branching Galgame slice", async ({
  page,
}, testInfo) => {
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
    if (path.endsWith("/assets")) {
      if (request.method() === "POST") {
        const isPortrait = projectAssets.length === 0;
        const uploaded = {
          id: isPortrait ? "private-portrait" : "private-background",
          display_name: isPortrait
            ? "galgame-workshop-mark.png"
            : "research-lab.png",
          mime_type: "image/png",
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

  await page.getByRole("button", { name: "角色", exact: true }).click();
  await page.getByRole("button", { name: "新建角色" }).click();
  await page.getByRole("button", { name: "基础资料" }).click();
  await page.getByLabel("角色名称").fill("调查员");
  await page.getByRole("button", { name: "立绘与表情" }).click();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "上传立绘" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles("public/brand/galgame-workshop-mark.png");
  await expect(page.getByText("基准立绘已绑定")).toBeVisible({
    timeout: 3000,
  });
  await page.getByRole("button", { name: "添加表情" }).click();
  const assetPicker = page.getByRole("dialog", { name: "添加角色表情" });
  await assetPicker.getByRole("button", { name: "全局文件库" }).click();
  await assetPicker.getByRole("button", { name: /微笑.png/ }).click();
  await page.getByRole("button", { name: "场景", exact: true }).click();
  await page.getByRole("button", { name: "新建场景" }).click();
  await page.getByRole("button", { name: "基础资料" }).click();
  await page.getByLabel("场景名称").fill("夜间研究所");
  await page.getByRole("button", { name: "背景与状态" }).click();
  const backgroundChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "上传背景" }).click();
  const backgroundChooser = await backgroundChooserPromise;
  await backgroundChooser.setFiles("public/brand/galgame-workshop-mark.png");
  await expect(page.getByText("默认背景已绑定")).toBeVisible({
    timeout: 3000,
  });
  await page.getByRole("button", { name: "添加状态" }).click();
  const backgroundPicker = page.getByRole("dialog", {
    name: "添加场景背景",
  });
  await backgroundPicker.getByRole("button", { name: "全局文件库" }).click();
  await backgroundPicker.getByRole("button", { name: /雨夜.png/ }).click();
  await page.getByRole("button", { name: "剧本", exact: true }).click();

  await page.getByRole("button", { name: /新建/ }).click();
  await page
    .locator(".galgame-block-add")
    .getByRole("button", { name: /章节结局/ })
    .click();
  await page.getByLabel("结局名称").fill("设备结局");
  await page.getByRole("button", { name: /新建/ }).click();
  await page
    .locator(".galgame-block-add")
    .getByRole("button", { name: /章节结局/ })
    .click();
  await page.getByLabel("结局名称").fill("时钟结局");

  await page.getByRole("button", { name: /main/ }).click();
  await page
    .locator(".galgame-block-add")
    .getByRole("button", { name: /场景/ })
    .click();
  await page.getByLabel("背景状态").selectOption({ label: "雨夜" });
  await page
    .locator(".galgame-block-add")
    .getByRole("button", { name: /旁白/ })
    .click();
  await page.getByLabel("旁白正文").fill("研究所只剩下应急灯。");
  await page
    .locator(".galgame-block-add")
    .getByRole("button", { name: /对白/ })
    .click();
  await page.getByLabel("对白正文").fill("线索只允许一次选择。");
  await page.getByLabel("对白表情").selectOption({ label: "微笑" });
  await page
    .locator(".galgame-block-add")
    .getByRole("button", { name: /分支/ })
    .click();
  await page.getByLabel("选项 1 文案").fill("检查设备");
  await page.getByLabel("选项 2 文案").fill("检查时钟");
  await expect(page.getByText("已保存")).toBeVisible({ timeout: 3000 });

  const player = page.getByRole("region", { name: "游戏预览" });
  await player.getByRole("button", { name: "开始试玩", exact: true }).click();
  await expect(player.locator(".galgame-player-background")).toBeVisible();
  await player.getByRole("button", { name: /研究所只剩下应急灯/ }).click();
  await expect(player.locator(".galgame-player-portrait-image")).toBeVisible();
  await player.getByRole("button", { name: /线索只允许一次选择/ }).click();
  await player.getByRole("button", { name: "检查设备" }).click();
  await expect(player.getByText("设备结局")).toBeVisible();
  await player.getByRole("button", { name: "重新开始", exact: true }).click();
  await player.getByRole("button", { name: /研究所只剩下应急灯/ }).click();
  await player.getByRole("button", { name: /线索只允许一次选择/ }).click();
  await player.getByRole("button", { name: "检查时钟" }).click();
  await expect(player.getByText("时钟结局")).toBeVisible();

  for (const viewport of [
    { width: 1536, height: 960 },
    { width: 1280, height: 800 },
    { width: 900, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".galgame-editor-grid")).toBeVisible();
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

  await page.getByRole("button", { name: "角色", exact: true }).click();
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

  await page.getByRole("button", { name: "场景", exact: true }).click();
  for (const viewport of [
    { width: 1536, height: 960 },
    { width: 1280, height: 800 },
    { width: 900, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".galgame-scene-workspace")).toBeVisible();
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
