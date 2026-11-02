import { expect, test } from "@playwright/test";
import { setResponsiveTheme } from "./responsive-capture";

test("folder hover lifts papers without replacing click selection", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto("/home");
  await setResponsiveTheme(page, "dark");
  const folder = page.locator(".home-folder").first();
  const trigger = page.getByRole("button", { name: "视觉与叙事，3 个应用" });
  const paper = folder.locator(".home-folder-paper").first();
  await page.mouse.move(1, 1);
  const restingTop = await paper.evaluate((el) =>
    parseFloat(getComputedStyle(el).top),
  );
  await trigger.hover();
  await expect
    .poll(() => paper.evaluate((el) => parseFloat(getComputedStyle(el).top)))
    .toBeLessThan(restingTop - 12);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await page.screenshot({
    path: info.outputPath("folder-hover.png"),
    animations: "disabled",
  });
  await page.mouse.move(1, 1);
  await expect
    .poll(() => paper.evaluate((el) => parseFloat(getComputedStyle(el).top)))
    .toBeCloseTo(restingTop, 0);
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "打开视觉创作工坊" }).focus();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await trigger.hover();
  expect(
    await paper.evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe("0s");
});

test("file header actions have their own row and clearance from cards", async ({
  page,
}, info) => {
  await page.goto("/home");
  for (const viewport of [
    { width: 1440, height: 1024 },
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const theme of ["dark", "light"]) {
      await setResponsiveTheme(page, theme);
      const section = page.locator("#home-files");
      await section.scrollIntoViewIfNeeded();
      const header = await section
        .locator(".home-section-heading")
        .boundingBox();
      const cards = await section.locator(".home-file-grid").boundingBox();
      expect(cards!.y - header!.y - header!.height).toBeGreaterThanOrEqual(11);
      const actions = section.locator(".home-resource-actions button");
      for (const button of await actions.all()) {
        const box = await button.boundingBox();
        expect(box!.y + box!.height).toBeLessThanOrEqual(
          header!.y + header!.height + 1,
        );
        if (viewport.width === 390)
          expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      expect(
        await page
          .locator(".studio-main")
          .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
      ).toBe(false);
      await page.screenshot({
        path: info.outputPath(`file-header-${viewport.width}-${theme}.png`),
        animations: "disabled",
      });
      await section.getByRole("button", { name: "收起" }).click();
      await expect(page.locator("#home-files-content")).toBeHidden();
      await section.getByRole("button", { name: "展开" }).click();
    }
  }
});
