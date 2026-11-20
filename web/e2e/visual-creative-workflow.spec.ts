import { expect, test } from "@playwright/test";
import { Buffer } from "node:buffer";

test.use({ actionTimeout: 15000 });

function triangleGlb() {
  const metadata = JSON.stringify({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteLength: 36, target: 34962 }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
  });
  const block = Buffer.from(
    metadata.padEnd(Math.ceil(Buffer.byteLength(metadata) / 4) * 4),
  );
  const data = Buffer.alloc(28 + block.length + 36);
  data.write("glTF", 0);
  data.writeUInt32LE(2, 4);
  data.writeUInt32LE(data.length, 8);
  data.writeUInt32LE(block.length, 12);
  data.write("JSON", 16);
  block.copy(data, 20);
  data.writeUInt32LE(36, block.length + 20);
  data.write("BIN", block.length + 24);
  const vertices = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  vertices.forEach((value, index) =>
    data.writeFloatLE(value, block.length + 28 + index * 4),
  );
  return data;
}

test("分集剧本提取设定、白模试排、导入模型和选择镜头回填", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/v1/model-inference/options", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "acceptance-text",
            label: "验收文本模型",
            modalities: ["text"],
            parameters: {},
          },
        ],
      },
    }),
  );
  await page.route("**/v1/model-inference/text/stream", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({
        type: "done",
        result: {
          text: JSON.stringify({
            location: "咖啡馆",
            time: "夜",
            characters: [
              { name: "许宁", quote: "许宁：信在哪？" },
              { name: "林远", quote: "林远：在桌上。" },
            ],
            props: [{ name: "信封", quote: "林远将信封放下。" }],
            dialogue: [
              { speaker: "许宁", line: "信在哪？" },
              { speaker: "林远", line: "在桌上。" },
            ],
            actions: [{ actor: "林远", quote: "林远将信封放下。" }],
          }),
        },
      })}\n\n`,
    }),
  );
  await page.goto("/apps/visual-workshop");
  await page.getByRole("button", { name: "新建项目" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/canvas$/);
  const projectUrl = page.url();
  await page.getByRole("button", { name: "剧本", exact: true }).click();
  await page.getByRole("button", { name: "新建集" }).click();
  await page.getByRole("button", { name: "新建场" }).click();
  await page.getByRole("textbox", { name: "场次名称" }).fill("咖啡馆对话");
  await page
    .getByRole("textbox", { name: "场景信息" })
    .fill("室内 · 咖啡馆 · 夜");
  await page
    .getByRole("textbox", { name: "剧本文本" })
    .fill("许宁：信在哪？\n林远将信封放下。\n林远：在桌上。");
  await page.getByRole("button", { name: "保存剧本" }).click();
  await expect(page.getByRole("button", { name: "保存剧本" })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("script.png") });

  await page.getByRole("button", { name: "提取设定" }).click();
  await page.getByRole("combobox", { name: "文本模型" }).click();
  await page.getByRole("option", { name: "验收文本模型" }).click();
  await page.getByRole("button", { name: "提取", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: /信封.*道具卡/ }),
  ).toBeChecked();
  await page.getByRole("button", { name: "添加到设定卡" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/apps/visual-workshop");
  const assetsNav = page
    .getByRole("navigation", { name: "视觉创作工坊导航" })
    .getByRole("button", { name: "项目素材库" });
  await assetsNav.click();
  await expect(page).toHaveURL(/\/visual-workshop\/assets$/);
  const projectChoice = page.getByRole("button", { name: /未命名项目/ });
  const search = page.getByRole("textbox", { name: "搜索项目" });
  await search.fill("没有匹配的项目名称");
  await expect(projectChoice).toHaveCount(0);
  await expect(page.getByText("没有匹配的项目", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "清空搜索" }).click();
  await expect(projectChoice).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(projectChoice).toBeInViewport();
  expect(
    await page
      .locator(".workshop-main")
      .evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBe(0);
  await page.screenshot({ path: info.outputPath("asset-projects-mobile.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
  await projectChoice.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(projectUrl.replace(/\/canvas$/, "/assets"));
  await expect(assetsNav).toHaveAttribute("aria-current", "page");
  const assetTabs = page.getByRole("tablist", { name: "项目资产" });
  const fileTab = assetTabs.getByRole("tab", { name: "文件", exact: true });
  const characterTab = assetTabs.getByRole("tab", {
    name: "角色卡",
    exact: true,
  });
  const sceneTab = assetTabs.getByRole("tab", { name: "场景卡", exact: true });
  const propTab = assetTabs.getByRole("tab", { name: "道具卡", exact: true });
  await expect(fileTab).toHaveAttribute("aria-selected", "true");
  await expect(characterTab).toBeVisible();
  await expect(sceneTab).toBeVisible();
  await expect(propTab).toBeVisible();
  await fileTab.press("ArrowRight");
  await expect(characterTab).toBeFocused();
  await expect(page.getByRole("button", { name: /许宁/ })).toBeVisible();
  await sceneTab.click();
  await expect(page.getByRole("button", { name: /咖啡馆/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "新建场景卡", exact: true }),
  ).toBeEnabled();
  await propTab.click();
  await page.getByRole("button", { name: /信封/ }).click();
  await expect(page.getByRole("dialog", { name: "信封" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("design-card.png") });
  await page.getByRole("button", { name: "关闭", exact: true }).click();

  await page
    .getByRole("navigation", { name: "视觉创作工坊导航" })
    .getByRole("button", { name: "设定库", exact: true })
    .click();
  await expect(page).toHaveURL(/\/visual-workshop\/card-library$/);
  await expect(page.getByRole("button", { name: /许宁/ })).toBeVisible();
  await page.getByRole("button", { name: "新建角色卡", exact: true }).click();
  const sharedCard = page.getByRole("dialog", { name: "新建角色卡" });
  await sharedCard
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("通用测试角色");
  const renamed = page.getByRole("dialog", { name: "通用测试角色" });
  await renamed.getByRole("button", { name: "保存设定卡" }).click();
  await expect(
    renamed.getByRole("button", { name: "保存设定卡" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.goto(projectUrl.replace(/\/canvas$/, "/assets"));
  await characterTab.click();
  await expect(
    page.getByRole("button", { name: /通用测试角色/ }),
  ).toBeVisible();

  await page.goto(projectUrl);
  await page.getByRole("button", { name: "剧本", exact: true }).click();
  await page.getByRole("button", { name: "转为白模预演" }).click();
  await page.getByRole("combobox", { name: "文本模型" }).click();
  await page.getByRole("option", { name: "验收文本模型" }).click();
  await page.getByRole("button", { name: "AI 解析" }).click();
  await expect(page.getByRole("button", { name: "创建白模场景" })).toBeEnabled({
    timeout: 60_000,
  });
  await expect(page.getByText(/镜头.*全景/)).toBeVisible();
  await expect(page.getByLabel("场景工具", { exact: true })).toBeHidden();
  await page.screenshot({ path: info.outputPath("script-previs.png") });
  await page.getByRole("button", { name: "播放试排" }).click();
  await expect(
    page.locator(".creative-previs-render .filmPreview"),
  ).toBeVisible();
  await page.getByRole("button", { name: "创建白模场景" }).click();
  const editor = page.getByRole("region", { name: "镜头预演编辑器" });
  await expect(editor.getByLabel(/3D 场景/)).toBeVisible({ timeout: 60_000 });
  await editor.getByRole("button", { name: "素材库", exact: true }).click();
  await expect(
    editor.getByRole("heading", { name: "3D 素材库" }),
  ).toBeVisible();
  await editor.locator('input[type="file"][accept^=".glb"]').setInputFiles({
    name: "信封模型.glb",
    mimeType: "model/gltf-binary",
    buffer: triangleGlb(),
  });
  await expect(
    editor.getByRole("status").getByText("有未保存的修改"),
  ).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: info.outputPath("stage-assets.png") });
  await editor.getByRole("button", { name: "收起素材库" }).click();
  await editor.getByRole("button", { name: "导出", exact: true }).click();
  const panel = editor.getByRole("complementary", { name: "高级导出" });
  await panel.getByRole("button", { name: "选中镜头" }).click();
  const second = panel.getByRole("checkbox", { name: "第 2 镜" });
  await panel.getByRole("checkbox", { name: "第 1 镜" }).uncheck();
  await second.check();
  const small = panel.getByRole("checkbox", { name: "预演小样", exact: true });
  if (await small.isEnabled()) await small.uncheck();
  await panel.getByRole("checkbox", { name: "镜头表", exact: true }).uncheck();
  await panel.getByRole("checkbox", { name: "四视图", exact: true }).check();
  await page.screenshot({ path: info.outputPath("advanced-export.png") });
  await panel.getByRole("button", { name: "导出到画布" }).click();
  await expect(editor.getByText("已发送 2 个素材到画布")).toBeVisible({
    timeout: 45_000,
  });
  await page.getByRole("button", { name: "画布", exact: true }).click();
  await expect(page.locator(".canvas-node")).toHaveCount(2);

  await page.getByRole("button", { name: "素材库", exact: true }).click();
  const assetsPath = new URL(projectUrl.replace(/\/canvas$/, "/assets"))
    .pathname;
  await expect(
    page.getByRole("link", { name: "管理素材与设定" }),
  ).toHaveAttribute("href", assetsPath);

  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const account = await response.json();
    account.permission_keys = account.permission_keys.filter(
      (key: string) => key !== "content.write",
    );
    await route.fulfill({ response, json: account });
  });
  await page.goto(assetsPath);
  await propTab.click();
  await expect(page.getByRole("button", { name: /信封/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "新建道具卡" })).toHaveCount(0);
  await expect(assetTabs.getByRole("tab", { name: "跨项目" })).toHaveCount(0);
});
