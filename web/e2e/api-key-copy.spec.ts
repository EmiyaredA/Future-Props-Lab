import { expect, test, type Page } from "@playwright/test";

async function openKeys(page: Page) {
  await page.getByRole("button", { name: "账号菜单" }).click();
  await page.getByRole("menuitem", { name: "账号设置" }).click();
  const settings = page.getByRole("dialog", { name: "账号设置", exact: true });
  await settings.getByRole("button", { name: "API 密钥", exact: true }).click();
  return settings;
}

test("copies the same key after reload and rechecks the password when required", async ({
  page,
}) => {
  const clipboard: string[] = [];
  await page.exposeFunction("recordKeyCopy", (secret: string) => {
    clipboard.push(secret);
  });
  await page.addInitScript(() => {
    let rejectNextWrite = true;
    Object.defineProperty(navigator.clipboard, "writeText", {
      value: async (secret: string) => {
        if (rejectNextWrite) {
          rejectNextWrite = false;
          throw new DOMException("Permission denied", "NotAllowedError");
        }
        await (
          window as unknown as {
            recordKeyCopy: (value: string) => Promise<void>;
          }
        ).recordKeyCopy(secret);
      },
    });
  });
  await page.goto("/home");
  const settings = await openKeys(page);
  const name = `复制验收 ${Date.now()}`;
  await settings.getByLabel("密钥名称").fill(name);
  const issued = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/v1/account/api-keys" &&
      response.request().method() === "POST",
  );
  await settings.getByRole("button", { name: "创建密钥", exact: true }).click();
  const { api_key: key, secret } = await (await issued).json();
  await expect(settings.getByText(secret, { exact: true })).toBeVisible();

  await page.reload();
  await openKeys(page);
  const row = settings.getByRole("row", { name: new RegExp(name) });
  await expect(row.getByText(`${key.key_prefix}••••`)).toBeVisible();
  await expect(settings.getByText(secret, { exact: true })).toHaveCount(0);
  const opener = row.getByRole("button", { name: "查看并复制" });
  const path = `**/v1/account/api-keys/${key.id}/secret`;
  await page.route(
    path,
    (route) =>
      route.fulfill({
        status: 403,
        json: { code: "reauthentication_required" },
      }),
    { times: 1 },
  );
  await opener.click();
  const dialog = page.getByRole("alertdialog", { name: `查看并复制“${name}”` });
  const password = dialog.getByLabel("验证账号密码");
  await expect(password).toBeFocused();
  await password.fill("invalid-test-password");
  await password.press("Enter");
  await expect(dialog.getByRole("alert")).toHaveText("密码不正确");
  await password.fill(process.env.FPL_E2E_PASSWORD || "E2E-Password-2026!");
  await password.press("Enter");
  const plaintext = dialog.getByLabel("完整密钥");
  await expect(plaintext).toHaveValue(secret);
  const copy = dialog.getByRole("button", { name: "复制密钥" });
  await copy.click();
  await expect(dialog.getByRole("alert")).toContainText("请手动复制");
  await expect(plaintext).toBeFocused();
  expect(
    await plaintext.evaluate((input: HTMLInputElement) => input.selectionEnd),
  ).toBe(secret.length);
  await copy.click();
  await expect(dialog.getByRole("status")).toHaveText("密钥已复制。");
  expect(clipboard).toEqual([secret]);
  await page.keyboard.press("Escape");
  await expect(plaintext).toHaveCount(0);
  await expect(opener).toBeFocused();
  await page.setViewportSize({ width: 390, height: 780 });
  await opener.press("Enter");
  await expect(plaintext).toHaveValue(secret);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("future-props:navigate", { detail: "/model-service" }),
    ),
  );
  await expect(plaintext).toHaveCount(0);
});
