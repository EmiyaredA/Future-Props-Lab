import { expect, test } from "@playwright/test";
import { setResponsiveTheme } from "./responsive-capture";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7XkAAAAASUVORK5CYII=",
  "base64",
);

for (const theme of ["light", "dark"] as const) {
  for (const width of [1600, 390]) {
    test(`删除上传输出、恢复最终版与删空 (${theme}, ${width})`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width: 1600, height: 1000 });
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
        data: { title: "上传输出删除验收", kind: "canvas" },
      });
      expect(created.ok()).toBeTruthy();
      const id = (await created.json()).id as string;
      const base = `/v1/visual-workshop/projects/${id}`;
      const saved = await page.request.put(base + "/canvas", {
        headers,
        data: {
          expected_revision: 0,
          nodes: [
            {
              id: "image",
              kind: "image",
              title: "上传图像",
              position: { x: 0, y: 0 },
            },
          ],
          edges: [],
        },
      });
      expect(saved.ok()).toBeTruthy();
      let revision = (await saved.json()).revision as number;
      for (let version = 1; version <= 2; version++) {
        const uploaded = await page.request.post(
          base + "/nodes/image/output-uploads",
          {
            headers,
            multipart: {
              expected_revision: revision,
              file: {
                name: `v${version}.png`,
                mimeType: "image/png",
                buffer: PNG,
              },
            },
          },
        );
        expect(uploaded.ok()).toBeTruthy();
        revision = (await uploaded.json()).revision;
      }
      await page.goto(`/apps/visual-workshop/projects/${id}/canvas`);
      await page.getByRole("button", { name: "看板", exact: true }).click();
      await setResponsiveTheme(page, theme);
      await page.getByRole("button", { name: /上传图像 图像/ }).click();
      await page.setViewportSize({ width, height: 1000 });
      const panel = page.getByRole("region", { name: "节点输出历史" });
      await expect(panel.getByLabel("当前预览 v2 · 最终输出 v2")).toBeVisible();
      await panel.getByRole("button", { name: "删除上传版本 v2" }).click();
      const dialog = page.getByRole("alertdialog", { name: "删除输出版本 v2" });
      await expect(dialog).toContainText("剩余的最新版本");
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await expect(
        panel.getByRole("button", { name: "删除上传版本 v2" }),
      ).toBeVisible();
      await panel.getByRole("button", { name: "删除上传版本 v2" }).click();
      await dialog
        .getByRole("button", { name: "删除版本", exact: true })
        .click();
      await expect(dialog).toBeHidden();
      await expect(
        panel.getByRole("button", { name: "删除上传版本 v2" }),
      ).toHaveCount(0);
      await expect(panel.getByLabel("当前预览 v1 · 最终输出 v1")).toBeVisible();
      await page.reload();
      await expect(panel.getByLabel("当前预览 v1 · 最终输出 v1")).toBeVisible();
      await panel
        .getByRole("button", { name: "删除上传版本 v1" })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath("uploaded-output-delete.png"),
        fullPage: true,
      });
      await panel.getByRole("button", { name: "删除上传版本 v1" }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "删除版本", exact: true })
        .click();
      await expect(
        panel.getByLabel("当前预览 — · 最终输出 未设置"),
      ).toBeVisible();
      await expect(panel.getByText("暂无输出")).toBeVisible();
      await page.reload();
      await expect(
        panel.getByLabel("当前预览 — · 最终输出 未设置"),
      ).toBeVisible();
      const files = await page.request.get(`/v1/files?project_id=${id}`);
      expect((await files.json()).items).toHaveLength(2);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
    });
  }
}
