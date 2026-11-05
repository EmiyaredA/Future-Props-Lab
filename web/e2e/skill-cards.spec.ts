import { expect, test } from "@playwright/test";
import type { Skill } from "../src/features/integrations/api";

const skills: Skill[] = Array.from({ length: 7 }, (_, index) => ({
  id: `layout-${index}`,
  name:
    index === 0
      ? "papercraft-stop-motion-explainer-".repeat(4)
      : `Skill ${index}`,
  description:
    index % 3 === 0
      ? "For creators explaining science through tactile handmade papercraft visuals. ".repeat(
          50,
        )
      : index % 3 === 1
        ? "简短说明"
        : "",
  tags:
    index % 3 === 0
      ? [
          "很长的标签".repeat(8),
          "video-generation-".repeat(8),
          "纸艺风格",
          "科普",
        ]
      : index % 3 === 1
        ? ["MiniMax H3"]
        : [],
  default_version: index === 0 ? "version-with-a-long-name-".repeat(3) : "v1",
  latest_version: index === 0 ? "version-with-a-long-name-".repeat(3) : "v1",
  version_count: 1,
  enabled: index % 2 === 0,
  status: "healthy",
  status_message: "",
  revision: 1,
  created_at: "2026-09-10",
  updated_at: "2026-09-10",
}));

for (const width of [1440, 1000, 390]) {
  for (const theme of ["light", "dark"]) {
    test(`Skill cards have equal dimensions and accessible details at ${width}px in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(
        (value) => localStorage.setItem("future_props_theme", value),
        theme,
      );
      await page.route("**/v1/integrations/skills", (route) =>
        route.fulfill({
          json: {
            items: skills,
            enabled_count: 4,
            draft_count: 3,
            version_count: 7,
          },
        }),
      );
      await page.route(
        "**/v1/integrations/skills/*/versions/*/files",
        (route) => route.fulfill({ json: { files: [] } }),
      );
      await page.goto("/integrations/skills");
      const cards = page.locator(".skill-card");
      await expect(cards).toHaveCount(skills.length);
      await page.evaluate(() => document.fonts.ready);
      const bounds = await cards.evaluateAll((elements) =>
        elements.map((card) => {
          const rect = card.getBoundingClientRect();
          const summary = card.querySelector("p")!;
          const style = getComputedStyle(summary);
          return {
            width: rect.width,
            height: rect.height,
            top: rect.top,
            footer:
              card.querySelector("footer")!.getBoundingClientRect().top -
              rect.top,
            meta:
              card
                .querySelector(".integration-card-meta")!
                .getBoundingClientRect().top - rect.top,
            summaryHeight: summary.getBoundingClientRect().height,
            lineHeight: parseFloat(style.lineHeight),
            clamp: style.webkitLineClamp,
            overflow: card.scrollWidth > card.clientWidth,
          };
        }),
      );
      const columns = width > 1250 ? 3 : width > 620 ? 2 : 1;
      expect(
        bounds.filter((rect) => Math.abs(rect.top - bounds[0].top) < 1),
      ).toHaveLength(columns);
      expect(bounds[columns].top).toBeGreaterThan(bounds[0].top);
      for (const rect of bounds) {
        for (const key of ["width", "height", "footer", "meta"] as const) {
          expect(Math.abs(rect[key] - bounds[0][key])).toBeLessThan(1);
        }
        expect(Math.abs(rect.summaryHeight - rect.lineHeight * 4)).toBeLessThan(
          1,
        );
        expect(rect.clamp).toBe("4");
        expect(rect.overflow).toBe(false);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: test.info().outputPath("skill-cards.png"),
        fullPage: true,
      });

      const trigger = cards
        .first()
        .getByRole("button", { name: `查看 ${skills[0].name} 详情` });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Skill 详情" });
      await expect(
        dialog.getByRole("heading", { name: skills[0].name, exact: true }),
      ).toBeVisible();
      await expect(dialog.locator(".skill-details-heading p")).toHaveText(
        skills[0].description,
      );
      await expect(dialog.getByLabel("全部标签").locator("span")).toHaveText(
        skills[0].tags,
      );
      expect(
        await dialog.evaluate(
          (element) => element.scrollHeight > element.clientHeight,
        ),
      ).toBe(true);
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      const close = dialog.getByRole("button", { name: "关闭" });
      await expect(close).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        dialog.getByRole("button", { name: "下载 ZIP" }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(close).toBeFocused();
      await dialog.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect(dialog.getByText("科普", { exact: true })).toBeInViewport();
      await expect(close).toBeInViewport();
      await page.screenshot({
        path: test.info().outputPath("skill-details.png"),
      });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }
}
