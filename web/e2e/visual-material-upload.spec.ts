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

test("看板从应用导入素材并可直接修改项目名称", async ({ page }) => {
  await page.goto("/apps/visual-workshop");
  const headers = {
    "X-CSRF-Token": (await page.context().cookies()).find(
      (cookie) => cookie.name === "fpl_csrf",
    )!.value,
    Origin: new URL(page.url()).origin,
  };
  const createProject = async (title: string) => {
    const response = await page.request.post("/v1/visual-workshop/projects", {
      headers,
      data: { title, kind: "canvas" },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return (await response.json()).id as string;
  };
  const projectId = await createProject("应用素材看板");
  const sourceId = await createProject("素材来源项目");
  const base = `/v1/visual-workshop/projects/${projectId}`;
  const category = await page.request.put(base + "/canvas", {
    headers,
    data: {
      expected_revision: 0,
      nodes: [],
      edges: [],
      categories: [{ id: "character", name: "人设", groups: ["主角"] }],
    },
  });
  expect(category.ok(), await category.text()).toBeTruthy();

  const folder = async (name: string, parentId?: string) => {
    const response = await page.request.post("/v1/file-folders", {
      headers,
      data: { name, scope: "library", parent_id: parentId },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return (await response.json()).id as string;
  };
  const upload = async (name: string, project?: string, folderId?: string) => {
    const response = await page.request.post("/v1/files", {
      headers,
      multipart: {
        upload: { name, mimeType: "image/png", buffer: PNG },
        ...(project ? { project_id: project } : {}),
        ...(folderId ? { folder_id: folderId } : {}),
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return (await response.json()).id as string;
  };
  const libraryAsset = await upload("总文件角色.png");
  const rootFolder = await folder("角色素材");
  const nestedFolder = await folder("角色细节", rootFolder);
  const nestedAsset = await upload("目录内角色.png", undefined, nestedFolder);
  const ownAsset = await upload("本项目角色.png", projectId);
  const crossAsset = await upload("其他项目角色.png", sourceId);

  await page.goto(`/apps/visual-workshop/projects/${projectId}/canvas`);
  await page.getByRole("button", { name: "看板", exact: true }).click();
  await page.getByRole("button", { name: "应用素材看板", exact: true }).click();
  const title = page.getByRole("textbox", { name: "项目名称" });
  await expect(title).toBeFocused();
  await title.fill("取消这次编辑");
  await title.press("Escape");
  await expect(
    page.getByRole("button", { name: "应用素材看板", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "应用素材看板", exact: true })
    .press("Enter");
  await title.fill("已重命名的素材看板");
  await title.press("Enter");
  await expect(
    page.getByRole("button", { name: "已重命名的素材看板", exact: true }),
  ).toBeFocused();

  await page.getByRole("button", { name: "上传素材", exact: true }).click();
  await page.getByRole("combobox", { name: "上传分类" }).click();
  await page.getByRole("option", { name: "人设", exact: true }).click();
  await page.getByRole("combobox", { name: "上传分组" }).click();
  await page.getByRole("option", { name: "主角", exact: true }).click();
  const open = page.getByRole("button", { name: "从应用选择", exact: true });
  const picker = page.getByRole("dialog", { name: "从应用选择素材" });
  await open.click();
  await expect(picker.getByRole("searchbox")).toBeFocused();
  await picker.getByRole("searchbox").press("Escape");
  await expect(open).toBeFocused();

  await open.click();
  const path = picker.getByRole("navigation", { name: "文件路径" });
  await expect(picker.getByRole("option", { name: "目录内角色" })).toHaveCount(
    0,
  );
  await picker.getByRole("option", { name: "总文件角色", exact: true }).click();
  await picker
    .getByRole("button", { name: "角色素材", exact: true })
    .press("Enter");
  await expect(picker.getByRole("option", { name: "总文件角色" })).toHaveCount(
    0,
  );
  await picker.getByRole("button", { name: "角色细节", exact: true }).click();
  await expect(path.getByRole("button", { name: "角色细节" })).toHaveAttribute(
    "aria-current",
    "location",
  );
  await picker.getByRole("option", { name: "目录内角色", exact: true }).click();
  await path.getByRole("button", { name: "总文件" }).click();
  await expect(
    picker.getByRole("option", { name: "总文件角色" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(picker.getByRole("option", { name: "目录内角色" })).toHaveCount(
    0,
  );
  await picker.getByRole("button", { name: "添加到看板" }).click();
  await expect(picker).toBeHidden();

  for (const [scope, name] of [
    ["本项目", "本项目角色"],
    ["其他项目", "其他项目角色"],
  ]) {
    await open.click();
    await picker.getByRole("tab", { name: scope, exact: true }).click();
    if (scope === "其他项目") {
      await picker.getByRole("combobox", { name: "来源项目" }).click();
      await picker
        .getByRole("option", { name: "素材来源项目", exact: true })
        .click();
    }
    await picker.getByRole("option", { name, exact: true }).click();
    await picker.getByRole("button", { name: "添加到看板" }).click();
    await expect(picker).toBeHidden();
  }

  const canvas = await (await page.request.get(base + "/canvas")).json();
  expect(canvas.nodes).toHaveLength(4);
  for (const [index, node] of canvas.nodes.entries()) {
    expect(node).toMatchObject({
      category_id: "character",
      group: "主角",
      final_version: 1,
    });
    if (index < 3)
      expect(node.asset_id).toBe([libraryAsset, nestedAsset, ownAsset][index]);
    else expect(node.asset_id).not.toBe(crossAsset);
  }
  await page.reload();
  await expect(
    page.getByRole("button", { name: "已重命名的素材看板", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /其他项目角色 图像/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "画布", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "已重命名的素材看板", exact: true }),
  ).toBeVisible();
});
