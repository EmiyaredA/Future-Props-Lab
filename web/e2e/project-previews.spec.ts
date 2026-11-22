import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { newDeck } from "../src/features/presentation-workshop/templates";

const id = "693f32d1-5cd4-43ea-a878-d13126552c77";
const title = "自动封面 · 雨夜短片";
const time = "2026-11-22T00:00:00Z";
const base = {
  id,
  title,
  revision: 1,
  created_at: time,
  updated_at: time,
  createdAt: time,
  updatedAt: time,
  status: "draft",
  kind: "canvas",
};
const imagePreview = {
  kind: "image",
  version: "image-v1",
  urls: ["/v1/files/cover/thumbnail?size=640"],
  label: "",
  text: "",
  source_time: 0,
};

for (const app of [
  "visual-workshop",
  "video-editor",
  "motion-compositor",
  "galgame-workshop",
  "audio-annotation",
  "spreadsheet-workshop",
  "thought-workshop",
  "presentation-workshop",
]) {
  test(`${app} shows actual content on its project card`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    const bytes = await readFile(
      new URL(
        "../src/features/visual-workshop/creative/design-library-empty.webp",
        import.meta.url,
      ),
    );
    await page.route("**/v1/files/cover/thumbnail?*", (route) =>
      route.fulfill({ contentType: "image/webp", body: bytes }),
    );
    let preview: Record<string, unknown> = imagePreview;
    if (app === "audio-annotation")
      preview = {
        ...imagePreview,
        kind: "waveform",
        label: "1:30",
        text: "今晚的访谈围绕短片分镜展开。",
        peaks: Array.from(
          { length: 80 },
          (_, i) => Math.abs(Math.sin(i * 1.7)) * 0.8,
        ),
      };
    if (app === "spreadsheet-workshop")
      preview = {
        ...imagePreview,
        kind: "table",
        label: "拍摄预算",
        cells: [
          [
            { text: "项目", bold: true },
            { text: "费用", bold: true },
          ],
          [
            { text: "灯光", bold: false },
            { text: "¥1200", bold: false },
          ],
        ],
      };
    if (app === "thought-workshop")
      preview = {
        ...imagePreview,
        kind: "text",
        label: "雨夜短片笔记",
        text: "雨水与霓虹照亮街角，镜头从远景缓缓推向主人公。",
      };
    const project = {
      ...base,
      preview,
      duration_ms: 90000,
      segment_count: 5,
      reviewed_segment_count: 2,
      original_filename: "访谈.wav",
      document_count: 3,
      description: "项目内容预览",
      calculation: "not_needed",
      slide_count: 1,
      first_slide: newDeck().slides[0],
      width: 1280,
      height: 720,
    };
    const listPath =
      app === "thought-workshop"
        ? "/v1/thought-workshop/knowledge-bases"
        : `/v1/${app}/projects`;
    await page.route(
      (url) => url.pathname === listPath,
      (route) =>
        route.fulfill({
          json:
            app === "thought-workshop"
              ? [project]
              : { items: [project], total: 1 },
        }),
    );
    await page.goto(`/apps/${app}`);
    const card = page.locator("article").filter({ hasText: title }).first();
    await expect(card).toBeVisible();
    if (app === "presentation-workshop") {
      await expect(card.locator(".presentation-starter-preview")).toBeVisible();
    } else if (app === "audio-annotation")
      await expect(
        card.getByRole("img", { name: `${title}的音频波形` }),
      ).toBeVisible();
    else if (app === "spreadsheet-workshop")
      await expect(card.getByRole("table")).toContainText("¥1200");
    else if (app === "thought-workshop")
      await expect(card.getByText("雨夜短片笔记")).toBeVisible();
    else {
      const image = card.getByRole("img", { name: `${title}的项目预览` });
      await expect(image).toBeVisible();
      await expect
        .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
        .toBeGreaterThan(0);
    }
    await card.screenshot({ path: info.outputPath(`${app}-desktop.png`) });
    await page.getByRole("button", { name: "深色", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(card).toBeInViewport();
    expect(
      await card.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await card.screenshot({ path: info.outputPath(`${app}-mobile-dark.png`) });
  });
}

test("director renders a real saved scene without mounting or saving the editor", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/apps");
  const document = await page.evaluate(async () => {
    const { demoProject } =
      await import("/src/features/director-desk/editor/model.ts");
    const { readSceneDocument } =
      await import("/src/features/director-desk/editor/scenes/sequence-project.ts");
    return readSceneDocument(demoProject());
  });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/v1/director-desk") &&
      request.method() !== "GET"
    )
      writes.push(request.method());
  });
  await page.route(
    (url) => url.pathname === "/v1/director-desk/projects",
    (route) =>
      route.fulfill({
        json: {
          items: [
            {
              ...base,
              preview: {
                ...imagePreview,
                urls: [],
                kind: "scene",
                source_revision: 1,
              },
            },
          ],
          total: 1,
        },
      }),
  );
  await page.route(
    (url) => url.pathname === `/v1/director-desk/projects/${id}`,
    (route) => route.fulfill({ json: { ...base, document } }),
  );
  await page.goto("/apps/director-desk");
  const card = page.locator("article").filter({ hasText: title });
  const image = card.getByRole("img", { name: `${title}的项目预览` });
  await expect(image).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.locator(".director-desk-root")).toHaveCount(0);
  expect(writes).toEqual([]);
  await card.screenshot({ path: info.outputPath("director-real-scene.png") });
});

test("galgame obtains one read-only composite frame and never creates an export", async ({
  page,
}, info) => {
  const bytes = await readFile(
    new URL(
      "../src/features/visual-workshop/creative/design-library-empty.webp",
      import.meta.url,
    ),
  );
  const methods: string[] = [];
  await page.route(
    (url) => url.pathname === "/v1/galgame-workshop/projects",
    (route) =>
      route.fulfill({
        json: {
          items: [
            {
              ...base,
              preview: {
                ...imagePreview,
                urls: [],
                kind: "scene",
                source_id: "entry",
                source_revision: 3,
                source_time: 500,
              },
            },
          ],
        },
      }),
  );
  await page.route(
    `**/v1/galgame-workshop/projects/${id}/video-exports/**`,
    (route) => {
      methods.push(new URL(route.request().url()).pathname);
      expect(route.request().postDataJSON()).toMatchObject({
        expectedStoryRevision: 3,
        fragmentIds: ["entry"],
        scope: "fragments",
        width: 640,
        timeMs: 500,
      });
      return route.fulfill({ contentType: "image/webp", body: bytes });
    },
  );
  await page.goto("/apps/galgame-workshop");
  await expect(
    page.getByRole("img", { name: `${title}的项目预览` }),
  ).toBeVisible();
  expect(methods).toEqual([
    `/v1/galgame-workshop/projects/${id}/video-exports/frame`,
  ]);
  await page
    .locator("article")
    .filter({ hasText: title })
    .screenshot({ path: info.outputPath("galgame-precise-frame.png") });
});
