import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const pages = [
  ["accounts", "账号管理"],
  ["audit", "安全审计"],
  ["invites", "邀请码管理"],
  ["settings", "全局设置"],
  ["services", "服务管理"],
  ["quotas", "运行额度"],
];

test("七个中台页面在桌面手机明暗主题下可访问且无横向溢出", async ({ page }) => {
  test.setTimeout(120000);
  await mkdir("../.local/output/platform-governance", { recursive: true });
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const theme of ["light", "dark"]) {
      await page.addInitScript((theme) => {
        localStorage.setItem("future_props_theme", theme);
        document.documentElement.dataset.theme = theme;
      }, theme);
      for (const [path, title] of pages) {
        await page.goto(`/management/${path}`);
        await expect(
          page.getByRole("heading", { name: title, exact: true }),
        ).toBeVisible();
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
        }, theme);
        await expect(page.getByText("正在加载", { exact: true })).toHaveCount(
          0,
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${path} ${viewport.width} ${theme}`,
        ).toBeTruthy();
        await page.screenshot({
          path: `../.local/output/platform-governance/${path}-${viewport.width}-${theme}.png`,
          fullPage: true,
        });
      }
    }
  }
});

test("创建邀请码后注册登录，普通用户不能访问中台和敏感文档", async ({
  page,
  browser,
}) => {
  await page.goto("/management/invites");
  await page.getByRole("button", { name: "创建邀请码", exact: true }).click();
  const create = page.getByRole("dialog", { name: "创建邀请码", exact: true });
  const name = `浏览器注册-${Date.now()}`;
  await create.getByLabel("名称", { exact: true }).fill(name);
  await create.getByRole("button", { name: "创建邀请码", exact: true }).click();
  const secretDialog = page.getByRole("dialog", { name: "邀请码已就绪" });
  const code = await secretDialog.locator("code").innerText();
  await secretDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByText(code, { exact: true })).toHaveCount(0);
  const guest = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  try {
    const registration = await guest.newPage();
    await registration.goto("/");
    await registration.getByRole("button", { name: "使用邀请码注册" }).click();
    await registration
      .getByLabel("用户名", { exact: true })
      .fill(`registered-${Date.now()}`);
    await registration
      .getByLabel("密码", { exact: true })
      .fill("Registration-Password!2026");
    await registration.getByLabel("邀请码", { exact: true }).fill(code);
    const registered = registration.waitForResponse((response) =>
      response.url().endsWith("/v1/auth/register"),
    );
    await registration
      .getByRole("button", { name: "注册并登录", exact: true })
      .click();
    expect((await registered).status()).toBe(201);
    await expect(
      registration.getByRole("button", { name: "注册并登录", exact: true }),
    ).toHaveCount(0);
    expect(
      (await guest.request.get("/v1/platform/permission-policy")).status(),
    ).toBe(403);
    expect(
      (await guest.request.get("/v1/account/developer-documents")).status(),
    ).toBe(403);
    const me = await (await guest.request.get("/v1/auth/me")).json();
    expect(me.user.platform_role).toBe("user");
    expect(me.workspace.permission_keys).not.toContain("diagnostics.model");
    const stored = await registration.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    );
    expect(stored).not.toContain(code);
  } finally {
    await guest.close();
  }
  await page.getByLabel("搜索邀请码").fill(name);
  await page.getByRole("button", { name: "兑换记录" }).click();
  await expect(
    page.getByRole("dialog", { name: `${name} · 兑换记录` }),
  ).toContainText("registered-");
});
