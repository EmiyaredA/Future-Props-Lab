import { expect, test } from "@playwright/test";
import { setResponsiveTheme } from "./responsive-capture";

test("models and programming agents share equal space and management prominence", async ({
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
      const models = page.getByRole("region", {
        name: "模型服务",
        exact: true,
      });
      const agents = page.getByRole("region", {
        name: "编程智能体",
        exact: true,
      });
      await models.scrollIntoViewIfNeeded();
      const modelBox = (await models.boundingBox())!;
      const agentBox = (await agents.boundingBox())!;
      expect(Math.abs(modelBox.width - agentBox.width)).toBeLessThanOrEqual(1);
      if (viewport.width > 600) {
        expect(Math.abs(modelBox.height - agentBox.height)).toBeLessThanOrEqual(
          1,
        );
        expect(Math.abs(modelBox.y - agentBox.y)).toBeLessThanOrEqual(1);
        const modelAction = (await models
          .getByRole("button", { name: "管理模型" })
          .boundingBox())!;
        const agentAction = (await agents
          .getByRole("button", { name: "管理智能体" })
          .boundingBox())!;
        expect(Math.abs(modelAction.y - agentAction.y)).toBeLessThanOrEqual(1);
      } else {
        expect(
          agentBox.y - modelBox.y - modelBox.height,
        ).toBeGreaterThanOrEqual(9);
      }
      expect(
        await page
          .locator(".studio-main")
          .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
      ).toBe(false);
      await page.screenshot({
        path: info.outputPath(`equal-${viewport.width}-${theme}.png`),
        animations: "disabled",
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.getByRole("button", { name: "管理智能体", exact: true }).click();
  await expect(page).toHaveURL(/\/code-agents$/);
  await page.goBack();
  await page.getByRole("button", { name: "管理模型", exact: true }).click();
  await expect(page).toHaveURL(/\/model-service$/);
});
