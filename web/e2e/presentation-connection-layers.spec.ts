import { expect, test } from "@playwright/test";
import {
  newDeck,
  newElement,
} from "../src/features/presentation-workshop/templates";

test("连接层级改变实际遮挡顺序，撤销、放映和重开一致", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const document = newDeck("blank");
  const slide = document.slides[0];
  slide.elements = [
    newElement("rect", { id: "a", x: 120, y: 250, width: 150, height: 100 }),
    newElement("rect", { id: "b", x: 950, y: 250, width: 150, height: 100 }),
    newElement("rect", {
      id: "cover",
      x: 500,
      y: 250,
      width: 200,
      height: 100,
    }),
  ];
  slide.connections = [
    {
      id: "ab",
      source_id: "a",
      target_id: "b",
      style: "straight",
      label: "关系",
      color: "#D75B3B",
      width: 8,
    },
  ];
  const response = await page.request.post(
    "/v1/presentation-workshop/projects",
    {
      headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
      data: { title: "连接层级", document },
    },
  );
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
  const canvas = page.locator(".presentation-canvas");
  const edge = canvas.getByRole("button", { name: "编辑连接关系" });
  // The buried connection remains keyboard accessible.
  await edge.focus();
  await edge.press("Enter");
  const panel = page.getByRole("region", { name: "连接线调节" });
  await expect(panel).toBeVisible();
  await page.screenshot({
    path: info.outputPath("connection-layers-light.png"),
  });
  await page.evaluate(() => {
    globalThis.document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({
    path: info.outputPath("connection-layers-dark.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toBeVisible();
  await panel
    .getByRole("button", { name: "置于底层" })
    .scrollIntoViewIfNeeded();
  const panelBox = await panel.boundingBox();
  expect(panelBox!.x).toBeGreaterThanOrEqual(0);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: info.outputPath("connection-layers-mobile.png"),
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await panel.getByRole("button", { name: "置于顶层" }).click();
  const order = () =>
    canvas
      .locator(".presentation-slide")
      .evaluate((root) =>
        [...root.children]
          .map(
            (node) =>
              node.getAttribute("data-element-id") ??
              node
                .querySelector("[data-connection-id]")
                ?.getAttribute("data-connection-id"),
          )
          .filter(Boolean),
      );
  await expect.poll(order).toEqual(["a", "b", "cover", "ab"]);
  await page.screenshot({
    path: info.outputPath("connection-layers-raised.png"),
  });
  await expect(panel.getByRole("button", { name: "上移一层" })).toBeDisabled();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(order).toEqual(["ab", "a", "b", "cover"]);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  await panel.getByRole("button", { name: "关闭连接设置" }).click();
  // Hit testing over the covering rectangle now finds the raised connection.
  const cover = await canvas.locator('[data-element-id="cover"]').boundingBox();
  expect(cover).not.toBeNull();
  await page.mouse.click(
    cover!.x + cover!.width / 2,
    cover!.y + cover!.height / 2,
  );
  await expect(panel).toBeVisible();
  await page.reload();
  await expect.poll(order).toEqual(["a", "b", "cover", "ab"]);
  await page.getByRole("button", { name: "从头放映", exact: true }).click();
  const show = page.locator(".presentation-show .presentation-slide");
  await expect(
    show.locator("> svg:last-child [data-connection-id='ab']"),
  ).toHaveCount(1);
});
