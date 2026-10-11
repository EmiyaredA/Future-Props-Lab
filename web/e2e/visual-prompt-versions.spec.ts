import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { setResponsiveTheme } from "./responsive-capture";

for (const kind of ["image", "video", "audio"] as const) {
  for (const width of [1440, 390]) {
    test(`提示词版本独立保存与视图切换 (${kind}, ${width})`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/apps/visual-workshop");
      const csrf = (await page.context().cookies()).find(
        (cookie) => cookie.name === "fpl_csrf",
      )!.value;
      const headers = {
        "X-CSRF-Token": csrf,
        Origin: new URL(page.url()).origin,
      };
      const created = await page.request.post("/v1/visual-workshop/projects", {
        headers,
        data: { title: "提示词版本验收", kind: "canvas" },
      });
      expect(created.ok()).toBeTruthy();
      const id = (await created.json()).id as string;
      const base = `/v1/visual-workshop/projects/${id}`;
      const saved = await page.request.put(`${base}/canvas`, {
        headers,
        data: {
          expected_revision: 0,
          edges: [],
          nodes: [
            {
              id: "target",
              title: "提示词方案",
              kind,
              position: { x: 240, y: 120 },
              generation_draft: { prompt: "原始提示词" },
            },
          ],
        },
      });
      expect(saved.ok(), await saved.text()).toBeTruthy();
      await page.goto(`${base.replace("/v1/", "/apps/")}/canvas`);
      await page.getByRole("button", { name: "看板", exact: true }).click();
      await setResponsiveTheme(page, width === 390 ? "dark" : "light");
      const promptName =
        kind === "image"
          ? "图片提示词"
          : kind === "video"
            ? "视频提示词"
            : "音频提示词";
      const prompt = page.getByRole("textbox", { name: promptName });
      await expect(prompt).toBeVisible();
      await page.getByRole("button", { name: "复制提示词版本" }).click();
      await prompt.fill("第二版新内容");
      const select = page.getByRole("combobox", { name: "提示词版本" });
      await select.click();
      await page.getByRole("option", { name: "v1", exact: true }).click();
      if (kind === "audio") await expect(prompt).toHaveValue("原始提示词");
      else await expect(prompt).toHaveText("原始提示词");
      await prompt.fill("第一版新内容");
      await select.click();
      await page.getByRole("option", { name: "v2", exact: true }).click();
      if (kind === "audio") await expect(prompt).toHaveValue("第二版新内容");
      else await expect(prompt).toHaveText("第二版新内容");
      await page.getByRole("button", { name: "重命名提示词版本" }).click();
      const dialog = page.getByRole("dialog", { name: "重命名提示词版本" });
      await dialog.getByLabel("版本名称").fill("舞蹈方案");
      await dialog.getByRole("button", { name: "确认", exact: true }).click();
      await expect(select).toContainText("舞蹈方案");
      await expect
        .poll(async () => {
          const current = await (
            await page.request.get(`${base}/canvas`)
          ).json();
          return current.nodes[0].generation_draft.prompt_versions.map(
            (version: { name: string; prompt: string }) => [
              version.name,
              version.prompt,
            ],
          );
        })
        .toEqual([
          ["v1", "第一版新内容"],
          ["舞蹈方案", "第二版新内容"],
        ]);
      const controls = page.getByRole("group", { name: "提示词版本管理" });
      const box = (await controls.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: info.outputPath("prompt-versions.png") });
      await page.reload();
      await page.getByRole("button", { name: "看板", exact: true }).click();
      await expect(select).toContainText("舞蹈方案");
      if (width === 1440) {
        await page.getByRole("button", { name: "画布", exact: true }).click();
        await page
          .locator('[data-node-id="target"] .canvas-node-media')
          .click();
        await page.getByRole("button", { name: "替换素材" }).click();
        await page.getByRole("tab", { name: "AI 生成" }).click();
        await expect(select).toContainText("舞蹈方案");
        // Simulate a lazy-loaded thought-workshop stylesheet arriving last.
        await page.addStyleTag({
          content: readFileSync(
            new URL(
              "../src/features/thought-workshop/diagrams/diagrams.css",
              import.meta.url,
            ),
            "utf8",
          ),
        });
        await expect(select).toHaveCSS("min-height", "36px");
        await expect(select.locator(".select-chevron")).toHaveCSS(
          "width",
          /^(14|15)px$/,
        );
        await expect(select.locator(".select-chevron")).toHaveCSS(
          "height",
          /^(14|15)px$/,
        );
        const attachedControls = page.getByRole("group", {
          name: "提示词版本管理",
        });
        for (const button of await attachedControls
          .locator(".prompt-version-actions button")
          .all()) {
          await expect(button).toHaveCSS("white-space", "nowrap");
          await expect(button.locator("svg")).toHaveCSS("width", /^(14|15)px$/);
          await expect(button.locator("svg")).toHaveCSS(
            "height",
            /^(14|15)px$/,
          );
          expect((await button.boundingBox())!.height).toBeLessThan(50);
        }
        const replace = page.locator(
          '[data-node-id="target"] .canvas-media-replace',
        );
        await expect(replace).toHaveCSS("white-space", "nowrap");
        await expect(replace.locator("svg")).toHaveCSS("width", /^(14|15)px$/);
        await expect(replace.locator("svg")).toHaveCSS("height", /^(14|15)px$/);
        await page.screenshot({
          path: info.outputPath("attached-prompt-versions.png"),
        });
      }
      await page.getByRole("button", { name: "删除提示词版本" }).click();
      await page.getByRole("button", { name: "删除版本", exact: true }).click();
      await expect(select).toContainText("v1");
      await expect(
        page.getByRole("button", { name: "删除提示词版本" }),
      ).toBeDisabled();
    });
  }
}
