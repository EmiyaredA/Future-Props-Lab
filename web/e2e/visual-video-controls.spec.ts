import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setResponsiveTheme } from "./responsive-capture";

for (const width of [1440, 390]) {
  test(`video modes share compact reference and prompt controls (${width})`, async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    page.setDefaultTimeout(10_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.route("**/v1/visual-workshop/generation-options", (route) =>
      route.fulfill({
        json: {
          models: [
            {
              id: "controls",
              provider_id: "test",
              provider_name: "隔离验收",
              kind: "video",
              slug: "doubao-seedance-2-0-260128",
              label: "统一控件验收",
              description: "",
              sizes: [],
              supports_seed: false,
              max_reference_images: 9,
              max_prompt_length: 6000,
              video_capabilities: {
                duration_min: 5,
                duration_max: 15,
                default_duration: 5,
                resolutions: ["720p"],
                ratios: ["16:9"],
                reference_limits: { image: 9, video: 1, audio: 1 },
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
    const headers = {
      "X-CSRF-Token": csrf,
      Origin: new URL(page.url()).origin,
    };
    const created = await page.request.post("/v1/visual-workshop/projects", {
      headers,
      data: { title: "视频控件统一验收", kind: "canvas" },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const id = (await created.json()).id;
    const base = `/v1/visual-workshop/projects/${id}`;
    let canvas = {
      revision: 0,
      nodes: [] as Record<string, unknown>[],
      edges: [],
    };
    for (const name of ["首帧参考.png", "尾帧参考.png"]) {
      const uploaded = await page.request.post(`${base}/node-uploads`, {
        headers,
        multipart: {
          expected_revision: String(canvas.revision),
          file: {
            name,
            mimeType: "image/png",
            buffer: readFileSync(
              resolve("public/brand/visual-workshop-mark-cutout.png"),
            ),
          },
        },
      });
      expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
      canvas = await uploaded.json();
    }
    const sources = canvas.nodes;
    const assets = sources.map((node) => node.asset_id);
    for (const mode of ["text", "image", "frames", "reference"]) {
      await page.goto("about:blank");
      const current = await (await page.request.get(`${base}/canvas`)).json();
      const saved = await page.request.put(`${base}/canvas`, {
        headers,
        data: {
          expected_revision: current.revision,
          edges: [],
          nodes: [
            ...sources,
            {
              id: "target",
              kind: "video",
              title: `统一尺寸 ${mode}`,
              position: { x: 400, y: 100 },
              generation_draft: {
                model_id: "controls",
                mode,
                duration: 5,
                resolution: "720p",
                ratio: "16:9",
                generate_audio: false,
                watermark: false,
                prompt:
                  "integrated_multimodal_description: [Shot 1] The character walks.\noverall_soundscape: Wind.\nnon_diegetic_music: N/A",
                first_frame_asset_id:
                  mode === "image" || mode === "frames" ? assets[0] : null,
                last_frame_asset_id: mode === "frames" ? assets[1] : null,
                reference_asset_ids: mode === "reference" ? [assets[0]] : [],
              },
            },
          ],
        },
      });
      expect(saved.ok(), await saved.text()).toBeTruthy();
      await page.goto(`/apps/visual-workshop/projects/${id}/canvas`);
      if (width >= 1024)
        await page.getByRole("button", { name: "看板", exact: true }).click();
      else {
        await page.getByRole("button", { name: "项目更多操作" }).click();
        const board = page.getByRole("menuitem", { name: "切换到看板" });
        if (await board.isEnabled()) await board.click();
        else await page.keyboard.press("Escape");
      }
      if (width < 1024)
        await page.getByRole("tab", { name: "文件", exact: true }).click();
      await page.locator('.board-material[data-amadeus-id="target"]').click();
      const composer = page.getByRole("complementary", {
        name: "节点 AI 生成",
      });
      const toolbar = composer.locator(".reference-strip-toolbar");
      await expect(
        composer.getByRole("region", { name: "视频提示词渲染预览" }),
      ).toBeVisible();
      for (const theme of ["dark", "light"]) {
        await setResponsiveTheme(page, theme);
        await toolbar.scrollIntoViewIfNeeded();
        const dimensions = await composer
          .locator(
            ".reference-strip-toolbar .custom-select-trigger, .reference-add, .prompt-version-controls .custom-select-trigger, .prompt-version-actions button, .prompt-render-toolbar button",
          )
          .evaluateAll((buttons) =>
            buttons.map((button) => {
              const rect = button.getBoundingClientRect(),
                style = getComputedStyle(button);
              return {
                height: rect.height,
                font: style.fontSize,
                radius: style.borderRadius,
                left: rect.left,
                right: rect.right,
              };
            }),
          );
        expect(dimensions.length).toBeGreaterThanOrEqual(9);
        for (const control of dimensions) {
          expect(control.height).toBe(32);
          expect(control.font).toBe("12px");
          expect(control.radius).toBe("7px");
          expect(control.left).toBeGreaterThanOrEqual(0);
          expect(control.right).toBeLessThanOrEqual(width);
        }
        const tiles = await composer
          .locator(".generation-media-open, .generation-media-upload")
          .evaluateAll((elements) =>
            elements.map((element) => {
              const rect = element.getBoundingClientRect();
              return { width: rect.width, height: rect.height };
            }),
          );
        expect(tiles.length).toBeGreaterThan(0);
        for (const tile of tiles)
          expect(tile).toEqual({ width: 64, height: 64 });
        await page.screenshot({
          path: info.outputPath(`${mode}-${theme}.png`),
        });
      }
      if (mode === "frames") {
        await composer.getByRole("button", { name: "添加参考素材" }).click();
        await page
          .getByRole("menuitem", { name: "引用任务输出", exact: true })
          .click();
        await expect(
          page.getByRole("dialog", { name: "引用任务输出", exact: true }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
      }
    }
  });
}
