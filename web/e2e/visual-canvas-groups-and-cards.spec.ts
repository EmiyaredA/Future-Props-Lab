import { expect, test } from "@playwright/test";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";

test("常用设定收录后可重开，编组拖动、解组和撤销保留节点", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/apps/visual-workshop");
  const csrf = (await page.context().cookies()).find(
    ({ name }) => name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const visual = "/v1/visual-workshop";
  const project = await page.request.post(`${visual}/projects`, {
    headers,
    data: { title: "设定与编组验收", kind: "canvas" },
  });
  expect(project.ok(), await project.text()).toBeTruthy();
  const { id } = await project.json();
  const canvas = `${visual}/projects/${id}/canvas`;
  const saved = await page.request.put(canvas, {
    headers,
    data: {
      expected_revision: 0,
      nodes: [
        {
          id: "group-first",
          title: "首帧",
          kind: "text",
          position: { x: 220, y: 210 },
        },
        {
          id: "group-second",
          title: "尾帧",
          kind: "text",
          position: { x: 630, y: 210 },
        },
      ],
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  for (const [kind, title] of [
    ["character", "林夏"],
    ["scene", "雨夜便利店"],
    ["prop", "牛皮纸信封"],
  ]) {
    const card = await page.request.post(`${visual}/asset-cards`, {
      headers,
      data: { kind, title },
    });
    expect(card.ok(), await card.text()).toBeTruthy();
  }

  await page.goto(`/apps/visual-workshop/projects/${id}/canvas`);
  const first = page.locator('[data-node-id="group-first"]');
  await expect(first).toBeVisible();
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "打组", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "解组", exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () => (await (await page.request.get(canvas)).json()).groups.length,
    )
    .toBe(1);
  const before = await first.evaluate(
    (node) => (node as HTMLElement).style.left,
  );
  const handle = page.getByRole("button", { name: "选择分组 分组" });
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x + 25, bounds.y + 14);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 180, bounds.y + 50, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      first.evaluate((node) => (node as HTMLElement).style.left),
    )
    .not.toBe(before);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.reload();
  await expect(handle).toBeVisible();
  await handle.press("Enter");
  await page.screenshot({ path: testInfo.outputPath("canvas-group.png") });
  await page.getByRole("button", { name: "解组", exact: true }).click();
  await expect(handle).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(handle).toBeVisible();

  await page.getByRole("button", { name: "看板", exact: true }).click();
  for (const [label, title] of [
    ["人设", "林夏"],
    ["场景", "雨夜便利店"],
    ["道具", "牛皮纸信封"],
  ]) {
    await page.getByRole("button", { name: `添加${label}卡` }).click();
    await page.getByRole("menuitem", { name: "从设定库添加" }).click();
    const picker = page.getByRole("dialog", { name: "从设定库添加" });
    await picker.getByRole("button", { name: new RegExp(title) }).click();
    await picker
      .getByRole("button", { name: "添加到项目", exact: true })
      .click();
    await expect(picker).toHaveCount(0);
  }
  await expect
    .poll(
      async () =>
        (await (await page.request.get(canvas)).json()).project_card_ids.length,
    )
    .toBe(3);
  await page.reload();
  await expect(page.getByText("雨夜便利店", { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("project-design-cards.png"),
  });
});

test("镜头跨分类选择卡片并固定采用图版本", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/apps/visual-workshop");
  const csrf = (await page.context().cookies()).find(
    ({ name }) => name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const base = "/v1/visual-workshop";
  const project = await page.request.post(`${base}/projects`, {
    headers,
    data: { title: "镜头设定验收", kind: "canvas" },
  });
  expect(project.ok(), await project.text()).toBeTruthy();
  const { id } = await project.json();
  const path = `${base}/projects/${id}/canvas`;
  const saved = await page.request.put(path, {
    headers,
    data: {
      expected_revision: 0,
      nodes: [
        {
          id: "design-shot",
          kind: "video",
          title: "雨夜分镜",
          position: { x: 240, y: 180 },
        },
      ],
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const assets = [];
  const cards: { id: string; revision: number; title: string; kind: string }[] =
    [];
  for (const [kind, title] of [
    ["character", "镜头角色"],
    ["scene", "镜头场景"],
    ["prop", "镜头道具"],
  ]) {
    const upload = await page.request.post("/v1/files", {
      headers,
      multipart: {
        project_id: id,
        upload: { name: `${title}.png`, mimeType: "image/png", buffer: png },
      },
    });
    expect(upload.ok(), await upload.text()).toBeTruthy();
    const asset = (await upload.json()).id;
    assets.push(asset);
    const card = await page.request.post(`${base}/asset-cards`, {
      headers,
      data: { kind, title, adopted_asset_id: asset },
    });
    expect(card.ok(), await card.text()).toBeTruthy();
    cards.push(await card.json());
  }
  await page.goto(`/apps/visual-workshop/projects/${id}/canvas`);
  await page.getByRole("button", { name: "看板", exact: true }).click();
  await page
    .getByRole("combobox", { name: "视频生成方式", exact: true })
    .click();
  await page.getByRole("option", { name: "全能参考", exact: true }).click();
  await page.getByRole("button", { name: "添加参考素材" }).click();
  await page.getByRole("menuitem", { name: "设定卡", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "添加设定参考" });
  for (const [type, label] of [
    ["角色卡", "镜头角色"],
    ["场景卡", "镜头场景"],
    ["道具卡", "镜头道具"],
  ]) {
    await picker.getByRole("button", { name: type, exact: true }).click();
    await picker.getByRole("button", { name: new RegExp(label) }).click();
  }
  await expect(picker.getByText("已选 3 项")).toBeVisible();
  await picker.getByRole("button", { name: "全部", exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("design-reference-picker.png"),
  });
  await picker
    .getByRole("button", { name: "添加到当前镜头", exact: true })
    .click();
  await expect(picker).toHaveCount(0);
  await expect
    .poll(async () => {
      const draft = (await (await page.request.get(path)).json()).nodes[0]
        .generation_draft;
      return draft?.design_references?.map(
        ({ asset_id }: { asset_id: string }) => asset_id,
      );
    })
    .toEqual(assets);
  const newImage = await page.request.post("/v1/files", {
    headers,
    multipart: {
      project_id: id,
      upload: { name: "替换采用图.png", mimeType: "image/png", buffer: png },
    },
  });
  expect(newImage.ok(), await newImage.text()).toBeTruthy();
  const newImageId = (await newImage.json()).id;
  const previousCard = cards[0]!;
  const changed = await page.request.put(
    `${base}/asset-cards/${previousCard.id}`,
    {
      headers,
      data: {
        expected_revision: previousCard.revision,
        title: previousCard.title,
        kind: previousCard.kind,
        adopted_asset_id: newImageId,
      },
    },
  );
  expect(changed.ok(), await changed.text()).toBeTruthy();
  const currentDraft = async () =>
    (await (await page.request.get(path)).json()).nodes[0].generation_draft;
  expect((await currentDraft()).design_references[0].asset_id).toBe(assets[0]);
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "设定参考" })
      .getByText("镜头角色", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /参考详情.*镜头角色/ }).click();
  await page.getByRole("menuitem", { name: "更新采用图", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await currentDraft()).design_references.find(
          (ref: { card_id: string }) => ref.card_id === previousCard.id,
        )?.asset_id,
    )
    .toBe(newImageId);
});

test("变体使用高清横向滚动缩略图，支持完整名称提示和键盘访问", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1487, height: 1058 });
  await page.goto("/apps/visual-workshop");
  const csrf = (await page.context().cookies()).find(
    ({ name }) => name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const visual = "/v1/visual-workshop";
  const project = await page.request.post(`${visual}/projects`, {
    headers,
    data: { title: "横排变体验收", kind: "canvas" },
  });
  expect(project.ok(), await project.text()).toBeTruthy();
  const { id } = await project.json();
  const uploaded = await page.request.post("/v1/files", {
    headers,
    multipart: {
      upload: {
        name: "variant-reference.webp",
        mimeType: "image/webp",
        buffer: await readFile(
          new URL(
            "../src/features/visual-workshop/creative/design-library-empty.webp",
            import.meta.url,
          ),
        ),
      },
    },
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  const adopted = (await uploaded.json()).id as string;
  const create = async (title: string, parent_id?: string) => {
    const response = await page.request.post(`${visual}/asset-cards`, {
      headers,
      data: {
        title,
        kind: "character",
        parent_id,
        parent_asset_id: parent_id ? adopted : undefined,
        adopted_asset_id: adopted,
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return (await response.json()).id as string;
  };
  const main = await create("变体角色");
  const ids = [main];
  for (const title of [
    "常服 Q 版",
    "墨镜",
    "墨镜 Q 版",
    "泡面桶 Q 版",
    "无鞋舞蹈设定及白色外套的完整长名称",
  ]) {
    ids.push(await create(`变体角色 · ${title}`, main));
  }
  const saved = await page.request.put(`${visual}/projects/${id}/canvas`, {
    headers,
    data: {
      expected_revision: 0,
      nodes: [
        { id: "text", kind: "text", title: "首帧", position: { x: 0, y: 0 } },
      ],
      project_card_ids: ids,
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.goto(`/apps/visual-workshop/projects/${id}/canvas`);
  await page.getByRole("button", { name: "看板", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "查看设定卡 变体角色", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "变体角色 5 款变体" }),
  ).toHaveCount(0);
  await page.goto("/apps/visual-workshop/card-library");
  await page.getByRole("textbox", { name: "搜索角色卡" }).fill("变体角色");
  await page
    .getByRole("button", { name: "角色卡按名称排序", exact: true })
    .click();
  const strip = page.getByRole("group", { name: "变体角色的变体" });
  const choices = strip.locator(".card-variant-select");
  await expect(choices).toHaveCount(5);
  // Lazy board CSS and authenticated image decoding may settle after the DOM.
  await expect
    .poll(async () =>
      choices.evaluateAll((buttons) => {
        const bounds = buttons.map((button) => button.getBoundingClientRect());
        return bounds.every(
          (rect, index) =>
            rect.width > 0 &&
            Math.abs(rect.top - bounds[0].top) < 1 &&
            (index === 0 || rect.left > bounds[index - 1].left),
        );
      }),
    )
    .toBe(true);
  await expect(choices.first()).toHaveCSS("width", "96px");
  expect(await strip.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  );
  const right = page.getByRole("button", { name: "向右滚动变体角色的变体" });
  const left = page.getByRole("button", { name: "向左滚动变体角色的变体" });
  await expect(left).toBeDisabled();
  await right.click();
  await expect
    .poll(() => strip.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(100);
  await expect(left).toBeEnabled();
  await left.click();
  await expect
    .poll(() => strip.evaluate((el) => el.scrollLeft))
    .toBeLessThan(2);
  await strip.hover();
  await page.mouse.wheel(0, 220);
  await expect
    .poll(() => strip.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(100);
  const thumbnail = choices.nth(3).locator("img");
  await expect(thumbnail).toHaveAttribute("data-load-state", "ready");
  expect(
    await thumbnail.evaluate((img: HTMLImageElement) =>
      Math.max(img.naturalWidth, img.naturalHeight),
    ),
  ).toBeGreaterThanOrEqual(320);
  const long = choices.filter({
    hasText: "无鞋舞蹈设定及白色外套的完整长名称",
  });
  await long.hover();
  await expect(page.getByRole("tooltip")).toHaveText(
    "变体角色 · 无鞋舞蹈设定及白色外套的完整长名称 · 已采用图片",
  );
  await page.screenshot({
    path: info.outputPath("variant-filmstrip-tooltip.png"),
  });
  await choices.first().focus();
  await page.keyboard.press("End");
  await expect(long).toBeFocused();
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", {
    name: "变体角色 · 无鞋舞蹈设定及白色外套的完整长名称",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await page.mouse.click(3, 3);
  await expect(editor).toBeHidden();
  await expect(long).toHaveAttribute("aria-pressed", "true");
  await expect(long).toBeFocused();
  for (const width of [1024, 768]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await strip.evaluate((el) => getComputedStyle(el).overflowX)).toBe(
      "auto",
    );
    expect(
      await page
        .locator(".creative-card-library")
        .evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
  }
  await expect(strip).toBeVisible();
});
