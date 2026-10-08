import { expect, test } from "@playwright/test";
import { setResponsiveTheme } from "./responsive-capture";

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`看板默认折叠输入与加大提示词 (${theme}, ${width})`, async ({
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
        data: { title: "工作台编辑验收", kind: "canvas" },
      });
      expect(created.ok()).toBeTruthy();
      const id = (await created.json()).id as string;
      const saved = await page.request.put(
        `/v1/visual-workshop/projects/${id}/canvas`,
        {
          headers,
          data: {
            expected_revision: 0,
            nodes: [
              {
                id: "target",
                kind: "video",
                title: "视频提示词",
                position: { x: 0, y: 0 },
              },
              ...Array.from({ length: 7 }, (_, i) => ({
                id: `source-${i}`,
                kind: "text",
                title: `输入说明${i + 1}`,
                text: "角色参考说明",
                position: { x: 400, y: i * 220 },
              })),
            ],
            edges: Array.from({ length: 7 }, (_, i) => ({
              id: `edge-${i}`,
              source_node_id: `source-${i}`,
              target_node_id: "target",
            })),
          },
        },
      );
      expect(saved.ok(), await saved.text()).toBeTruthy();
      await page.goto(`/apps/visual-workshop/projects/${id}/canvas`);
      await page.getByRole("button", { name: "看板", exact: true }).click();
      await setResponsiveTheme(page, theme);
      const inputs = page.getByRole("region", { name: "输入引用" });
      const toggle = inputs.getByRole("button", { name: "输入素材 7" });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(inputs.locator(".board-input-row")).toHaveCount(0);
      const prompt = page.getByRole("textbox", { name: "视频提示词" });
      await expect(prompt).toBeVisible();
      expect((await prompt.boundingBox())!.height).toBeGreaterThanOrEqual(280);
      await page.getByRole("button", { name: "全能参考", exact: true }).click();
      const references = page.getByRole("group", { name: "固定参考素材" });
      for (const label of ["参考图片", "参考视频", "参考音频"]) {
        await expect(
          references.locator("legend", { hasText: label }),
        ).toBeVisible();
      }
      const composer = page.getByRole("complementary", {
        name: "节点 AI 生成",
      });
      const composerBounds = (await composer.boundingBox())!;
      expect(composerBounds.x).toBeGreaterThanOrEqual(0);
      expect(composerBounds.x + composerBounds.width).toBeLessThanOrEqual(
        width,
      );
      const imageTrigger = references.getByRole("button", {
        name: "上传参考图片",
      });
      await imageTrigger.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("menu", { name: "参考图片来源" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(imageTrigger).toBeFocused();
      await page.locator(".board-node-type").click();
      await page.screenshot({ path: info.outputPath("board-composer.png") });
      await page.getByRole("button", { name: "首尾帧", exact: true }).click();
      await expect(
        references.locator("legend", { hasText: "首帧" }),
      ).toBeVisible();
      await expect(
        references.locator("legend", { hasText: "尾帧（可选）" }),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath("board-composer-frames.png"),
      });
      await toggle.focus();
      await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(inputs.locator(".board-input-row")).toHaveCount(7);
      await page.keyboard.press("Space");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await inputs.getByRole("button", { name: "引用任务输出" }).click();
      await expect(
        inputs.getByRole("combobox", { name: "选择上游任务" }),
      ).toBeVisible();
      await toggle.click();
      await page.getByRole("button", { name: "展开视频生成器" }).click();
      expect((await prompt.boundingBox())!.height).toBeGreaterThanOrEqual(420);
      const bounds = await prompt.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      const current = await page.request.get(
        `/v1/visual-workshop/projects/${id}/canvas`,
      );
      expect((await current.json()).edges).toEqual((await saved.json()).edges);
    });
  }
}
