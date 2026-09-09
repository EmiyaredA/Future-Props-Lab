import { expect, type Page, type TestInfo } from "@playwright/test";
import { viewports } from "./responsive-inventory";
import { THEME_KEY } from "../src/shared/ui/theme";

export async function setResponsiveTheme(page: Page, theme: string) {
  await page.evaluate(
    ({ theme, key }) => {
      localStorage.setItem(key, theme);
      window.dispatchEvent(
        new StorageEvent("storage", { key, newValue: theme }),
      );
      document.documentElement.dataset.theme = theme;
      return new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    },
    { theme, key: THEME_KEY },
  );
}

export async function captureResponsive(
  page: Page,
  info: TestInfo,
  name: string,
) {
  const problems: unknown[] = [];
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
      const bounds = await page.evaluate(() => {
        const width = document.documentElement.scrollWidth;
        const elements =
          width <= innerWidth + 1
            ? []
            : [...document.querySelectorAll("body *")]
                .filter((el) => {
                  const r = el.getBoundingClientRect();
                  return (
                    r.width &&
                    r.right > innerWidth + 1 &&
                    getComputedStyle(el).position !== "fixed"
                  );
                })
                .slice(0, 8)
                .map((el) => ({
                  class: el.className,
                  width: el.getBoundingClientRect().width,
                }));
        const dialogs = [
          ...document.querySelectorAll('[role="dialog"], .custom-select-menu'),
        ]
          .filter((el) => el.getClientRects().length)
          .map((el) => {
            const rect = el.getBoundingClientRect();
            return {
              label: el.getAttribute("aria-label"),
              x: rect.x,
              y: rect.y,
              right: rect.right,
              bottom: rect.bottom,
            };
          })
          .filter(
            (r) =>
              r.x < -1 ||
              r.y < -1 ||
              r.right > innerWidth + 1 ||
              r.bottom > innerHeight + 1,
          );
        return { width, elements, dialogs };
      });
      if (bounds.width > size.width + 1 || bounds.dialogs.length)
        problems.push({ name, size, ...bounds });
      await page.screenshot({
        path: info.outputPath(
          `${name}-${size.width}x${size.height}-${theme}.png`,
        ),
        fullPage: !(await page.getByRole("dialog").count()),
        animations: "disabled",
      });
    }
  }
  expect(problems).toEqual([]);
}
