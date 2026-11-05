import { expect, test } from "@playwright/test";
import { setResponsiveTheme } from "./responsive-capture";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

for (const theme of ["light", "dark"] as const) {
  test(`项目素材拖入视频参考栏并保存 (${theme})`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
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
      data: { title: "参考拖入验收", kind: "canvas" },
    });
    expect(created.ok()).toBeTruthy();
    const id = (await created.json()).id as string;
    const uploaded = await page.request.post("/v1/files", {
      headers,
      multipart: {
        project_id: id,
        upload: { name: "参考角色.png", mimeType: "image/png", buffer: PNG },
      },
    });
    expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
    const assetId = (await uploaded.json()).id as string;
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
              title: "生成目标",
              position: { x: 0, y: 0 },
            },
            {
              id: "source",
              kind: "image",
              title: "参考角色",
              asset_id: assetId,
              position: { x: 500, y: 0 },
            },
          ],
          edges: [],
        },
      },
    );
    expect(saved.ok(), await saved.text()).toBeTruthy();
    await page.goto(`/apps/visual-workshop/projects/${id}/canvas`);
    await page.getByRole("button", { name: "看板", exact: true }).click();
    await setResponsiveTheme(page, theme);
    await page.getByRole("button", { name: "全能参考", exact: true }).click();
    const source = page.getByRole("button", { name: /参考角色.*最终/ });
    await expect(source).toHaveAttribute("draggable", "true");
    const bar = page.getByRole("group", { name: "固定参考素材" });
    await expect(
      bar.getByRole("button", { name: "上传参考音频" }),
    ).toBeEnabled();
    const addImage = bar.getByRole("button", { name: "上传参考图片" });
    const beforeDrop = (await addImage.boundingBox())!;
    await source.dragTo(bar.getByRole("button", { name: "上传参考音频" }));
    await expect(
      bar.getByRole("button", { name: "参考角色", exact: true }),
    ).toBeVisible();
    const afterDrop = (await addImage.boundingBox())!;
    expect(afterDrop.height).toBeCloseTo(beforeDrop.height, 0);
    expect(afterDrop.height).toBeCloseTo(afterDrop.width, 0);
    await expect(page.getByRole("textbox", { name: "节点名称" })).toHaveValue(
      "生成目标",
    );
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `/v1/visual-workshop/projects/${id}/canvas`,
        );
        const canvas = await response.json();
        expect(canvas.edges).toEqual([]);
        return canvas.nodes.find((node: { id: string }) => node.id === "target")
          .generation_draft?.reference_asset_ids;
      })
      .toEqual([assetId]);
    await page.screenshot({ path: info.outputPath("reference-drop.png") });
    await page.reload();
    await expect(
      page
        .getByRole("group", { name: "固定参考素材" })
        .getByRole("button", { name: "参考角色", exact: true }),
    ).toBeVisible();
    await source.click();
    const ownReference = page.getByRole("group", { name: "参考图片（可选）" });
    await source.dragTo(ownReference);
    await expect(ownReference.locator(".generation-media-card")).toHaveCount(0);
    await expect(ownReference.getByRole("status")).toBeEmpty();
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `/v1/visual-workshop/projects/${id}/canvas`,
        );
        const canvas = await response.json();
        return (
          canvas.nodes.find((node: { id: string }) => node.id === "source")
            .generation_draft?.reference_asset_ids ?? []
        );
      })
      .toEqual([]);
    await page.setViewportSize({ width: 1800, height: 1600 });
    await page.getByRole("button", { name: "画布", exact: true }).click();
    await page.getByRole("button", { name: "适配视图" }).click();
    await page
      .locator('[data-node-id="target"]')
      .getByRole("button", { name: "选择视频素材" })
      .click();
    await page.getByRole("tab", { name: "生成设置", exact: true }).click();
    const canvasAdd = page
      .getByRole("group", { name: "固定参考素材" })
      .getByRole("button", { name: "上传参考图片" });
    await expect(canvasAdd).toBeVisible();
    const canvasBounds = (await canvasAdd.boundingBox())!;
    expect(canvasBounds.height).toBeCloseTo(canvasBounds.width, 0);
    await page.screenshot({ path: info.outputPath("canvas-reference.png") });
  });
}
