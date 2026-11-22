import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createSceneDocument } from "../vendor/toonflow/truman-map/sceneDocument";
import { setResponsiveTheme } from "./responsive-capture";

test("H3 media references, keyboard previews and minimal shot associations preserve original data", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1584, height: 994 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/v1/visual-workshop/generation-options", (route) =>
    route.fulfill({
      json: {
        models: [
          {
            id: "rich-h3",
            kind: "video",
            provider_id: "test",
            provider_name: "隔离验收",
            slug: "doubao-seedance-2-0-260128",
            label: "H3 格式渲染验收",
            description: "",
            sizes: [],
            max_reference_images: 9,
            supports_seed: false,
            video_capabilities: {
              duration_min: 5,
              duration_max: 15,
              default_duration: 5,
              resolutions: ["720p"],
              ratios: ["16:9"],
              reference_limits: { image: 9, video: 2, audio: 2 },
              reference_minimums: { image: 0, video: 0, audio: 0 },
              supported_modes: ["text", "image", "frames", "reference"],
              supports_prompt: true,
              supports_duration: true,
              supports_ratio: true,
              supports_watermark: false,
              supports_generate_audio: false,
              supports_seed: false,
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
  const created = await page.request.post("/v1/visual-workshop/projects", {
    headers,
    data: { title: "H3 素材与分镜关联验收", kind: "canvas" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const project = (await created.json()).id;
  const base = `/v1/visual-workshop/projects/${project}`;
  let canvas = { revision: 0, nodes: [] as Record<string, unknown>[] };
  const clip = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x180:r=12:d=1",
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
  const audio = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-f",
    "wav",
    "pipe:1",
  ]);
  for (const file of [
    {
      name: "角色参考.png",
      mimeType: "image/png",
      buffer: readFileSync(
        resolve("public/brand/visual-workshop-mark-cutout.png"),
      ),
    },
    { name: "动作参考.mp4", mimeType: "video/mp4", buffer: clip },
    { name: "声音参考.wav", mimeType: "audio/wav", buffer: audio },
  ]) {
    const uploaded = await page.request.post(`${base}/node-uploads`, {
      headers,
      multipart: { expected_revision: String(canvas.revision), file },
    });
    expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
    canvas = await uploaded.json();
  }
  const sourceImage = canvas.nodes.find((node) => node.kind === "image")!;
  const sourceVideo = canvas.nodes.find((node) => node.kind === "video")!;
  const sourceAudio = canvas.nodes.find((node) => node.kind === "audio")!;
  const stageResponse = await page.request.post(`${base}/previs-scenes`, {
    headers,
    data: {
      title: "天台场景",
      format_version: 1,
      document: createSceneDocument(),
    },
  });
  expect(stageResponse.ok(), await stageResponse.text()).toBeTruthy();
  const stage = await stageResponse.json();
  const source = `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video.

subject_definitions
<Subject 1> is the character in <Picture 1>, following the motion of <Video 1>.
<Audio 1> is the voice reference for <Subject 1> (S1).
summary
[reference generation + audio reference] Keep the character and camera.
retention_analysis
<Subject 1>: fully_preserved
<Audio 1>: reference
detailed_description
[Shot 1, first 4.600s] The camera pushes in toward <Subject 1>. Follow <Picture 1> and the motion of <Video 1>. (S1) says <d>[Chinese] 原句保持，<scenetrans>跨镜延续。</d>
[Shot 2] At 00:03.000, Static Shot. <Audio 1> provides the voice. (S1) says <d>[Chinese] 到这里<cutoff></d> near a sign reading "营业中".
overall_soundscape
Footsteps and city wind.
non_diegetic_music
N/A`;
  const saved = await page.request.put(`${base}/canvas`, {
    headers,
    data: {
      expected_revision: canvas.revision,
      edges: [],
      nodes: [
        ...canvas.nodes.map((node) => ({
          ...node,
          ...(node.id === sourceImage.id
            ? { tags: ["白模预演", `${stage.id}@${stage.revision}`] }
            : {}),
        })),
        {
          id: "target",
          kind: "video",
          title: "全息凝视",
          asset_id: sourceVideo.asset_id,
          position: { x: 600, y: 0 },
          generation_draft: {
            model_id: "rich-h3",
            mode: "reference",
            duration: 5,
            ratio: "16:9",
            resolution: "720p",
            prompt: source,
            reference_asset_ids: [sourceImage.asset_id],
            video_asset_ids: [sourceVideo.asset_id],
            audio_asset_ids: [sourceAudio.asset_id],
          },
        },
      ],
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  const shotId = randomUUID();
  const board = await page.request.put(`${base}/storyboard`, {
    headers,
    data: {
      expected_revision: 0,
      shots: [
        {
          id: shotId,
          title: "全息凝视",
          description: "固定夜景机位，保持角色与光线。",
          video_node_id: "target",
          shot_size: "保留旧景别",
          camera_motion: "保留旧运镜",
          duration: 9.25,
          dialogue: "旧对白",
          sound: "旧声音",
          previs: { scene_id: stage.id, stage_revision: stage.revision },
        },
      ],
    },
  });
  expect(board.ok(), await board.text()).toBeTruthy();
  await page.goto(`/apps/visual-workshop/projects/${project}/canvas`);
  await page.getByRole("button", { name: "看板", exact: true }).click();
  await page.getByRole("tab", { name: "分镜", exact: true }).click();
  const preview = page.getByRole("region", { name: "视频提示词渲染预览" });
  await expect(preview).toBeVisible();
  await expect(preview).not.toContainText("How the reference pictures align");
  await expect(preview).not.toContainText("detailed_description");
  await expect(preview).toContainText("镜头1 · first 4.600s");
  await expect(preview.locator(".prompt-mention-hint")).toHaveCount(0);
  const help = page.getByRole("button", {
    name: "提示词编辑说明",
    exact: true,
  });
  await help.hover();
  await expect(page.getByRole("tooltip")).toContainText("输入 @");
  await page.screenshot({ path: info.outputPath("h3-help-tooltip.png") });
  await page.keyboard.press("Escape");
  await expect(
    preview.getByRole("button", { name: "查看图片1" }).first().locator("img"),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "查看视频1" }).first().locator("img"),
  ).toBeVisible();
  const referenceChip = await preview
    .getByRole("button", { name: "查看主体1" })
    .first()
    .boundingBox();
  expect(referenceChip!.height).toBeLessThanOrEqual(24);
  for (const theme of ["dark", "light"]) {
    await setResponsiveTheme(page, theme);
    const audioTile = page.locator(
      '.video-reference-strip .generation-media-open:has([data-media-kind="audio"])',
    );
    await expect(audioTile).toBeVisible();
    const audioBounds = await audioTile.evaluate((button) => {
      const tile = button.getBoundingClientRect();
      const preview = button
        .querySelector(".generation-media-preview")!
        .getBoundingClientRect();
      const icon = button.querySelector("svg")!.getBoundingClientRect();
      return {
        tile: { width: tile.width, height: tile.height },
        preview: { width: preview.width, height: preview.height },
        icon: { width: icon.width, height: icon.height },
        offsetX: Math.abs(icon.x + icon.width / 2 - tile.x - tile.width / 2),
        offsetY: Math.abs(icon.y + icon.height / 2 - tile.y - tile.height / 2),
      };
    });
    expect(audioBounds.tile).toEqual({ width: 64, height: 64 });
    expect(audioBounds.preview.width).toBeGreaterThanOrEqual(56);
    expect(audioBounds.preview.height).toBeGreaterThanOrEqual(56);
    expect(audioBounds.icon).toEqual({ width: 24, height: 24 });
    expect(audioBounds.offsetX).toBeLessThanOrEqual(1);
    expect(audioBounds.offsetY).toBeLessThanOrEqual(1);
    await audioTile.press("Enter");
    const audioDialog = page.getByRole("dialog", { name: /声音参考/ });
    await expect(audioDialog.locator("audio")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(audioTile).toBeFocused();
    const heights = await preview
      .locator(
        ".prompt-reference, .is-shot.prompt-render-token, .is-speaker, .is-language, .is-relationship, .prompt-render-task, .prompt-render-marker, h3",
      )
      .evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().height),
      );
    expect(new Set(heights)).toEqual(new Set([22]));
    const lines = await preview
      .locator(".prompt-render-block")
      .evaluateAll((elements) =>
        elements.map((element) => ({
          lineHeight: getComputedStyle(element).lineHeight,
          marginTop: getComputedStyle(element).marginTop,
          marginBottom: getComputedStyle(element).marginBottom,
        })),
      );
    expect(
      lines.every(
        (line) =>
          line.lineHeight === "24px" &&
          line.marginTop === "0px" &&
          line.marginBottom === "0px",
      ),
    ).toBe(true);
    await page.getByRole("tab", { name: "镜头属性", exact: true }).click();
    await expect(page.getByLabel("分镜描述", { exact: true })).toBeVisible();
    await expect(page.getByLabel("景别", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("对白", { exact: true })).toHaveCount(0);
    await expect(
      page
        .getByRole("region", { name: "白模预演输出" })
        .getByRole("button", { name: /查看预演输出/ }),
    ).toHaveCount(1);
    await page.screenshot({ path: info.outputPath(`h3-rich-${theme}.png`) });
  }
  for (const [name, kind] of [
    ["图片1", "img"],
    ["视频1", "video"],
    ["音频1", "audio"],
  ]) {
    const trigger = preview
      .getByRole("button", { name: `查看${name}` })
      .first();
    await trigger.click();
    const popup = page.getByRole("dialog", { name: `${name}预览` });
    await expect(popup).toBeVisible();
    await expect(popup.locator(kind)).toBeVisible();
    await page.screenshot({ path: info.outputPath(`h3-${kind}-popover.png`) });
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  await preview.getByRole("button", { name: "查看音频1" }).first().click();
  const popup = page.getByRole("dialog", { name: "音频1预览" });
  await expect(popup).toBeVisible();
  const box = (await popup.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath("h3-narrow-popover.png") });
  await page.keyboard.press("Escape");
  const current = await (await page.request.get(`${base}/canvas`)).json();
  expect(
    current.nodes.find((node: { id: string }) => node.id === "target")
      .generation_draft.prompt,
  ).toBe(source);
  await page.setViewportSize({ width: 1584, height: 994 });
  const template = page.getByRole("combobox", { name: "提示词渲染模板" });
  await template.click();
  const templateMenu = page.getByRole("listbox", { name: "提示词渲染模板" });
  const rows = await templateMenu.getByRole("option").evaluateAll((items) =>
    items.map((item) => ({
      height: item.getBoundingClientRect().height,
      border: getComputedStyle(item).borderTopWidth,
    })),
  );
  expect(rows).toHaveLength(2);
  expect(rows.every((row) => row.height <= 34 && row.border === "0px")).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath("h3-template-menu.png") });
  await page.keyboard.press("Escape");
  await expect(template).toBeFocused();

  const editor = preview.getByRole("textbox", { name: "视频提示词" });
  await editor.evaluate((root) => {
    const token = [
      ...root.querySelectorAll<HTMLElement>("[data-prompt-source-start]"),
    ].find((element) => element.textContent?.includes("Follow "))!;
    root.focus();
    const range = document.createRange();
    range.setStart(
      token.firstChild!,
      token.textContent!.indexOf("Follow ") + 7,
    );
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  await page.keyboard.type("@");
  const mentions = page.getByRole("listbox", { name: "引用已选素材" });
  await expect(
    mentions.getByRole("option", { name: "视频1", exact: true }),
  ).toBeVisible();
  await expect(
    mentions.getByRole("option", { name: "音频1", exact: true }),
  ).toBeVisible();
  await expect(
    mentions.getByRole("option", { name: "说话人 S1", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("h3-inline-mentions.png") });
  await mentions.getByRole("option", { name: "图1", exact: true }).click();
  let expectedSource = source.replace(
    "Follow <Picture 1>",
    "Follow <Picture 1><Picture 1>",
  );
  const readPrompt = async () => {
    const latest = await (await page.request.get(`${base}/canvas`)).json();
    return latest.nodes.find((node: { id: string }) => node.id === "target")
      .generation_draft.prompt;
  };
  await expect.poll(readPrompt).toBe(expectedSource);
  await expect(editor).toBeFocused();
  await editor.press("ControlOrMeta+Home");
  for (let index = 0; index < 5; index += 1) await editor.press("Backspace");
  await expect(
    preview.getByRole("heading", { name: "主体定义", exact: true }),
  ).toBeVisible();
  await editor.press("Enter");
  await page.keyboard.type("Added");
  await editor.press("Enter");
  expectedSource = expectedSource.replace(
    "subject_definitions\n",
    "subject_definitions\n\nAdded\n",
  );
  await page.getByRole("button", { name: "复制原文", exact: true }).focus();
  await expect.poll(readPrompt).toBe(expectedSource);
  await expect(
    preview.getByRole("button", { name: "查看主体1" }).first(),
  ).toHaveText("主体1");
  await expect(
    preview.getByRole("button", { name: "查看主体1" }).first().locator("img"),
  ).toHaveCount(0);
  await editor.focus();
  await editor.evaluate((root) => {
    const token = [
      ...root.querySelectorAll<HTMLElement>("[data-prompt-source-start]"),
    ].find(
      (element) =>
        element.firstChild?.nodeType === Node.TEXT_NODE &&
        element.textContent?.includes("Keep the character"),
    )!;
    const start = token.textContent!.indexOf("Keep");
    const range = document.createRange();
    range.setStart(token.firstChild!, start);
    range.setEnd(token.firstChild!, start + 4);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.keyboard.type("Retain");
  expectedSource = expectedSource.replace(
    "Keep the character",
    "Retain the character",
  );
  await page.getByRole("button", { name: "复制原文", exact: true }).focus();
  await expect.poll(readPrompt).toBe(expectedSource);
  await editor.focus();
  await editor.press("ControlOrMeta+End");
  await page.keyboard.type("@");
  await mentions.getByRole("option", { name: "插入对白", exact: true }).click();
  await page
    .getByRole("textbox", { name: "对白内容", exact: true })
    .fill("新对白保持原文。");
  await page.getByRole("button", { name: "插入", exact: true }).click();
  expectedSource += "<d>[Chinese] 新对白保持原文。</d>";
  await expect.poll(readPrompt).toBe(expectedSource);
  await expect(preview.getByLabel("对白或歌词").last()).toContainText(
    "新对白保持原文。",
  );
  const lastLine = editor.locator(".prompt-render-block").last();
  const lastBox = (await lastLine.boundingBox())!;
  await lastLine.click({ position: { x: lastBox.width - 8, y: 12 } });
  await page.keyboard.type(" tail");
  expectedSource += " tail";
  await page.getByRole("button", { name: "复制原文", exact: true }).focus();
  await expect.poll(readPrompt).toBe(expectedSource);
  await page.screenshot({
    path: info.outputPath("h3-after-boundary-editing.png"),
  });
  await page.getByLabel("分镜描述", { exact: true }).fill("修改后的分镜描述。");
  await page.getByRole("button", { name: "保存分镜", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`${base}/storyboard`)).json()).shots[0]
          .description,
    )
    .toBe("修改后的分镜描述。");
  const final = await (await page.request.get(`${base}/storyboard`)).json();
  expect(final.shots[0]).toMatchObject({
    shot_size: "保留旧景别",
    camera_motion: "保留旧运镜",
    dialogue: "旧对白",
    sound: "旧声音",
    duration: 9.25,
  });
  expect(errors).toEqual([]);
});
