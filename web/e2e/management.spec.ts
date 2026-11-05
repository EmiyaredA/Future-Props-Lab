import { expect, test, type Page } from "@playwright/test";

const user = {
  id: "admin",
  username: "admin",
  display_name: "管理员",
  email: null,
  avatar_url: null,
  is_platform_admin: true,
  platform_role: "admin",
  revision: 0,
};
async function mock(page: Page, local: boolean) {
  const actions: { url: string; data: Record<string, unknown> }[] = [];
  await page.route("**/v1/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    let value: unknown;
    if (path === "/v1/auth/me")
      value = {
        user,
        must_change_password: false,
        permission_keys: ["configuration.manage"],
        storage_upgrade_required: false,
        session_expires_at: "2099-01-01T00:00:00",
      };
    else if (path === "/v1/management/runtime")
      value = { local_browser: local };
    else if (path === "/v1/management/application")
      value = { phase: "stopped", error: "", force_stop_available: false };
    else if (path === "/v1/management/application/logs")
      value = { lines: ["应用已停止", "token=[redacted]"] };
    else if (path.endsWith("/actions")) {
      actions.push({ url: path, data: request.postDataJSON() });
      value = {
        id: "11111111-1111-4111-8111-111111111111",
        status: "queued",
        operation: "management.application",
        revision: 0,
      };
    } else if (path.includes("/management/jobs/"))
      value = {
        id: "11111111-1111-4111-8111-111111111111",
        status: "completed",
        operation: "management.application",
        revision: 1,
      };
    else if (path.includes("/management/access/"))
      value = {
        phase: "off",
        url: path.endsWith("business")
          ? "https://studio.example.test"
          : "https://admin.example.test",
        error: "",
      };
    else if (path === "/v1/platform/accounts")
      value = { items: [], total: 0, page: 1, page_size: 25 };
    else if (path === "/v1/account/profile") value = user;
    else if (path === "/v1/account/sessions") value = { items: [], total: 0 };
    else if (path === "/v1/account/api-keys") value = [];
    else if (path === "/v1/account/security-events")
      value = { items: [], total: 0 };
    else
      return route.fulfill({
        status: 404,
        json: { detail: "unexpected management request" },
      });
    await route.fulfill({ json: value });
  });
  return actions;
}
for (const theme of ["light", "dark"]) {
  for (const width of [390, 768, 1600]) {
    test(`independent management ${theme} ${width}`, async ({ page }, info) => {
      const actions = await mock(page, true);
      await page.setViewportSize({ width, height: 960 });
      await page.addInitScript((value) => {
        localStorage.setItem("future_props_theme", value);
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.goto("/management/application");
      await expect(
        page.getByRole("heading", { name: "应用运行", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "启动应用", exact: true }).click();
      expect(actions).toHaveLength(0);
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await page.getByRole("button", { name: "取消", exact: true }).click();
      if (width < 767)
        await page.getByRole("button", { name: "打开管理导航" }).click();
      await page.getByRole("button", { name: "访问管理", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "访问管理", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("https://admin.example.test", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("https://studio.example.test", { exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBeTruthy();
      await page.screenshot({
        path: info.outputPath(`management-${theme}-${width}.png`),
        fullPage: true,
      });
      await page.getByRole("button", { name: "账号菜单" }).click();
      await expect(
        page.getByRole("menuitem", { name: "管理中台" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("menuitem", { name: "本地与公网访问" }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "账号菜单" }),
      ).toBeFocused();
    });
  }
}
test("public management hides host mutations and logs", async ({ page }) => {
  const actions = await mock(page, false);
  await page.goto("/management/application");
  await expect(
    page.getByRole("heading", { name: "应用运行", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "启动应用", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "查看应用日志" })).toHaveCount(
    0,
  );
  expect(actions).toHaveLength(0);
});

test("local management can start, cancel and retry a model installation", async ({
  page,
}) => {
  await mock(page, true);
  let state = {
    id: "qwen3-tts-0.6b-base",
    label: "Qwen3-TTS 0.6B Base",
    repository: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
    license: "Apache-2.0",
    model_revision: "fixed",
    download_bytes: 2520000000,
    required_disk_bytes: 7200000000,
    compatible: true,
    status: "not_installed",
    enabled: false,
    loaded: false,
    busy: false,
    progress: 0,
    revision: 0,
  };
  const actions: string[] = [];
  await page.route("**/v1/platform/demo-services", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/v1/model-providers", (route) =>
    route.fulfill({
      json: {
        revision: 1,
        suppliers: [],
        providers: [],
        default_model_ids: {},
      },
    }),
  );
  await page.route("**/v1/local-models", (route) =>
    route.fulfill({ json: { can_manage: true, items: [state] } }),
  );
  await page.route("**/v1/platform/local-models/*/actions", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.expected_revision).toBe(state.revision);
    actions.push(body.action);
    const status =
      body.action === "cancel"
        ? "cancelled"
        : actions.length === 1
          ? "installing"
          : "installed";
    state = {
      ...state,
      status,
      enabled: status === "installed",
      progress: status === "installed" ? 100 : status === "installing" ? 10 : 0,
      revision: state.revision + 1,
    };
    await route.fulfill({ json: state });
  });
  await page.goto("/management/services");
  const install = page.getByRole("button", { name: "下载安装", exact: true });
  await expect(install).toBeVisible();
  expect(actions).toEqual([]);
  await install.click();
  await page.getByRole("button", { name: "取消安装", exact: true }).click();
  await page.getByRole("button", { name: "重试安装", exact: true }).click();
  await expect(page.getByText("服务已启用", { exact: true })).toBeVisible();
  expect(actions).toEqual(["install", "cancel", "install"]);
});
