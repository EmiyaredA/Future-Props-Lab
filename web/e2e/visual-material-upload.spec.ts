import { expect, test } from "@playwright/test";
import { setResponsiveTheme } from "./responsive-capture";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

for (const theme of ["light", "dark"] as const) {
  test(`上传到分类分组并刷新保留 (${theme})`, async ({ page }, info) => {
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
      data: { title: "指定文件夹上传验收", kind: "canvas" },
    });
    expect(created.ok()).toBeTruthy();
    const id = (await created.json()).id as string;
    const base = `/v1/visual-workshop/projects/${id}`;
    const saved = await page.request.put(base + "/canvas", {
      headers,
      data: {
        expected_revision: 0,
        nodes: [],
        edges: [],
        categories: [{ id: "character", name: "人设", groups: ["主角"] }],
      },
    });
    expect(saved.ok()).toBeTruthy();
    await page.goto(`/apps/visual-workshop/projects/${id}/canvas`);
    await page.getByRole("button", { name: "看板", exact: true }).click();
    await setResponsiveTheme(page, theme);
    if (theme === "light") {
      await page.getByRole("button", { name: "管理分类 人设" }).click();
      await page.getByRole("menuitem", { name: "上传到此分类" }).click();
    } else {
      await page.getByRole("button", { name: "上传素材", exact: true }).click();
      await page.getByRole("combobox", { name: "上传分类" }).click();
      await page.getByRole("option", { name: "人设", exact: true }).click();
    }
    await expect(page.getByRole("combobox", { name: "上传分类" })).toHaveText(
      "人设",
    );
    await page.getByRole("combobox", { name: "上传分组" }).click();
    await page.getByRole("option", { name: "主角", exact: true }).click();
    for (const width of [1600, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      if (width === 390) {
        await page.getByRole("button", { name: "切换项目素材面板" }).click();
      }
      await expect(
        page.getByRole("combobox", { name: "上传分组" }),
      ).toBeVisible();
      await page.screenshot({ path: info.outputPath(`upload-${width}.png`) });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBeTruthy();
    }
    const chooserEvent = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "选择文件", exact: true }).click();
    await (
      await chooserEvent
    ).setFiles(
      ["角色一.png", "角色二.png"].map((name) => ({
        name,
        mimeType: "image/png",
        buffer: PNG,
      })),
    );
    await expect
      .poll(async () => {
        const canvas = await (await page.request.get(base + "/canvas")).json();
        return canvas.nodes.map(
          (node: {
            category_id: string;
            group: string;
            final_version: number;
          }) => [node.category_id, node.group, node.final_version],
        );
      })
      .toEqual([
        ["character", "主角", 1],
        ["character", "主角", 1],
      ]);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.reload();
    const group = page
      .locator(".board-group")
      .filter({ has: page.locator("summary", { hasText: "主角" }) });
    await expect(
      group.getByRole("button", { name: /角色一 图像/ }),
    ).toBeVisible();
    await expect(
      group.getByRole("button", { name: /角色二 图像/ }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath("uploaded.png") });
  });
}
