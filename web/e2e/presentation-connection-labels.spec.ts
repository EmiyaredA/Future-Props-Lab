import { expect, test } from "@playwright/test";
import {
  newDeck,
  newElement,
} from "../src/features/presentation-workshop/templates";

test("连线标签就地编辑、拖动、重置、保存和放映", async ({ page }, info) => {
  await page.setViewportSize({ width: 1680, height: 1050 });
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const document = newDeck("blank"),
    slide = document.slides[0];
  slide.elements = [
    newElement("rect", { id: "a", x: 100, y: 200, width: 180, height: 100 }),
    newElement("rect", { id: "b", x: 800, y: 200, width: 180, height: 100 }),
  ];
  slide.connections = [
    {
      id: "ab",
      source_id: "a",
      target_id: "b",
      source_anchor: "right",
      target_anchor: "left",
      style: "straight",
      arrow: true,
      color: "#1556E8",
      width: 2,
      label: "每轮读取",
    },
  ];
  const created = await page.request.post(
    "/v1/presentation-workshop/projects",
    { headers, data: { title: "连线标签验收", document } },
  );
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  const url = `/v1/presentation-workshop/projects/${project.id}`;
  try {
    await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
    const label = page.locator(
      '.presentation-canvas [data-connection-label="ab"]',
    );
    const line = page.locator(
      '.presentation-canvas [data-connection-id="ab"] path[marker-end]',
    );
    const originalPath = await line.getAttribute("d");
    await label.dblclick();
    const editor = page.getByRole("textbox", {
      name: "编辑连线文字",
      exact: true,
    });
    await expect(editor).toBeFocused();
    await editor.fill("允许下一轮");
    await editor.press("Shift+Enter");
    await expect(editor).toHaveValue("允许下一轮\n");
    await editor.fill("允许下一轮\n读取更新后的消息");
    await editor.press("Enter");
    await expect(editor).toHaveCount(0);
    await expect(label.locator("tspan")).toHaveCount(2);
    await label.dblclick();
    await editor.fill("丢弃修改");
    await editor.press("Escape");
    await expect(label).toContainText("允许下一轮");
    await label.click();
    await page
      .getByRole("spinbutton", { name: "关系文字字号", exact: true })
      .fill("10");
    await expect(label.locator("text")).toHaveAttribute("font-size", "10");
    const defaultBox = (await label.boundingBox())!;
    const defaultCentre = {
      x: defaultBox.x + defaultBox.width / 2,
      y: defaultBox.y + defaultBox.height / 2,
    };
    const handle = page.locator(
      '.presentation-canvas [data-connection-label-resize="ab"]',
    );
    const grip = (await handle.boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      grip.x + grip.width / 2 + 35,
      grip.y + grip.height / 2 + 18,
      { steps: 5 },
    );
    await page.mouse.up();
    const resizedFont = Number(
      await label.locator("text").getAttribute("font-size"),
    );
    expect(resizedFont).toBeGreaterThan(10);
    const resizedBox = (await label.boundingBox())!;
    expect(resizedBox.x).toBeCloseTo(defaultBox.x, 0);
    expect(resizedBox.y).toBeCloseTo(defaultBox.y, 0);
    await page
      .getByRole("spinbutton", { name: "文字水平偏移", exact: true })
      .fill("24");
    await page
      .getByRole("spinbutton", { name: "文字垂直偏移", exact: true })
      .fill("-20");
    await expect(
      page.getByRole("spinbutton", { name: "文字水平偏移", exact: true }),
    ).toHaveValue("24");
    await expect(
      page.getByRole("spinbutton", { name: "文字垂直偏移", exact: true }),
    ).toHaveValue("-20");
    await page.getByRole("combobox", { name: "箭头大小", exact: true }).click();
    await page.getByRole("option", { name: "小", exact: true }).click();
    await expect(
      page.locator('.presentation-canvas [data-connection-id="ab"] marker'),
    ).toHaveAttribute("markerWidth", "4");
    const initial = (await label.boundingBox())!;
    await page.mouse.move(
      initial.x + initial.width / 2,
      initial.y + initial.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      initial.x + initial.width / 2 + 60,
      initial.y + initial.height / 2 - 35,
      { steps: 6 },
    );
    await page.mouse.up();
    await expect(line).toHaveAttribute("d", originalPath!);
    await expect(async () => {
      const box = (await label.boundingBox())!;
      expect(box.x - initial.x).toBeCloseTo(60, 0);
      expect(box.y - initial.y).toBeCloseTo(-35, 0);
    }).toPass();
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(async () =>
      expect((await label.boundingBox())!.x).toBeCloseTo(initial.x, 0),
    ).toPass();
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await page.getByRole("button", { name: "保存文稿", exact: true }).click();
    await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
    const saved = await (await page.request.get(url)).json();
    expect(saved.document.slides[0].connections[0].label_offset).not.toBeNull();
    expect(saved.document.slides[0].connections[0]).toMatchObject({
      label_font_size: resizedFont,
      arrow_size: "small",
    });
    expect(saved.document.slides[0].elements).toEqual(
      project.document.slides[0].elements,
    );
    await page.reload();
    await expect(label).toContainText("读取更新后的消息");
    await label.click();
    expect(
      Number(
        await page
          .getByRole("spinbutton", { name: "文字水平偏移", exact: true })
          .inputValue(),
      ),
    ).toBeCloseTo(saved.document.slides[0].connections[0].label_offset.x, 2);
    expect(
      Number(
        await page
          .getByRole("spinbutton", { name: "文字垂直偏移", exact: true })
          .inputValue(),
      ),
    ).toBeCloseTo(saved.document.slides[0].connections[0].label_offset.y, 2);
    await page
      .getByRole("button", { name: "重置文字位置", exact: true })
      .click();
    await expect(async () => {
      const reset = (await label.boundingBox())!;
      expect(reset.x + reset.width / 2).toBeCloseTo(defaultCentre.x, 0);
      expect(reset.y + reset.height / 2).toBeCloseTo(defaultCentre.y, 0);
    }).toPass();
    await page.screenshot({
      path: info.outputPath("connection-labels-editor.png"),
    });
    await page.getByRole("button", { name: "从头放映", exact: true }).click();
    await expect(
      page
        .getByRole("dialog", { name: "幻灯片放映" })
        .locator('[data-connection-label="ab"]'),
    ).toBeVisible();
    await expect(
      page
        .getByRole("dialog", { name: "幻灯片放映" })
        .locator("[data-connection-label-resize]"),
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("connection-labels-playback.png"),
    });
  } finally {
    await page.request.delete(url, { headers });
  }
});
