import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setResponsiveTheme } from "./responsive-capture";

test("三张图片与参考视频的详情操作位于图片下方，图标和编号不重叠", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route("**/v1/visual-workshop/generation-options", (route) =>
    route.fulfill({
      json: {
        models: [
          {
            id: "image-layout",
            provider_id: "test",
            provider_name: "隔离验收",
            kind: "image",
            slug: "image-layout",
            label: "图片参考验收",
            description: "",
            sizes: ["1024x1024"],
            supports_seed: false,
            max_reference_images: 9,
            max_prompt_length: 6000,
          },
          {
            id: "reference-layout",
            provider_id: "test",
            provider_name: "隔离验收",
            kind: "video",
            slug: "doubao-seedance-2-0-260128",
            label: "参考布局验收",
            description: "",
            sizes: [],
            supports_seed: false,
            max_reference_images: 9,
            max_prompt_length: 6000,
            video_capabilities: {
              duration_min: 5,
              duration_max: 10,
              default_duration: 5,
              resolutions: ["720p"],
              ratios: ["16:9"],
              reference_limits: { image: 9, video: 1, audio: 0 },
              reference_minimums: { image: 1, video: 0, audio: 0 },
              reference_mime_types: {
                image: ["image/png"],
                video: ["video/mp4"],
              },
              supported_modes: ["reference"],
              supports_prompt: true,
              prompt_required: false,
              supports_duration: true,
              supports_ratio: true,
              supports_video_subject_to_replace: false,
              default_resolution: "720p",
              default_ratio: "16:9",
            },
          },
        ],
      },
    }),
  );
  await page.goto("/apps/visual-workshop");
  const csrf = (await page.context().cookies()).find(
    ({ name }) => name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const project = await page.request.post("/v1/visual-workshop/projects", {
    headers,
    data: { title: "三图加视频 · 参考布局验收", kind: "canvas" },
  });
  expect(project.ok(), await project.text()).toBeTruthy();
  const id = (await project.json()).id;
  const base = `/v1/visual-workshop/projects/${id}`;
  const video = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=160x90:r=12:d=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "frag_keyframe+empty_moov",
    "-f",
    "mp4",
    "pipe:1",
  ]);
  const fixtures = [
    {
      name: "分镜图1.png",
      mimeType: "image/png",
      buffer: readFileSync(
        resolve("public/brand/visual-workshop-mark-cutout.png"),
      ),
    },
    {
      name: "分镜图2.png",
      mimeType: "image/png",
      buffer: readFileSync(resolve("public/brand/amadeus/amadeus-poster.png")),
    },
    {
      name: "分镜图3.png",
      mimeType: "image/png",
      buffer: readFileSync(
        resolve("public/brand/visual-workshop-mark-cutout.png"),
      ),
    },
    { name: "参考视频.mp4", mimeType: "video/mp4", buffer: video },
  ];
  let canvas = { revision: 0, nodes: [] as Record<string, unknown>[] };
  for (const file of fixtures) {
    const uploaded = await page.request.post(`${base}/node-uploads`, {
      headers,
      multipart: { expected_revision: String(canvas.revision), file },
    });
    expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
    canvas = await uploaded.json();
  }
  const cards = [];
  for (const [index, kind] of ["character", "scene", "prop"].entries()) {
    const created = await page.request.post(`${base}/asset-cards`, {
      headers,
      data: {
        title: `实际归属-${kind}`,
        kind,
        ...(kind !== "scene"
          ? {
              adopted_asset_id: canvas.nodes[index].asset_id,
              candidate_asset_ids: [canvas.nodes[index].asset_id],
            }
          : {}),
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    cards.push(await created.json());
  }
  const edges = canvas.nodes.map((node, index) => ({
    id: `reference-${index}`,
    source_node_id: node.id,
    target_node_id: "shot",
    binding: "final",
    output_id: null,
  }));
  const saved = await page.request.put(`${base}/canvas`, {
    headers,
    data: {
      expected_revision: canvas.revision,
      nodes: [
        ...canvas.nodes.map((node, index) =>
          index === 1
            ? {
                ...node,
                design_card_id: cards[1].id,
                design_card_revision: cards[1].revision,
              }
            : node,
        ),
        {
          id: "shot",
          kind: "video",
          title: "三图加视频",
          position: { x: 600, y: 100 },
          generation_draft: {
            model_id: "reference-layout",
            mode: "reference",
            prompt: "按参考顺序制作。",
            duration: 5,
            resolution: "720p",
            ratio: "16:9",
            reference_asset_ids: [canvas.nodes[0].asset_id],
            design_references: [
              {
                asset_id: canvas.nodes[0].asset_id,
                card_id: cards[0].id,
                card_revision: cards[0].revision,
                title: cards[0].title,
              },
            ],
          },
        },
      ],
      edges,
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.goto(`/apps/visual-workshop/projects/${id}/canvas`);
  await page.getByRole("button", { name: "看板", exact: true }).click();
  await page
    .locator(".board-material")
    .filter({ hasText: "三图加视频" })
    .click();
  const strip = page.getByRole("region", { name: "参考素材", exact: true });
  await expect(strip.locator(".generation-media-card")).toHaveCount(4);
  await expect(strip.locator(".reference-kind-tag")).toHaveText([
    "角色",
    "场景",
    "道具",
  ]);
  async function checkGeometry(page: Page) {
    const tiles = await strip
      .locator(".generation-media-upload, .generation-media-open")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          const content = element
            .querySelector("img, svg")!
            .getBoundingClientRect();
          return {
            width: box.width,
            height: box.height,
            top: box.top,
            centered:
              Math.abs(
                content.left + content.width / 2 - box.left - box.width / 2,
              ) < 1,
          };
        }),
      );
    expect(tiles.length).toBeGreaterThan(4);
    for (const tile of tiles) {
      expect(tile.width).toBeCloseTo(64, 0);
      expect(tile.height).toBeCloseTo(64, 0);
      expect(tile.top).toBeCloseTo(tiles[0].top, 0);
      expect(tile.centered).toBe(true);
    }
    const captions = await strip
      .locator(
        ".generation-media-upload-label, .reference-media-caption, .reference-subject-label",
      )
      .evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { top: box.top, height: box.height };
        }),
      );
    for (const caption of captions) {
      expect(caption.top).toBeCloseTo(tiles[0].top + 64, 0);
      expect(caption.height).toBeCloseTo(24, 0);
    }
    const geometry = await strip
      .locator(".generation-media-card")
      .evaluateAll((cards) =>
        cards.map((card) => {
          const open = card
            .querySelector(".generation-media-open")!
            .getBoundingClientRect();
          const details = card
            .querySelector(".reference-details-trigger")!
            .getBoundingClientRect();
          const icon = card
            .querySelector(".reference-details-trigger svg")!
            .getBoundingClientRect();
          const caption = card
            .querySelector(
              ".reference-media-caption, .reference-subject-label",
            )!
            .getBoundingClientRect();
          return {
            below: details.top >= open.bottom,
            outsideCaption: details.left >= caption.right,
            iconInside:
              icon.left >= details.left &&
              icon.right <= details.right &&
              icon.top >= details.top &&
              icon.bottom <= details.bottom,
          };
        }),
      );
    expect(geometry).toEqual(
      Array.from({ length: 4 }, () => ({
        below: true,
        outsideCaption: true,
        iconInside: true,
      })),
    );
    const tags = await strip
      .locator(".reference-kind-tag")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          const card = element.closest(".generation-media-card")!;
          const tile = card
            .querySelector(".generation-media-open")!
            .getBoundingClientRect();
          const number = card
            .querySelector(".reference-order-number")!
            .getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            width: box.width,
            height: box.height,
            inside:
              box.left >= tile.left &&
              box.right <= tile.right &&
              box.top >= tile.top &&
              box.bottom <= tile.bottom,
            clearOfNumber: box.left >= number.right + 2,
            background: style.backgroundColor,
            textFits: element.scrollWidth <= element.clientWidth,
          };
        }),
      );
    expect(tags).toHaveLength(3);
    expect(new Set(tags.map((tag) => tag.background)).size).toBe(3);
    for (const tag of tags) {
      expect(tag.height).toBe(18);
      expect(tag.width).toBe(30);
      expect(tag.inside).toBe(true);
      expect(tag.clearOfNumber).toBe(true);
      expect(tag.textFits).toBe(true);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  for (const theme of ["dark", "light"] as const) {
    await setResponsiveTheme(page, theme);
    for (const width of [1600, 1024, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await checkGeometry(page);
      await page.screenshot({
        path: info.outputPath(`reference-${theme}-${width}.png`),
        animations: "disabled",
      });
    }
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await strip
    .getByRole("button", { name: /^参考详情 / })
    .first()
    .click();
  await expect(
    page.getByRole("menuitem", { name: "移除引用", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await strip.locator(".generation-media-open").first().click();
  await expect(page.getByRole("dialog", { name: /分镜图1/ })).toBeVisible();
  await page.getByRole("button", { name: "关闭预览", exact: true }).click();
  const latest = await (await page.request.get(`${base}/canvas`)).json();
  const withImage = await page.request.put(`${base}/canvas`, {
    headers,
    data: {
      expected_revision: latest.revision,
      nodes: [
        ...latest.nodes,
        {
          id: "image-inputs",
          kind: "image",
          title: "图片归属",
          position: { x: 800, y: 100 },
          generation_draft: {
            model_id: "image-layout",
            reference_asset_ids: canvas.nodes
              .slice(0, 3)
              .map((node) => node.asset_id),
          },
        },
      ],
      // Manual assets retain explicit project card links without incoming edges.
      edges: latest.edges,
    },
  });
  expect(withImage.ok(), await withImage.text()).toBeTruthy();
  await page.reload();
  await page.locator(".board-material").filter({ hasText: "图片归属" }).click();
  const image = page.locator(".image-node-composer");
  await expect(image.locator(".reference-kind-tag")).toHaveText([
    "角色",
    "场景",
    "道具",
  ]);
  const removable = image.locator(".generation-media-card").first();
  await removable.hover();
  const remove = removable.getByRole("button", { name: /^移除参考文件/ });
  await expect(remove).toHaveCSS("opacity", "1");
  const tagBox = (await removable
    .locator(".reference-kind-tag")
    .boundingBox())!;
  const removeBox = (await remove.boundingBox())!;
  const imageBox = (await removable
    .locator(".generation-media-open")
    .boundingBox())!;
  expect(removeBox.y).toBeGreaterThan(tagBox.y + tagBox.height);
  expect(removeBox.y + removeBox.height).toBeLessThanOrEqual(
    imageBox.y + imageBox.height,
  );
  await page.screenshot({
    path: info.outputPath("image-category-hover.png"),
    animations: "disabled",
  });
});
