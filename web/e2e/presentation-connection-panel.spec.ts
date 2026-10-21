import { expect, test, type Page } from "@playwright/test";
import {
  newDeck,
  newElement,
} from "../src/features/presentation-workshop/templates";

async function create(page: Page) {
  await page.setViewportSize({ width: 1680, height: 1050 });
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const document = newDeck("blank");
  document.slides[0].elements = [
    newElement("rect", { id: "a", x: 100, y: 200, width: 180, height: 100 }),
    newElement("rect", { id: "b", x: 700, y: 200, width: 180, height: 100 }),
    newElement("rect", { id: "c", x: 700, y: 450, width: 180, height: 100 }),
  ];
  document.slides[0].connections = [
    {
      source_anchor: "right",
      target_anchor: "left",
      id: "ab",
      source_id: "a",
      target_id: "b",
      label: "流程",
      style: "step",
      width: 2,
      color: "#365F62",
      arrow: true,
      waypoints: [{ x: 400, y: 250 }],
    },
    {
      arrow: true,
      color: "#365F62",
      id: "bc",
      source_id: "b",
      target_id: "c",
      label: "结果",
      style: "straight",
      source_anchor: "bottom",
      target_anchor: "top",
      width: 4,
    },
  ];
  const response = await page.request.post(
    "/v1/presentation-workshop/projects",
    {
      headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
      data: { title: "连接侧栏验收", document },
    },
  );
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
  await expect(page.getByRole("group", { name: "幻灯片画布" })).toBeVisible();
  return project;
}
const panel = (page: Page) => page.getByRole("region", { name: "连接线调节" });
async function open(page: Page, id = "ab") {
  const edge = page.locator(
    `.presentation-canvas [data-connection-id="${id}"] [role="button"]`,
  );
  await edge.focus();
  await edge.press("Enter");
  await expect(panel(page)).toBeVisible();
}
async function insideInspector(page: Page) {
  await expect(async () => {
    const box = (await panel(page).boundingBox())!;
    const host = (await page
      .getByRole("complementary", { name: "格式面板" })
      .boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(host.x);
    expect(box.x + box.width).toBeLessThanOrEqual(host.x + host.width);
    expect(
      await panel(page).evaluate(
        (el) =>
          !!el.closest(".presentation-inspector") &&
          getComputedStyle(el).position === "static",
      ),
    ).toBe(true);
  }).toPass({ timeout: 3000 });
}

test("连接实时调整、路径保留、切换、撤销重做、保存重开和删除", async ({
  page,
}, info) => {
  const project = await create(page);
  await page.locator('.presentation-canvas [data-element-id="a"]').click();
  await open(page);
  await expect(page.locator(".presentation-selection-overlay")).toHaveCount(0);
  await expect(page.locator(".presentation-modal-backdrop")).toHaveCount(0);
  const line = page.locator(
    '.presentation-canvas [data-connection-id="ab"] path[marker-end]',
  );
  const path = await line.getAttribute("d");
  await page.getByRole("slider", { name: "连接粗细滑杆" }).fill("6");
  await expect(line).toHaveAttribute("stroke-width", "6");
  await page.getByRole("button", { name: "连接颜色", exact: true }).click();
  await page
    .getByRole("button", { name: "选择颜色 #4AA3DF", exact: true })
    .click();
  await expect(line).toHaveAttribute("stroke", "#4AA3DF");
  const label = page.getByLabel("连接标签", { exact: true });
  await label.fill("输入资料");
  await expect(line).toHaveAttribute("d", path!);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(label).toHaveValue("流程");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(label).toHaveValue("输入资料");
  await page.getByRole("button", { name: "直线", exact: true }).click();
  await expect(line).not.toHaveAttribute("d", path!);
  await open(page, "bc");
  await expect(label).toHaveValue("结果");
  await open(page);
  await expect(label).toHaveValue("输入资料");
  await page.screenshot({
    path: info.outputPath("connection-panel-desktop.png"),
  });
  await page.getByRole("button", { name: "关闭连接设置" }).click();
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  const saved = await (
    await page.request.get(`/v1/presentation-workshop/projects/${project.id}`)
  ).json();
  expect(saved.document.slides[0].connections[0]).toMatchObject({
    label: "输入资料",
    width: 6,
    color: "#4AA3DF",
    waypoints: [],
    style: "straight",
  });
  await page.reload();
  await open(page);
  await expect(page.getByLabel("连接粗细", { exact: true })).toHaveValue("6");
  await page.getByRole("button", { name: "删除连接" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(line).toHaveCount(0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(line).toHaveCount(1);
  await expect(panel(page)).toHaveCount(0);
});

test("属性停靠右侧、缩放滚动不移动面板，窄屏明暗主题与分层 Escape", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await create(page);
  await open(page);
  await insideInspector(page);
  await expect(
    page.getByRole("button", { name: "移动连接调节面板" }),
  ).toHaveCount(0);
  const fixed = await panel(page).boundingBox();
  await page.getByRole("slider", { name: "画布缩放", exact: true }).fill("150");
  await page.locator(".presentation-canvas-area").evaluate((area) => {
    area.scrollLeft = 100;
    area.scrollTop = 100;
  });
  expect(await panel(page).boundingBox()).toEqual(fixed);
  await page.getByRole("button", { name: "关闭连接设置" }).click();
  await open(page);
  expect(await panel(page).boundingBox()).toEqual(fixed);
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 768)
      await page
        .getByRole("button", { name: "文字与格式", exact: true })
        .click();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      await insideInspector(page);
      const disclosure = page.getByRole("button", {
        name: "连接端点",
        exact: false,
      });
      if ((await disclosure.getAttribute("aria-expanded")) === "false")
        await disclosure.click();
      await page.getByRole("combobox", { name: "连接起点" }).click();
      await expect(
        page.getByRole("option").filter({ hasText: "rect 2" }),
      ).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(panel(page)).toBeVisible();
      await page.getByRole("button", { name: "连接颜色", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(panel(page)).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`connection-panel-${width}-${theme}.png`),
      });
    }
  }
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator(".presentation-canvas")).toBeFocused();
});

test("新建取消不保存预览、输入中文、创建后可立即调整与画布关闭", async ({
  page,
}) => {
  const project = await create(page);
  const add = async () => {
    await page.getByRole("button", { name: "更多编辑工具" }).click();
    await page.getByRole("menuitem", { name: "连接节点", exact: true }).click();
  };
  await add();
  await expect(
    page.locator(".presentation-canvas [data-connection-id]"),
  ).toHaveCount(3);
  // Saving while the preview is open must persist only the actual document.
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await page.getByRole("button", { name: "关闭连接设置" }).click();
  await expect(
    page.locator(".presentation-canvas [data-connection-id]"),
  ).toHaveCount(2);
  const original = await (
    await page.request.get(`/v1/presentation-workshop/projects/${project.id}`)
  ).json();
  expect(original.document.slides[0].connections).toHaveLength(2);
  await add();
  const node = (await page
    .locator('.presentation-canvas [data-element-id="a"]')
    .boundingBox())!;
  await page.mouse.move(node.x + 20, node.y + 20);
  await page.mouse.down();
  await page.mouse.move(node.x + 60, node.y + 40, { steps: 5 });
  await page.mouse.up();
  await expect(panel(page)).toHaveCount(0);
  await expect(
    page.locator(".presentation-canvas [data-connection-id]"),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  const moved = await (
    await page.request.get(`/v1/presentation-workshop/projects/${project.id}`)
  ).json();
  expect(moved.document.slides[0].connections).toHaveLength(2);
  await add();
  const label = page.getByLabel("连接标签", { exact: true });
  await label.focus();
  await label.dispatchEvent("compositionstart", { data: "" });
  await label.fill("关系说明");
  await label.dispatchEvent("compositionend", { data: "关系说明" });
  await page.getByRole("button", { name: "创建连接", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "创建连接", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "删除连接", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "显示箭头", exact: true }).click();
  await page.locator('.presentation-canvas [data-element-id="a"]').click();
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  const saved = await (
    await page.request.get(`/v1/presentation-workshop/projects/${project.id}`)
  ).json();
  expect(saved.document.slides[0].connections).toHaveLength(3);
  expect(saved.document.slides[0].connections[2]).toMatchObject({
    label: "关系说明",
    arrow: false,
  });
});
