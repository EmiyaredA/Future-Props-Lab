import { expect, test } from "@playwright/test";
import { setResponsiveTheme } from "./responsive-capture";

test("bundled homepage Kurisu works across themes and responsive widths", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const retiredRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/v1\/(live2d-workshop|desktop-pet)\//.test(request.url()))
      retiredRequests.push(request.url());
  });
  await page.goto("/");
  await page.bringToFront();
  await expect(
    page.getByRole("heading", { name: "今天想从哪里开始？" }),
  ).toBeVisible();
  const video = page.locator(".home-hero-pet video");
  await expect(video).toHaveAttribute("data-ready", "true", {
    timeout: 15_000,
  });
  expect(
    await video.evaluate((element: HTMLVideoElement) => element.paused),
  ).toBe(false);
  for (const width of [1600, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"] as const) {
      await setResponsiveTheme(page, theme);
      const copy = await page.locator(".home-header-copy").boundingBox();
      const figure = await page.locator(".home-hero-pet").boundingBox();
      expect(copy && figure).toBeTruthy();
      expect(
        figure!.x >= copy!.x + copy!.width ||
          figure!.y >= copy!.y + copy!.height,
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`home-${width}-${theme}.png`),
      });
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(video).toHaveCount(0);
  await expect(page.locator(".home-hero-pet img")).toBeVisible();
  await page.goto("/apps");
  await expect(
    page.getByRole("button", { name: "打开演示工坊", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "打开Agent 工作台", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "打开Live2D 工坊" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "打开桌宠工坊" })).toHaveCount(
    0,
  );
  expect(retiredRequests).toEqual([]);
});
