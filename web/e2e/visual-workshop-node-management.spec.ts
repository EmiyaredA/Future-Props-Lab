import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { setResponsiveTheme } from "./responsive-capture";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

for (const theme of ["light", "dark"] as const) {
  test(`节点菜单、下载与持久化 (${theme})`, async ({ page }, info) => {
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
      data: { title: "节点菜单验收", kind: "canvas" },
    });
    expect(created.ok()).toBeTruthy();
    const id = (await created.json()).id as string;
    const uploaded = await page.request.post("/v1/files", {
      headers,
      multipart: {
        project_id: id,
        upload: { name: "角色.png", mimeType: "image/png", buffer: PNG },
      },
    });
    expect(uploaded.ok()).toBeTruthy();
    const assetId = (await uploaded.json()).id as string;
    const saved = await page.request.put(
      `/v1/visual-workshop/projects/${id}/canvas`,
      {
        headers,
        data: {
          expected_revision: 0,
          categories: [{ id: "character", name: "人设", groups: ["主角"] }],
          nodes: [
            {
              id: "text",
              kind: "text",
              title: "角色描述",
              text: "当前角色设定",
              position: { x: 0, y: 0 },
            },
            {
              id: "source",
              kind: "image",
              title: "角色参考",
              asset_id: assetId,
              position: { x: 500, y: 0 },
            },
            {
              id: "target",
              kind: "video",
              title: "下游生成",
              position: { x: 1000, y: 0 },
            },
          ],
          edges: [
            { id: "link", source_node_id: "source", target_node_id: "target" },
          ],
        },
      },
    );
    expect(saved.ok(), await saved.text()).toBeTruthy();
    await page.goto(`/apps/visual-workshop/projects/${id}/canvas`);
    await page.getByRole("button", { name: "看板", exact: true }).click();
    await setResponsiveTheme(page, theme);
    const sidebar = page.getByRole("complementary", { name: "项目素材" });
    const menuFor = (name: string) =>
      sidebar.getByRole("button", { name: `管理节点 ${name}`, exact: true });
    await expect(menuFor("角色参考")).toHaveText("");
    await menuFor("角色参考").click();
    await page.screenshot({ path: info.outputPath("node-menu.png") });
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "下载", exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe("角色参考.png");
    expect(await readFile((await download.path())!)).toEqual(PNG);
    await expect(page.getByRole("textbox", { name: "节点名称" })).toHaveValue(
      "角色描述",
    );
    await menuFor("角色参考").click();
    await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
    const rename = page.getByRole("dialog", { name: "重命名节点" });
    await rename.getByRole("textbox").fill("主角参考");
    await rename.getByRole("button", { name: "确认", exact: true }).click();
    await expect(menuFor("主角参考")).toBeVisible();
    await menuFor("主角参考").click();
    await page.getByRole("menuitem", { name: "分类与标签" }).click();
    await expect(page.getByRole("textbox", { name: "节点名称" })).toHaveValue(
      "主角参考",
    );
    await page.getByRole("combobox", { name: "节点主分类" }).click();
    await page.getByRole("option", { name: "人设", exact: true }).click();
    await expect
      .poll(async () => {
        const canvas = await (
          await page.request.get(`/v1/visual-workshop/projects/${id}/canvas`)
        ).json();
        const node = canvas.nodes.find(
          (item: { id: string }) => item.id === "source",
        );
        return [node.title, node.category_id];
      })
      .toEqual(["主角参考", "character"]);
    await page.reload();
    await expect(menuFor("主角参考")).toBeVisible();
    await menuFor("主角参考").click();
    await page.getByRole("menuitem", { name: "删除节点", exact: true }).click();
    const deletion = page.getByRole("alertdialog", { name: "删除节点" });
    await expect(deletion).toContainText("主角参考");
    await deletion
      .getByRole("button", { name: "删除节点", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("请先解除下游输入引用");
    await expect(menuFor("主角参考")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "切换项目素材面板" }).click();
    await menuFor("角色描述").click();
    await page.screenshot({ path: info.outputPath("node-menu-mobile.png") });
    const textDownloadEvent = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "下载", exact: true }).click();
    const textDownload = await textDownloadEvent;
    expect(textDownload.suggestedFilename()).toBe("角色描述.txt");
    expect(await readFile((await textDownload.path())!, "utf8")).toBe(
      "当前角色设定",
    );
    await menuFor("下游生成").click();
    await page.getByRole("menuitem", { name: "删除节点", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await expect(menuFor("下游生成")).toBeVisible();
    await menuFor("下游生成").click();
    await page.getByRole("menuitem", { name: "删除节点", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "删除节点", exact: true })
      .click();
    await expect
      .poll(async () => {
        const canvas = await (
          await page.request.get(`/v1/visual-workshop/projects/${id}/canvas`)
        ).json();
        return {
          ids: canvas.nodes.map((node: { id: string }) => node.id),
          edges: canvas.edges,
        };
      })
      .toEqual({ ids: ["text", "source"], edges: [] });
    await page.reload();
    await page.getByRole("button", { name: "切换项目素材面板" }).click();
    await expect(menuFor("主角参考")).toBeVisible();
    await expect(menuFor("下游生成")).toHaveCount(0);
    expect(
      (await page.request.get(`/v1/files/${assetId}/download`)).ok(),
    ).toBeTruthy();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  });
}
