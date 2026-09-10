import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`独立管理弹窗、草稿恢复与响应式内容：${theme}`, async ({ page }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("future_props_theme", value),
      theme,
    );
    const me = await (await page.request.get("/v1/auth/me")).json();
    const longName = "用于验证长显示名称不会撑开布局的团队成员".repeat(3);
    await page.route(/\/v1\/account\/workspaces\?/, (route) =>
      route.fulfill({
        json: {
          items: Array.from({ length: 25 }, (_, index) => ({
            ...me.workspace,
            id: index === 0 ? me.workspace.id : `workspace-${index}`,
            name: index === 0 ? me.workspace.name : `协作空间 ${index}`,
            owner_display_name: "管理员",
          })),
          total: 25,
        },
      }),
    );
    await page.route("**/v1/account/workspaces/current/members", (route) =>
      route.fulfill({
        json: {
          items: Array.from({ length: 10 }, (_, index) => ({
            membership_id: `member-${index}`,
            user_id: index === 0 ? me.user.id : `user-${index}`,
            username: `member-${index}`,
            display_name: index === 1 ? longName : `团队成员 ${index}`,
            role: index === 0 ? "owner" : "member",
            revision: 1,
            joined_at: "2026-09-01T08:00:00Z",
          })),
          total: 10,
        },
      }),
    );
    await page.route("**/v1/account/workspaces/current/invitations", (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: "sent",
              invitee_username: "waiting-member",
              status: "pending",
              role: "viewer",
              revision: 1,
              expires_at: "2026-12-01T00:00:00Z",
            },
          ],
          total: 1,
        },
      }),
    );
    await page.route("**/v1/account/workspace-invitations", (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: "received",
              workspace_name: "邀请加入的工作空间" + longName,
              status: "pending",
              role: "member",
              revision: 1,
              expires_at: "2026-12-01T00:00:00Z",
            },
          ],
          total: 1,
        },
      }),
    );
    await page.route(
      "**/v1/account/workspaces/current/audit-events**",
      (route) =>
        route.fulfill({
          json: {
            items: [
              {
                id: "audit-1",
                event_type: "workspace.member_role_updated",
                actor_username: "administrator",
                target_username: "member-1",
                outcome: "success",
                created_at: "2026-09-10T08:00:00Z",
                workspace_id: me.workspace.id,
                metadata: { note: longName },
              },
            ],
            total: 26,
            page: Number(
              new URL(route.request().url()).searchParams.get("page") || 1,
            ),
            page_size: 25,
          },
        }),
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/home");
    const trigger = page.getByRole("button", { name: /切换工作空间/ });
    await trigger.click();
    const overview = page.getByRole("dialog", {
      name: "工作空间",
      exact: true,
    });
    const management = page.getByRole("dialog", {
      name: "工作空间管理",
      exact: true,
    });
    await expect(overview.locator(".workspace-choice")).toHaveCount(25);
    await overview.getByLabel("搜索可访问的空间").fill("协作空间");
    await expect
      .poll(async () =>
        page.locator(".workspace-choice-list").getAttribute("aria-busy"),
      )
      .toBe("false");
    await overview.locator(".workspace-dialog-switcher").evaluate((el) => {
      el.scrollTop = 230;
    });
    await overview.getByLabel("空间名称").fill("未保存的空间草稿");
    const scrollTop = await overview
      .locator(".workspace-dialog-switcher")
      .evaluate((el) => el.scrollTop);
    await overview.getByRole("button", { name: "管理成员" }).click();
    await expect(overview).toBeHidden();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(
      management.getByRole("button", { name: "返回工作空间" }),
    ).toBeFocused();
    await expect(
      management.getByRole("tab", { name: "成员与邀请" }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(management.getByText("@member-1")).toBeVisible();
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 1024, height: 768 },
      { width: 1440, height: 500 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      for (const tab of ["成员与邀请", "角色与权限", "审计记录"]) {
        await management.getByRole("tab", { name: tab }).click();
        await expect(management.getByRole("tabpanel")).toBeVisible();
        const box = await management.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
        const content = management.getByRole("tabpanel");
        await expect
          .poll(() =>
            content.evaluate((el) => el.scrollWidth <= el.clientWidth),
          )
          .toBe(true);
        if (tab === "成员与邀请")
          await expect(management.getByText("@member-1")).toBeVisible();
        if (tab === "角色与权限")
          await expect(management.locator(".workspace-role-card")).toHaveCount(
            4,
          );
        if (tab === "审计记录")
          await expect(
            management.getByRole("button", { name: "查看详情" }),
          ).toBeVisible();
        await page.screenshot({
          path: `/tmp/fpl-management-${theme}-${viewport.width}x${viewport.height}-${tab}.png`,
        });
      }
    }
    const auditRequest = page.waitForRequest(
      (request) =>
        request.url().includes("audit-events") &&
        new URL(request.url()).searchParams.get("page") === "2",
    );
    await management.getByRole("button", { name: "下一页" }).click();
    await auditRequest;
    await management.getByRole("button", { name: "查看详情" }).click();
    await expect(
      management.getByRole("region", { name: "审计详情" }),
    ).toContainText(longName);
    const filtered = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname.endsWith("/audit-events") &&
        url.searchParams.get("actor_query") === "administrator" &&
        url.searchParams.get("page") === "1"
      );
    });
    await management
      .getByRole("textbox", { name: "操作者", exact: true })
      .fill("administrator");
    await filtered;
    await management.getByRole("tab", { name: "成员与邀请" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      management.getByRole("tab", { name: "角色与权限" }),
    ).toBeFocused();
    await expect(
      management.getByRole("tab", { name: "角色与权限" }),
    ).toHaveAttribute("aria-selected", "true");
    const back = management.getByRole("button", { name: "返回工作空间" });
    await back.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(management.getByRole("tabpanel")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(back).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(overview).toBeVisible();
    await expect(
      overview.getByRole("button", { name: "管理成员" }),
    ).toBeFocused();
    await expect(overview.getByLabel("空间名称")).toHaveValue(
      "未保存的空间草稿",
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(overview.getByLabel("搜索可访问的空间")).toHaveValue(
      "协作空间",
    );
    await expect
      .poll(() =>
        overview
          .locator(".workspace-dialog-switcher")
          .evaluate((el) => el.scrollTop),
      )
      .toBe(scrollTop);
    await overview.getByRole("button", { name: /我收到的邀请/ }).click();
    const invitations = page.getByRole("dialog", { name: "我收到的邀请" });
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(invitations.locator(".workspace-invitation-card")).toHaveCount(
      1,
    );
    await page.screenshot({
      path: `/tmp/fpl-received-invitations-${theme}.png`,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await invitations
        .locator(".workspace-management-content")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/fpl-received-invitations-${theme}-mobile.png`,
    });
    await invitations
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "放弃未保存的更改" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "继续编辑" }).click();
    await expect(invitations).toBeVisible();
    await expect(
      invitations.getByRole("button", { name: "关闭", exact: true }),
    ).toBeFocused();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .locator(".account-dialog-backdrop")
      .click({ position: { x: 5, y: 5 } });
    await page.getByRole("button", { name: "放弃更改" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}
