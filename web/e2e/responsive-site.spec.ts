import { expect, test } from "@playwright/test";
import { staticPaths, viewports } from "./responsive-inventory";
import { setResponsiveTheme } from "./responsive-capture";

test("all static surfaces fit their viewport", async ({ page }, info) => {
  test.setTimeout(240000);
  const problems: unknown[] = [];
  for (const path of staticPaths) {
    await page.goto(path);
    await expect(page.locator("#root")).not.toBeEmpty();
    const ready =
      path === "/files"
        ? page.getByRole("button", { name: "上传文件", exact: true })
        : page.getByRole("heading").first();
    await expect(ready, `页面入口 ${path}`).toBeVisible({ timeout: 15000 });
    for (const size of process.env.FPL_RESPONSIVE_SCAN
      ? [viewports[0], viewports[4]]
      : viewports) {
      await page.setViewportSize(size);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      for (const theme of ["light", "dark"]) {
        await setResponsiveTheme(page, theme);
        const overflow = await page.evaluate(() => {
          if (document.documentElement.scrollWidth <= innerWidth + 1) return [];
          return [...document.querySelectorAll("body *")]
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return (
                r.width &&
                (r.right > innerWidth + 1 || r.left < -1) &&
                getComputedStyle(el).position !== "fixed"
              );
            })
            .slice(0, 10)
            .map((el) => ({
              tag: el.tagName,
              class: el.className,
              width: el.getBoundingClientRect().width,
            }));
        });
        if (overflow.length) problems.push({ path, size, theme, overflow });
        await page.screenshot({
          path: info.outputPath(
            `${path.replaceAll("/", "_")}-${size.width}x${size.height}-${theme}.png`,
          ),
          animations: "disabled",
          fullPage: true,
        });
      }
    }
  }
  expect(problems).toEqual([]);
});
