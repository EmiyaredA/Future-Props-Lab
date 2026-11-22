import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setResponsiveTheme } from "./responsive-capture";

const capabilities = {
  duration_min: 5,
  duration_max: 25,
  default_duration: 10,
  supports_auto_duration: false,
  resolutions: ["768p"],
  ratios: ["9:16", "16:9"],
  reference_limits: { image: 9, video: 1, audio: 0 },
  reference_minimums: { image: 1, video: 0, audio: 0 },
  reference_mime_types: { image: ["image/png"], video: ["video/mp4"] },
  audio_only: false,
  frames_require_adaptive_ratio: false,
  default_generate_audio: false,
  reference_video_upload_configured: true,
  supported_modes: ["reference"],
  supports_prompt: true,
  prompt_required: false,
  max_prompt_length: 2048,
  supports_duration: true,
  duration_label: "时长",
  supports_ratio: true,
  supports_watermark: false,
  supports_generate_audio: false,
  supports_seed: false,
  supports_video_subject_to_replace: true,
  uses_temporary_reference_urls: true,
  default_resolution: "768p",
  default_ratio: "9:16",
  resolution_ratios: { "768p": ["9:16", "16:9"] },
};

test("统一参考区保留固定版本、追踪绑定、排序及刷新，并提供紧凑响应式界面", async ({
  page,
}, info) => {
  test.setTimeout(100_000);
  await page.route("**/v1/visual-workshop/generation-options", (route) =>
    route.fulfill({
      json: {
        models: [
          {
            id: "reference-test",
            provider_id: "test-provider",
            provider_name: "隔离验收",
            kind: "video",
            slug: "minimax_h3_zm_titim",
            label: "H3多角色替换",
            description: "",
            sizes: [],
            supports_seed: false,
            max_reference_images: 9,
            max_prompt_length: 2048,
            video_capabilities: capabilities,
          },
        ],
      },
    }),
  );
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/visual-workshop");
  const csrf = (await page.context().cookies()).find(
    ({ name }) => name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const created = await page.request.post("/v1/visual-workshop/projects", {
    headers,
    data: { title: "紧凑参考 · 追踪对象验收", kind: "canvas" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const base = `/v1/visual-workshop/projects/${(await created.json()).id}`;
  let canvas = { revision: 0, nodes: [] as Record<string, unknown>[] };
  for (const [name, path] of [
    ["角色参考.png", "public/brand/visual-workshop-mark-cutout.png"],
    ["前景手参考.png", "public/brand/amadeus/amadeus-poster.png"],
  ]) {
    const uploaded = await page.request.post(`${base}/node-uploads`, {
      headers,
      multipart: {
        expected_revision: String(canvas.revision),
        file: {
          name,
          mimeType: "image/png",
          buffer: readFileSync(resolve(path)),
        },
      },
    });
    expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
    canvas = await uploaded.json();
  }
  const sources = canvas.nodes.map((node) => ({ ...node }));
  const edges = sources.map((node, index) => ({
    id: `subject-edge-${index}`,
    source_node_id: node.id,
    target_node_id: "shot",
    binding: index === 0 ? "final" : "fixed",
    output_id: index === 0 ? null : node.final_output_id,
  }));
  const prompt =
    "<Picture 1> is the main character. <Picture 2> is the foreground hand. Preserve the source choreography.";
  const saved = await page.request.put(`${base}/canvas`, {
    headers,
    data: {
      expected_revision: canvas.revision,
      nodes: [
        ...sources,
        {
          id: "shot",
          kind: "video",
          title: "H3多角色替换 · 参考整合",
          position: { x: 400, y: 100 },
          generation_draft: {
            model_id: "reference-test",
            mode: "reference",
            prompt,
            duration: 10,
            resolution: "768p",
            ratio: "9:16",
            workflow_parameters: { video_subject_to_replace: "person, hand" },
          },
        },
      ],
      edges,
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.goto(
    `/apps/visual-workshop/projects/${(await created.json()).id}/canvas`,
  );
  await page.getByRole("button", { name: "看板", exact: true }).click();
  await page
    .locator(".board-material")
    .filter({ hasText: "H3多角色替换 · 参考整合" })
    .click();
  await expect(
    page.getByRole("region", { name: "输入引用", exact: true }),
  ).toHaveCount(0);
  const strip = page.getByRole("region", { name: "参考素材", exact: true });
  await expect(strip).toBeVisible();
  const subjectButtons = strip.getByRole("button", { name: /^追踪对象 / });
  await expect(subjectButtons).toHaveCount(2);
  await expect(subjectButtons.nth(0)).toContainText("人");
  await expect(subjectButtons.nth(1)).toContainText("手");
  const snapshot = async () =>
    await (await page.request.get(`${base}/canvas`)).json();
  const draft = async () =>
    (await snapshot()).nodes.find((node: { id: string }) => node.id === "shot")
      .generation_draft;
  await expect
    .poll(async () => (await draft()).reference_subjects)
    .toEqual({
      "edge:subject-edge-0": "person",
      "edge:subject-edge-1": "hand",
    });
  await subjectButtons.nth(1).click();
  const editor = page.getByRole("dialog", { name: "追踪对象", exact: true });
  await editor
    .getByRole("textbox", { name: "自定义追踪对象" })
    .fill("right hand with white lab coat sleeve");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .poll(async () => (await draft()).reference_subjects["edge:subject-edge-1"])
    .toBe("right hand with white lab coat sleeve");
  const details = strip.getByRole("button", { name: /^参考详情 / }).nth(1);
  await details.hover();
  await expect(page.getByRole("tooltip")).toContainText("固定 v1");
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("desktop-reference-details.png"),
  });
  await details.click();
  await page.getByRole("menuitem", { name: "前移", exact: true }).click();
  await expect
    .poll(async () => (await draft()).reference_order)
    .toEqual(["edge:subject-edge-1", "edge:subject-edge-0"]);
  await expect
    .poll(async () => (await draft()).prompt)
    .toContain("<Picture 2> is the main character");
  await page.reload();
  await page
    .locator(".board-material")
    .filter({ hasText: "H3多角色替换 · 参考整合" })
    .click();
  await expect(subjectButtons.nth(0)).toContainText("right hand");
  await expect(subjectButtons.nth(1)).toContainText("人");
  expect((await strip.boundingBox())!.height).toBeLessThan(175);
  await strip.getByRole("button", { name: "添加参考素材" }).click();
  await page
    .getByRole("menuitem", { name: "引用任务输出", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "引用任务输出", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  for (const theme of ["light", "dark"] as const) {
    await setResponsiveTheme(page, theme);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(strip).toBeVisible();
      const overflow = await page.evaluate(() =>
        Array.from(document.querySelectorAll(".board-main *")).flatMap(
          (element) => {
            const box = element.getBoundingClientRect();
            return box.right > innerWidth + 1 && box.width > 0
              ? [
                  {
                    tag: element.tagName,
                    className: element.className,
                    right: box.right,
                    width: box.width,
                  },
                ]
              : [];
          },
        ),
      );
      if (
        (await page.evaluate(() => document.documentElement.scrollWidth)) >
        width
      )
        await info.attach("overflow-diagnostics", {
          body: JSON.stringify(overflow),
          contentType: "application/json",
        });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      const modeBounds = (await strip
        .getByRole("combobox", { name: "视频生成方式" })
        .boundingBox())!;
      const addBounds = (await strip
        .getByRole("button", { name: "添加参考素材" })
        .boundingBox())!;
      const expandBounds = (await strip
        .getByRole("button", { name: "展开视频生成器" })
        .boundingBox())!;
      expect(Math.abs(modeBounds.y - addBounds.y)).toBeLessThanOrEqual(4);
      expect(Math.abs(modeBounds.y - expandBounds.y)).toBeLessThanOrEqual(4);
      const composerBounds = (await page
        .getByRole("complementary", { name: "节点 AI 生成" })
        .boundingBox())!;
      expect(modeBounds.x - composerBounds.x).toBeGreaterThanOrEqual(12);
      expect(modeBounds.y - composerBounds.y).toBeGreaterThanOrEqual(10);
      expect((await strip.boundingBox())!.height).toBeLessThan(175);
      await page.screenshot({
        animations: "disabled",
        path: info.outputPath(`mobile-${theme}-${width}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await setResponsiveTheme(page, "light");
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("desktop-compact-references.png"),
  });
  const legacy = await snapshot();
  const legacyNode = legacy.nodes.find(
    (node: { id: string }) => node.id === "shot",
  );
  legacyNode.generation_draft.reference_subjects = null;
  legacyNode.generation_draft.workflow_parameters = {
    video_subject_to_replace: "person, hand, face",
  };
  const mismatched = await page.request.put(`${base}/canvas`, {
    headers,
    data: {
      expected_revision: legacy.revision,
      nodes: legacy.nodes,
      edges: legacy.edges,
    },
  });
  expect(mismatched.ok(), await mismatched.text()).toBeTruthy();
  await page.reload();
  await page
    .locator(".board-material")
    .filter({ hasText: "H3多角色替换 · 参考整合" })
    .click();
  await expect(subjectButtons.nth(0)).toBeDisabled();
  await expect(subjectButtons.nth(1)).toBeDisabled();
  expect((await draft()).workflow_parameters.video_subject_to_replace).toBe(
    "person, hand, face",
  );
  await page.getByRole("button", { name: "待关联目标 3", exact: true }).click();
  const legacyDialog = page.getByRole("dialog", {
    name: "关联旧追踪对象",
    exact: true,
  });
  await legacyDialog
    .getByRole("combobox", { name: "关联目标 前景手参考" })
    .click();
  await page.getByRole("option", { name: "手", exact: true }).click();
  await legacyDialog
    .getByRole("combobox", { name: "关联目标 角色参考" })
    .click();
  await page.getByRole("option", { name: "人", exact: true }).click();
  await legacyDialog.getByRole("button", { name: "保存图片关联" }).click();
  await expect
    .poll(async () => (await draft()).reference_subjects)
    .toEqual({
      "edge:subject-edge-1": "hand",
      "edge:subject-edge-0": "person",
    });
});
