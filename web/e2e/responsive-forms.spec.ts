import { expect, test } from "@playwright/test";
import { captureResponsive } from "./responsive-capture";

for (const [path, label] of [
  ["/files", "新建文件夹"],
  ["/model-service", "添加接入连接"],
  ["/model-test-tools", "新建测试工具"],
  ["/integrations/tool-apis", "新建工具 API"],
  ["/integrations/mcp", "添加 MCP"],
  ["/integrations/skills", "上传 Skill"],
]) {
  test(`compact form and nested menu: ${label}`, async ({ page }, info) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    const trigger = page
      .getByRole("button", { name: new RegExp(label) })
      .first();
    await trigger.focus();
    await trigger.press("Enter");
    const dialog = page.getByRole("dialog").last();
    await expect(dialog).toBeVisible();
    await captureResponsive(page, info, label);
    const select = dialog.getByRole("combobox").first();
    if (await select.count()) {
      await select.click();
      await expect(page.getByRole("listbox")).toBeVisible();
      await captureResponsive(page, info, `${label}-menu`);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("listbox")).toHaveCount(0);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}
