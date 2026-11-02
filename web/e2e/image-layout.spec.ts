import { expect, test, type Locator } from "@playwright/test";
import { setResponsiveTheme } from "./responsive-capture";

test.use({ deviceScaleFactor: 2 });

async function expectImageFitsFrame(image: Locator) {
  await image.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      image.evaluate(
        (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
      ),
    )
    .toBe(true);
  const dimensions = await image.evaluate((el: HTMLImageElement) => {
    const frame = el.parentElement!;
    const imageRect = el.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    return {
      width: imageRect.width,
      height: imageRect.height,
      frameWidth: frame.clientWidth,
      frameHeight: frame.clientHeight,
      top: imageRect.top - frameRect.top,
      left: imageRect.left - frameRect.left,
      sizes: el.sizes,
    };
  });
  expect(dimensions.width).toBeGreaterThan(0);
  expect(dimensions.height).toBeGreaterThan(0);
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.frameWidth + 1);
  expect(dimensions.height).toBeLessThanOrEqual(dimensions.frameHeight + 1);
  expect(dimensions.top).toBeGreaterThanOrEqual(-1);
  expect(dimensions.left).toBeGreaterThanOrEqual(-1);
  expect(dimensions.sizes).not.toMatch(/^auto(?:,|$)/);
}

test("application icons and recent entries show complete pictures across sizes and themes", async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "future-props-recent-applications",
      JSON.stringify([
        "thought-workshop",
        "agent-workbench",
        "interview-assistant",
      ]),
    ),
  );
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto("/apps");
  await expect(
    page.getByRole("heading", { name: "应用", exact: true }),
  ).toBeVisible();
  for (const width of [1440, 1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    for (const theme of ["dark", "light"]) {
      await setResponsiveTheme(page, theme);
      const icons = page.locator(".application-icon img");
      await expect(icons).toHaveCount(10);
      for (const icon of await icons.all()) await expectImageFitsFrame(icon);
      if (width > 1100) {
        for (const icon of await page.locator(".application-recent img").all())
          await expectImageFitsFrame(icon);
      }
      await page
        .getByRole("heading", { name: "应用", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath(`applications-icons-${width}-${theme}.png`),
        animations: "disabled",
      });
    }
  }
});

test("shared brands fit navigation, account menu and workshop headers", async ({
  page,
}, info) => {
  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const account = await response.json();
    account.user.avatar_url = "/brand/agent-workbench-mark.png";
    await route.fulfill({ response, json: account });
  });
  await page.setViewportSize({ width: 1440, height: 1024 });
  for (const path of [
    "/home",
    "/model-service",
    "/apps/visual-workshop",
    "/apps/presentation-workshop",
    "/apps/video-editor",
    "/apps/director-desk",
  ]) {
    await page.goto(path);
    await expect(
      page.locator(".studio-main h1, .workshop-main h1").first(),
    ).toBeVisible({ timeout: 15000 });
    const brands = page.locator(
      ".brand-mark, .workshop-brand img, .account-identity-avatar img",
    );
    expect(await brands.count()).toBeGreaterThan(0);
    for (const icon of await brands.all())
      if (await icon.isVisible()) await expectImageFitsFrame(icon);
  }
  await page.goto("/apps");
  await page.getByRole("button", { name: "账号菜单" }).click();
  for (const icon of await page.locator(".account-identity-avatar img").all())
    if (await icon.isVisible()) await expectImageFitsFrame(icon);
  await page.screenshot({
    path: info.outputPath("account-and-brand-icons.png"),
    animations: "disabled",
  });
});
