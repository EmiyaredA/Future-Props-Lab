import { test, expect, type Locator } from "@playwright/test";

async function expectAbovePanel(element: Locator) {
  await expect(element).toBeVisible();
  await expect
    .poll(() =>
      element.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return node.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ),
        );
      }),
    )
    .toBe(true);
}

for (const theme of ["light", "dark"] as const) {
  test(`密钥弹层在懒加载模型页及滚动列表上方：${theme}`, async ({ page }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("future_props_theme", value),
      theme,
    );
    const keys = Array.from({ length: 8 }, (_, index) => ({
      id: `overlay-key-${index}`,
      name:
        index === 0
          ? "部署自动化与工作空间集成的长名称密钥".repeat(3)
          : `测试密钥 ${index + 1}`,
      key_prefix: `fpm_example${index}`,
      scopes: ["studio:read", "studio:write"],
      created_at: "2026-09-01T12:00:00Z",
      expires_at: "2099-12-01T12:00:00Z",
      last_used_at: null,
      revoked_at: index === 5 ? "2026-09-10T12:00:00Z" : null,
      revision: 0,
    }));
    await page.route("**/v1/account/api-keys", (route) =>
      route.fulfill({ json: keys }),
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/home");
    // Loading the catalog after the account component reproduces the CSS cascade bug.
    await page.getByRole("button", { name: "管理模型", exact: true }).click();
    await expect(page).toHaveURL(/model-service/);
    await page.getByRole("button", { name: "账号菜单" }).click();
    await page.getByRole("menuitem", { name: "账号设置" }).click();
    const panel = page.getByRole("dialog", { name: "账号设置", exact: true });
    await panel.getByRole("button", { name: "API 密钥", exact: true }).click();
    const row = panel.getByRole("row", { name: /测试密钥 8/ });
    await expect(row).toBeVisible();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await row.scrollIntoViewIfNeeded();
      const opener = row.getByRole("button", { name: "续期", exact: true });
      await opener.click();
      const renew = page.getByRole("alertdialog", { name: "续期“测试密钥 8”" });
      await expectAbovePanel(renew.getByRole("button", { name: "确认续期" }));
      await renew.getByRole("combobox", { name: "续期时长" }).click();
      await expectAbovePanel(
        page.getByRole("option", { name: "180 天", exact: true }),
      );
      await page.keyboard.press("Escape");
      await expect(renew).toBeVisible();
      await expect(page.getByRole("listbox")).toBeHidden();
      await renew.getByRole("button", { name: "确认续期" }).focus();
      await page.keyboard.press("Tab");
      await expect(
        renew.getByRole("button", { name: "关闭确认弹窗" }),
      ).toBeFocused();
      await page.screenshot({
        path: `/tmp/fpl-key-renew-overlay-${theme}-${width}.png`,
      });
      await page.keyboard.press("Escape");
      await expect(renew).toBeHidden();
      await expect(panel).toBeVisible();
      await expect(opener).toBeFocused();
      await row.getByRole("button", { name: "删除", exact: true }).click();
      const remove = page.getByRole("alertdialog", {
        name: "删除“测试密钥 8”",
      });
      await expectAbovePanel(remove.getByRole("button", { name: "确认删除" }));
      await remove.getByRole("button", { name: "取消" }).click();
      await row.getByRole("button", { name: "测试密钥 8更多操作" }).click();
      await expectAbovePanel(row.getByRole("menuitem", { name: "撤销密钥" }));
      await row.getByRole("menuitem", { name: "撤销密钥" }).click();
      const revoke = page.getByRole("alertdialog", {
        name: "撤销“测试密钥 8”",
      });
      await expectAbovePanel(revoke.getByRole("button", { name: "确认撤销" }));
      await revoke.getByRole("button", { name: "取消" }).click();
      await panel.getByRole("combobox", { name: "密钥状态" }).click();
      await expectAbovePanel(
        page.getByRole("option", { name: "已撤销", exact: true }),
      );
      await page.keyboard.press("Escape");
      await expect(panel).toBeVisible();
      await row.scrollIntoViewIfNeeded();
      await expectAbovePanel(
        row.getByRole("button", { name: "删除", exact: true }),
      );
      expect(
        await panel
          .locator(".api-key-table-wrap")
          .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: `/tmp/fpl-key-list-overlays-${theme}-${width}.png`,
      });
    }
  });
}
