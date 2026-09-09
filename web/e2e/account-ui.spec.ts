import { test, expect } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`账号菜单、双栏工作区与中台视觉：${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript(
      (value) => localStorage.setItem("future_props_theme", value),
      theme,
    );
    await page.goto("/home");
    await expect(
      page.getByRole("heading", { name: "今天想从哪里开始？" }),
    ).toBeVisible();
    const menu = page.getByRole("button", { name: "账号菜单" });
    await menu.click();
    await expect(
      page.getByRole("menuitem", { name: "账号设置" }),
    ).toBeFocused();
    expect(
      await menu
        .locator(".account-identity-avatar")
        .evaluate(
          (el) =>
            getComputedStyle(el).color !== getComputedStyle(el).backgroundColor,
        ),
    ).toBe(true);
    await page.screenshot({ path: `/tmp/fpl-account-menu-${theme}.png` });
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await page.getByRole("button", { name: /切换工作区/ }).click();
    const workspace = page.getByRole("dialog", { name: "工作区", exact: true });
    await expect(workspace.getByLabel("空间名称")).toBeVisible();
    await expect(
      workspace.getByRole("button", { name: "保存更改" }),
    ).toBeDisabled();
    await expect(workspace.locator(".workspace-choice").first()).toBeVisible();
    await page.screenshot({ path: `/tmp/fpl-workspace-dialog-${theme}.png` });
    await workspace.getByRole("button", { name: /角色与权限/ }).click();
    await expect(
      workspace.getByRole("columnheader", { name: "只读成员" }),
    ).toBeVisible();
    await workspace.getByRole("button", { name: "返回空间设置" }).click();
    await workspace.getByLabel("空间名称").fill("未保存的草稿");
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "放弃未保存的更改" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "继续编辑" }).click();
    await expect(workspace.getByLabel("空间名称")).toHaveValue("未保存的草稿");
    await workspace.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "放弃更改" }).click();
    await expect(workspace).toBeHidden();
    await menu.click();
    await page.getByRole("menuitem", { name: "账号设置" }).click();
    const account = page.getByRole("dialog", { name: "账号设置", exact: true });
    const avatarBox = await account
      .locator(".account-profile-avatar-editor")
      .boundingBox();
    const nameBox = await account
      .getByLabel("显示名称", { exact: true })
      .boundingBox();
    expect(Math.abs(avatarBox!.x - nameBox!.x)).toBeLessThan(1);
    await page.screenshot({ path: `/tmp/fpl-profile-${theme}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await account
      .getByRole("button", { name: "保存资料" })
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await account.locator(".account-settings-content").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({ path: `/tmp/fpl-profile-mobile-${theme}.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await account.getByRole("button", { name: "API 密钥" }).click();
    await expect(account.getByLabel("密钥名称")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto("/management/accounts");
    await expect(
      page.locator(".management-stat strong").first(),
    ).not.toHaveText("—");
    await page.screenshot({
      path: `/tmp/fpl-accounts-${theme}.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `/tmp/fpl-accounts-mobile-${theme}.png`,
      fullPage: true,
    });
    await page.goto("/management/workspaces");
    await page.getByRole("button", { name: "空间设置与成员" }).click();
    await expect(workspace.getByLabel("空间名称")).toBeVisible();
    await workspace
      .getByRole("button", { name: "空间列表", exact: true })
      .click();
    await expect(workspace.getByLabel("搜索可访问的空间")).toBeVisible();
    await workspace
      .getByRole("button", { name: "当前空间", exact: true })
      .click();
    await expect(workspace.getByLabel("空间名称")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({ path: `/tmp/fpl-workspace-mobile-${theme}.png` });
  });
}
