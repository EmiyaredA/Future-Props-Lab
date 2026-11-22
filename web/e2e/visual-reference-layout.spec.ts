import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setResponsiveTheme } from "./responsive-capture";

test("三张图片与参考视频的详情操作位于图片下方，图标和编号不重叠", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
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
      project_card_ids: cards.map((card) => card.id),
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
      expect(tag.height).toBe(14);
      expect(tag.width).toBe(24);
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
  const firstTile = strip.locator(".generation-media-card").first();
  const cornerRemove = firstTile.getByRole("button", { name: /^移除参考文件/ });
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await expect(cornerRemove).toHaveCSS("opacity", "0");
  await firstTile.hover();
  await expect(cornerRemove).toHaveCSS("opacity", "1");
  await expect(firstTile.locator(".reference-kind-tag")).toHaveCSS(
    "opacity",
    "0",
  );
  const corner = (await cornerRemove.boundingBox())!;
  const tile = (await firstTile
    .locator(".generation-media-open")
    .boundingBox())!;
  expect(corner.y - tile.y).toBeLessThan(8);
  expect(tile.x + tile.width - corner.x - corner.width).toBeLessThan(8);
  await page.mouse.move(0, 0);
  await cornerRemove.focus();
  await expect(cornerRemove).toHaveCSS("opacity", "1");
  await strip.screenshot({
    path: info.outputPath("reference-hover-remove.png"),
  });
  await cornerRemove.blur();
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
  await firstTile.hover();
  await cornerRemove.click();
  await expect(strip.locator(".generation-media-card")).toHaveCount(3);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(async () => {
      const state = await (await page.request.get(`${base}/canvas`)).json();
      const draft = state.nodes.find(
        (node: { id: string }) => node.id === "shot",
      ).generation_draft;
      return {
        edges: state.edges.map((edge: { id: string }) => edge.id),
        images: draft.reference_asset_ids,
        designs: draft.design_references,
      };
    })
    .toEqual({
      edges: ["reference-1", "reference-2", "reference-3"],
      images: [],
      designs: [],
    });
  await page.getByRole("tab", { name: "人设", exact: true }).click();
  const designSource = page.getByRole("button", {
    name: "查看设定卡 实际归属-character",
    exact: true,
  });
  await expect(designSource).toHaveAttribute("draggable", "true");
  await designSource.dragTo(strip.locator(".reference-strip-toolbar"));
  await expect(strip.locator(".generation-media-card")).toHaveCount(4);
  await expect
    .poll(async () => {
      const state = await (await page.request.get(`${base}/canvas`)).json();
      return state.nodes.find((node: { id: string }) => node.id === "shot")
        .generation_draft.design_references;
    })
    .toEqual([
      {
        asset_id: canvas.nodes[0].asset_id,
        card_id: cards[0].id,
        card_revision: cards[0].revision,
        title: cards[0].title,
      },
    ]);
  const localDrop = await page.evaluateHandle(() => {
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      ),
      (char) => char.charCodeAt(0),
    );
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], "本地拖入参考.png", { type: "image/png" }),
    );
    return transfer;
  });
  await strip
    .locator(".reference-strip-toolbar")
    .dispatchEvent("drop", { dataTransfer: localDrop });
  await localDrop.dispose();
  const classify = page.getByRole("dialog", { name: "上传并加入项目设定" });
  await expect(classify).toBeVisible();
  await classify
    .getByRole("textbox", { name: "素材名称 1" })
    .fill("本地新场景");
  await classify.getByRole("combobox", { name: "素材分类 1" }).click();
  await page.getByRole("option", { name: "场景", exact: true }).click();
  await classify.getByRole("button", { name: "上传并关联" }).click();
  await expect(
    strip.getByRole("button", { name: "本地拖入参考", exact: true }),
  ).toBeVisible();
  await expect(strip.locator(".generation-media-card")).toHaveCount(5);
  await page.getByRole("tab", { name: "场景", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "查看设定卡 本地新场景", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const state = await (await page.request.get(`${base}/canvas`)).json();
      return state.nodes.find((node: { id: string }) => node.id === "shot")
        .generation_draft.reference_asset_ids.length;
    })
    .toBe(2);
  await page.getByRole("tab", { name: "文件", exact: true }).click();
  const fileSource = page
    .locator(".board-material")
    .filter({ hasText: "分镜图1" });
  await fileSource.dragTo(strip);
  await expect(page.getByRole("alert")).toContainText("已经在参考框里");
  await expect(strip.locator(".generation-media-card")).toHaveCount(5);
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
  const storyboard = await (
    await page.request.get(`${base}/storyboard`)
  ).json();
  const shots = [
    { id: crypto.randomUUID(), title: "当前参考目标", video_node_id: "shot" },
    {
      id: crypto.randomUUID(),
      title: "可拖入视频的分镜",
      video_node_id: canvas.nodes[3].id,
    },
  ];
  const savedShots = await page.request.put(`${base}/storyboard`, {
    headers,
    data: { expected_revision: storyboard.revision, shots },
  });
  expect(savedShots.ok(), await savedShots.text()).toBeTruthy();
  await page.reload();
  await page.getByRole("tab", { name: "分镜", exact: true }).click();
  await page
    .locator(".storyboard-shot-select")
    .filter({ hasText: "当前参考目标" })
    .click();
  const sourceShot = page
    .locator(".storyboard-shot")
    .filter({ hasText: "可拖入视频的分镜" });
  const videoTile = strip
    .locator(".generation-media-card")
    .filter({ has: page.getByRole("button", { name: /^参考视频/ }) });
  // Remove the existing linked video, then add the same source from its shot.
  await videoTile.hover();
  await videoTile.getByRole("button", { name: /^移除参考文件/ }).click();
  await expect(strip.locator(".generation-media-card")).toHaveCount(4);
  await sourceShot.dragTo(strip);
  await expect(strip.locator(".generation-media-card")).toHaveCount(5);
  await expect(page.getByLabel("镜头标题")).toHaveValue("当前参考目标");
  await expect
    .poll(async () => {
      const state = await (await page.request.get(`${base}/canvas`)).json();
      return state.nodes.find((node: { id: string }) => node.id === "shot")
        .generation_draft.video_asset_ids;
    })
    .toEqual([canvas.nodes[3].asset_id]);
  await page.reload();
  await page.getByRole("tab", { name: "分镜", exact: true }).click();
  await page
    .locator(".storyboard-shot-select")
    .filter({ hasText: "当前参考目标" })
    .click();
  await expect(strip.locator(".generation-media-card")).toHaveCount(5);
  await strip.screenshot({
    path: info.outputPath("reference-drop-restored.png"),
  });
  const outsideResponse = await page.request.post(
    "/v1/visual-workshop/asset-cards",
    {
      headers,
      data: {
        kind: "character",
        title: "尚未收录的角色",
        adopted_asset_id: canvas.nodes[1].asset_id,
      },
    },
  );
  expect(outsideResponse.ok(), await outsideResponse.text()).toBeTruthy();
  const outside = await outsideResponse.json();
  await strip.getByRole("button", { name: "添加参考素材" }).click();
  await expect(
    page.getByRole("menuitem", { name: "跨项目／文件库", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("menuitem", { name: "设定卡", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "添加设定参考" });
  await expect(picker).toBeVisible();
  await expect(picker.getByText(outside.title, { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  const collected = await (await page.request.get(`${base}/canvas`)).json();
  const target = collected.nodes.find(
    (node: { id: string }) => node.id === "shot",
  );
  target.generation_draft.reference_asset_ids.push(canvas.nodes[1].asset_id);
  target.generation_draft.design_references.push({
    card_id: outside.id,
    card_revision: outside.revision,
    asset_id: canvas.nodes[1].asset_id,
    title: outside.title,
  });
  const withOutside = await page.request.put(`${base}/canvas`, {
    headers,
    data: {
      expected_revision: collected.revision,
      nodes: collected.nodes,
      edges: collected.edges,
      project_card_ids: [...collected.project_card_ids, outside.id],
    },
  });
  expect(withOutside.ok(), await withOutside.text()).toBeTruthy();
  const retained = await page.request.put(`${base}/canvas`, {
    headers,
    data: {
      expected_revision: (await withOutside.json()).revision,
      nodes: collected.nodes,
      edges: collected.edges,
      project_card_ids: collected.project_card_ids,
    },
  });
  expect(retained.ok(), await retained.text()).toBeTruthy();
  await page.reload();
  await page.getByRole("tab", { name: "分镜", exact: true }).click();
  await page
    .locator(".storyboard-shot-select")
    .filter({ hasText: "当前参考目标" })
    .click();
  const repair = page.getByRole("button", {
    name: `收录到项目：${outside.title}`,
    exact: true,
  });
  await expect(repair).toBeVisible();
  const submissions: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/generation-(tasks|batches)$/.test(new URL(request.url()).pathname)
    )
      submissions.push(request.url());
  });
  await page.getByRole("button", { name: "生成视频", exact: true }).click();
  await expect(
    page.getByText("请先修复未收录到当前项目或不可用的参考设定。", {
      exact: true,
    }),
  ).toBeVisible();
  expect(submissions).toEqual([]);
  await repair.click();
  await expect(repair).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`${base}/canvas`)).json())
          .project_card_ids,
    )
    .toContain(outside.id);
  await strip.screenshot({
    path: info.outputPath("project-reference-repaired.png"),
  });
});
