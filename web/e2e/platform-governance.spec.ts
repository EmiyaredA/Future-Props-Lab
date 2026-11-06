import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { THEME_KEY } from "../src/shared/ui/theme";

function isolatedOrigin(value: string | undefined) {
  const url = new URL(value ?? "");
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port)
    throw new Error("Governance tests require isolated loopback origins");
  return url.origin;
}

const management = isolatedOrigin(process.env.FPL_E2E_MANAGEMENT_ORIGIN);
const studio = isolatedOrigin(process.env.FPL_E2E_STUDIO_ORIGIN);
const username = process.env.FPL_E2E_MANAGEMENT_USERNAME;
const password = process.env.FPL_E2E_MANAGEMENT_PASSWORD;
if (!username || !password || management === studio)
  throw new Error(
    "Governance tests require distinct origins and fixture credentials",
  );

const pages = [
  ["accounts", "账号管理", "/v1/platform/accounts"],
  ["audit", "安全审计", "/v1/platform/security-events"],
  ["invites", "邀请码管理", "/v1/platform/registration-invite-codes"],
  ["settings", "全局设置", "/v1/platform/model-service-templates/user"],
  ["services", "服务管理", "/v1/platform/demo-services"],
  ["quotas", "运行额度", "/v1/platform/runtime-quotas"],
  ["application", "应用运行", "/v1/management/application"],
  ["access", "访问管理", "/v1/management/access/business"],
];

test.beforeEach(async ({ page, context }) => {
  await page.goto("/management/accounts");
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "账号管理" })).toBeVisible();
  const cookies = await context.cookies(management);
  expect(
    cookies.some(
      ({ name, httpOnly }) => name === "fpl_management_session" && httpOnly,
    ),
  ).toBe(true);
  expect((await context.request.get(studio + "/v1/auth/me")).status()).toBe(
    401,
  );
});

for (const width of [1440, 390]) {
  for (const theme of ["light", "dark"]) {
    test(`管理中台八个页面使用真实服务 ${width} ${theme}`, async ({
      page,
    }, info) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
      await page.addInitScript(
        ({ key, theme }) => {
          localStorage.setItem(key, theme);
          document.documentElement.dataset.theme = theme;
        },
        { key: THEME_KEY, theme },
      );
      for (const [path, title, api] of pages) {
        const data = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === `/management${api}` &&
            response.request().method() === "GET",
        );
        await page.goto(`/management/${path}`);
        await expect(
          page.getByRole("heading", { name: title, exact: true }),
        ).toBeVisible();
        expect((await data).status(), api).toBe(200);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${path} ${width} ${theme}`,
        ).toBeTruthy();
        await page.screenshot({
          path: info.outputPath(`${path}-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    });
  }
}

test("创建邀请码后注册登录，普通用户只获得业务权限", async ({
  page,
  browser,
}) => {
  await page.goto("/management/invites");
  await page.getByRole("button", { name: "创建邀请码", exact: true }).click();
  const create = page.getByRole("dialog", { name: "创建邀请码", exact: true });
  const suffix = randomUUID().slice(0, 8);
  const name = `浏览器注册-${suffix}`;
  const guestName = `registered-${suffix}`;
  const guestPassword = "Registration-Password!2026";
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
    await registration.goto(studio);
    await registration.getByRole("button", { name: "使用邀请码注册" }).click();
    await registration.getByLabel("用户名", { exact: true }).fill(guestName);
    await registration.getByLabel("密码", { exact: true }).fill(guestPassword);
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
      (await guest.request.get(studio + "/v1/platform/accounts")).status(),
    ).toBe(404);
    const docs = await guest.request.get(
      studio + "/v1/account/developer-documents",
    );
    expect(docs.status()).toBe(200);
    const { items } = await docs.json();
    expect(items.some(({ id }: { id: string }) => id === "dev-README")).toBe(
      true,
    );
    expect(
      items.some(({ source }: { source: string }) =>
        source.endsWith("/api.md"),
      ),
    ).toBe(false);
    const me = await (await guest.request.get(studio + "/v1/auth/me")).json();
    expect(me.user.platform_role).toBe("user");
    expect(me.permission_keys).toContain("docs.developer");
    expect(me.permission_keys).not.toContain("cloud-control.access");
    expect(me.permission_keys).not.toContain("projects.certify");
    const stored = await registration.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    );
    expect(stored).not.toContain(code);
    const adminLogin = await guest.request.post(
      management + "/management/v1/auth/login",
      {
        headers: { Origin: management },
        data: { username: guestName, password: guestPassword },
      },
    );
    expect(adminLogin.status()).toBe(401);
    expect(
      (
        await guest.request.get(management + "/management/v1/platform/accounts")
      ).status(),
    ).toBe(401);
  } finally {
    await guest.close();
  }
  await page.getByLabel("搜索邀请码").fill(name);
  await page.getByRole("button", { name: "兑换记录" }).click();
  await expect(
    page.getByRole("dialog", { name: `${name} · 兑换记录` }),
  ).toContainText(guestName);
});
