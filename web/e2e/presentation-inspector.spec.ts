import { expect, test, type Page } from "@playwright/test";
import {
  newDeck,
  newElement,
} from "../src/features/presentation-workshop/templates";

async function create(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const upload = await page.request.post("/v1/files", {
    headers,
    multipart: {
      upload: {
        name: "panel.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
          "base64",
        ),
      },
    },
  });
  expect(upload.ok()).toBeTruthy();
  const document = newDeck("cover");
  document.slides[0].elements.push(
    newElement("image", {
      id: "image",
      asset_id: (await upload.json()).id,
      x: 372.61,
      y: 366.71,
      width: 180,
      height: 180,
    }),
  );
  const response = await page.request.post(
    "/v1/presentation-workshop/projects",
    { headers, data: { title: "格式面板验收", document } },
  );
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
  await page.locator('.presentation-canvas [data-element-id="image"]').click();
  await expect(
    page.getByRole("spinbutton", { name: "裁剪左侧", exact: true }),
  ).toBeVisible();
  return project;
}

test("面板拖动调宽、边界、取消与恢复不修改文稿，画布和悬浮栏同步", async ({
  page,
}) => {
  const project = await create(page);
  const panel = page.getByRole("complementary", { name: "格式面板" });
  const separator = page.getByRole("separator", { name: "调整格式面板宽度" });
  const canvas = page.locator(".presentation-canvas");
  const initial = (await canvas.boundingBox())!.width;
  const box = (await separator.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x - 175, box.y + 100, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())!.width).toBe(460);
  await expect
    .poll(async () => (await canvas.boundingBox())!.width)
    .toBeLessThan(initial);
  await expect
    .poll(async () => {
      const el = (await page
        .locator('.presentation-canvas [data-element-id="image"]')
        .boundingBox())!;
      const bar = (await page
        .locator(".presentation-selection-overlay")
        .boundingBox())!;
      return Math.abs(el.x + el.width / 2 - bar.x - bar.width / 2);
    })
    .toBeLessThan(2);
  const field = panel.getByRole("spinbutton", { name: "X", exact: true });
  await expect(field).toHaveValue("372.61");
  expect((await field.boundingBox())!.width).toBeGreaterThan(100);
  await separator.press("End");
  await expect(separator).toHaveAttribute("aria-valuenow", "480");
  await separator.press("Home");
  await expect(separator).toHaveAttribute("aria-valuenow", "240");
  await separator.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", "240");
  await separator.press("Shift+ArrowLeft");
  await expect(separator).toHaveAttribute("aria-valuenow", "290");
  const next = (await separator.boundingBox())!;
  await page.mouse.move(next.x + 5, next.y + 100);
  await page.mouse.down();
  await page.mouse.move(next.x - 70, next.y + 100);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(separator).toHaveAttribute("aria-valuenow", "290");
  await separator.dblclick();
  await expect(separator).toHaveAttribute("aria-valuenow", "280");
  await separator.press("Delete");
  await expect(
    page.locator('.presentation-canvas [data-element-id="image"]'),
  ).toBeVisible();
  const latest = await (
    await page.request.get(`/v1/presentation-workshop/projects/${project.id}`)
  ).json();
  expect(latest.revision).toBe(project.revision);
  expect(latest.document).toEqual(project.document);
});

test("明暗主题和窄屏局部滚动，调宽后数值完整、标题始终可见", async ({
  page,
}, info) => {
  await create(page);
  const panel = page.getByRole("complementary", { name: "格式面板" });
  const separator = page.getByRole("separator", { name: "调整格式面板宽度" });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    for (const width of [1600, 1024, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 800 });
      if (width >= 768) {
        const maximum = Math.min(480, Math.floor(width * 0.42));
        await expect(separator).toHaveAttribute(
          "aria-valuemax",
          String(maximum),
        );
        await separator.press("End");
        await expect(separator).toHaveAttribute(
          "aria-valuenow",
          String(maximum),
        );
        const header = panel.locator(".presentation-inspector-header");
        const y = (await header.boundingBox())!.y;
        await panel
          .locator(".presentation-inspector-content")
          .evaluate((el) => {
            el.scrollTop = el.scrollHeight;
          });
        expect((await header.boundingBox())!.y).toBe(y);
        await panel
          .locator(".presentation-inspector-content")
          .evaluate((el) => {
            el.scrollTop = 0;
          });
      } else {
        await page
          .getByRole("button", { name: "文字与格式", exact: true })
          .click();
        await expect(separator).toBeHidden();
        await expect(panel).toBeVisible();
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const size = await panel.evaluate((el) => ({
        client: el.clientWidth,
        scroll: el.scrollWidth,
      }));
      expect(size.scroll).toBeLessThanOrEqual(size.client);
      if (width === 1600 || width === 360)
        await page.screenshot({
          path: info.outputPath(`panel-${theme}-${width}.png`),
        });
    }
  }
});
