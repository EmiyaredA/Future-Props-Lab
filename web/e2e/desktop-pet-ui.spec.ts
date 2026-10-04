import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";
import { petPackage } from "./fixtures/desktop-pet";
import { setResponsiveTheme } from "./responsive-capture";

async function bounds(page: Page) {
  const result = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
    popups: [...document.querySelectorAll('[role="dialog"], .dp-menu')]
      .filter((element) => element.getClientRects().length)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
      })
      .filter(
        (rect) =>
          rect.x < -1 ||
          rect.y < -1 ||
          rect.right > innerWidth + 1 ||
          rect.bottom > innerHeight + 1,
      ),
  }));
  expect(result.width).toBeLessThanOrEqual(result.viewport + 1);
  expect(result.popups).toEqual([]);
}

async function capture(page: Page, info: TestInfo, name: string) {
  await bounds(page);
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    animations: "disabled",
  });
}

async function createPet(page: Page) {
  await page.goto("/apps/desktop-pet");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = {
    "X-CSRF-Token": decodeURIComponent(csrf),
    Origin: new URL(page.url()).origin,
  };
  const response = await page.request.post(
    "/v1/desktop-pet/projects/import-whale",
    {
      headers,
      multipart: {
        file: {
          name: "ui-test.zip",
          mimeType: "application/zip",
          buffer: process.env.FPL_UI_PET_ARCHIVE
            ? readFileSync(process.env.FPL_UI_PET_ARCHIVE)
            : petPackage(),
        },
      },
    },
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  return { project: await response.json(), headers };
}

test("project dialogs, all editor steps and menus fit both themes and preserve the stage in compact panels", async ({
  page,
}, info) => {
  test.setTimeout(240000);
  const { project, headers } = await createPet(page);
  const longTitle = "界面验收 · 含有较长名称的桌宠角色项目".repeat(4);
  const renamed = await page.request.patch(
    `/v1/desktop-pet/projects/${project.id}`,
    { headers, data: { expectedRevision: project.revision, title: longTitle } },
  );
  expect(renamed.ok()).toBeTruthy();
  const source = await page.request.post("/v1/live2d-workshop/projects", {
    headers,
    data: { title: "界面验收来源角色" },
  });
  expect(source.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByRole("heading", { name: longTitle })).toBeVisible();
  for (const width of [390, 768, 1600]) {
    await page.setViewportSize({ width, height: 850 });
    for (const theme of ["light", "dark"]) {
      await setResponsiveTheme(page, theme);
      await capture(page, info, `projects-${width}-${theme}`);
      const search = page.getByRole("textbox", { name: "搜索桌宠项目" });
      await search.fill("不存在的项目");
      await expect(page.getByText("没有匹配的桌宠项目")).toBeVisible();
      await page.getByRole("button", { name: "清空搜索" }).click();
      await page.getByRole("button", { name: "新建桌宠", exact: true }).click();
      await page
        .getByRole("button", { name: /界面验收来源角色.*版本/ })
        .click();
      await capture(page, info, `create-dialog-${width}-${theme}`);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: `重命名 ${longTitle}` }).click();
      await capture(page, info, `rename-dialog-${width}-${theme}`);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: `删除 ${longTitle}` }).click();
      await capture(page, info, `delete-dialog-${width}-${theme}`);
      await page.keyboard.press("Escape");
    }
  }
  await page.goto(`/apps/desktop-pet/projects/${project.id}/editor`);
  await expect(page.locator(".dp-pet-renderer canvas")).toHaveCount(1);
  const sizes = [
    { width: 390, height: 844 },
    { width: 768, height: 850 },
    { width: 1024, height: 768 },
    { width: 1280, height: 800 },
    { width: 1600, height: 1000 },
    { width: 844, height: 390 },
  ];
  for (const label of ["形象", "交互", "台词", "聊天", "习惯", "试玩"]) {
    await page
      .getByRole("navigation", { name: "桌宠编辑步骤" })
      .getByRole("button", { name: label, exact: true })
      .click();
    const stage = await page.locator(".dp-pet-renderer canvas").elementHandle();
    expect(stage).toBeTruthy();
    for (const size of sizes) {
      await page.setViewportSize(size);
      for (const theme of ["light", "dark"]) {
        await setResponsiveTheme(page, theme);
        if (size.width <= 1200) {
          for (const panel of ["列表", "预览", "属性"]) {
            await page
              .getByRole("navigation", { name: "桌宠工作区面板" })
              .getByRole("button", { name: panel, exact: true })
              .click();
            await bounds(page);
            expect(
              await stage!.evaluate((element) => element.isConnected),
            ).toBe(true);
            if (panel === "预览")
              await expect(
                page.locator(".dp-pet-renderer canvas"),
              ).toBeVisible();
          }
        }
        await capture(
          page,
          info,
          `${label}-${size.width}x${size.height}-${theme}`,
        );
        if (label === "交互") {
          await page.getByRole("button", { name: "动作", exact: true }).click();
          const stand = page.getByRole("menuitemradio", {
            name: "站立",
            exact: true,
          });
          await stand.hover();
          await capture(
            page,
            info,
            `menu-${size.width}x${size.height}-${theme}`,
          );
          const colors = await stand.evaluate((element) => {
            const style = getComputedStyle(element);
            return { color: style.color, background: style.backgroundColor };
          });
          expect(colors.color).not.toBe(colors.background);
          const contrast = await stand.evaluate((element) => {
            const luminance = (color: string) => {
              const channels = color
                .match(/[\d.]+/g)!
                .slice(0, 3)
                .map(Number)
                .map((channel) => {
                  const value = channel / 255;
                  return value <= 0.04045
                    ? value / 12.92
                    : ((value + 0.055) / 1.055) ** 2.4;
                });
              return (
                channels[0] * 0.2126 +
                channels[1] * 0.7152 +
                channels[2] * 0.0722
              );
            };
            const style = getComputedStyle(element);
            const text = luminance(style.color),
              background = luminance(style.backgroundColor);
            return (
              (Math.max(text, background) + 0.05) /
              (Math.min(text, background) + 0.05)
            );
          });
          expect(contrast).toBeGreaterThanOrEqual(4.5);
          expect(await stage!.evaluate((element) => element.isConnected)).toBe(
            true,
          );
          await page.keyboard.press("Escape");
          await expect(
            page.getByRole("button", { name: "动作", exact: true }),
          ).toBeFocused();
        }
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page
    .getByRole("navigation", { name: "桌宠编辑步骤" })
    .getByRole("button", { name: "习惯", exact: true })
    .click();
  const slider = page.getByRole("slider", { name: "桌宠高度" });
  const previousSize = Number(await slider.inputValue());
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue(String(Math.min(300, previousSize + 10)));
  // Only UI panel switches and resizes occur after the draft edit.
  await page.setViewportSize({ width: 768, height: 850 });
  await page
    .getByRole("navigation", { name: "桌宠编辑步骤" })
    .getByRole("button", { name: "聊天", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "性格" })
    .fill("保留这段未保存的草稿");
  const textarea = await page
    .getByRole("textbox", { name: "性格" })
    .elementHandle();
  for (const panel of ["列表", "预览", "属性"])
    await page
      .getByRole("navigation", { name: "桌宠工作区面板" })
      .getByRole("button", { name: panel, exact: true })
      .click();
  await page.setViewportSize({ width: 1600, height: 1000 });
  expect(await textarea!.evaluate((element) => element.isConnected)).toBe(true);
  await expect(page.getByRole("textbox", { name: "性格" })).toHaveValue(
    "保留这段未保存的草稿",
  );
  await page.getByRole("button", { name: "返回桌宠项目" }).click();
  await expect(
    page.getByRole("dialog", { name: "离开未保存的桌宠工程？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "继续编辑" }).click();
});

test("load failure offers a deliberate reload without exposing an endless loading state", async ({
  page,
}) => {
  const { project } = await createPet(page);
  const path = `**/v1/desktop-pet/projects/${project.id}/document`;
  await page.route(path, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify({ title: "暂时无法读取桌宠", status: 503 }),
    }),
  );
  await page.goto(`/apps/desktop-pet/projects/${project.id}/editor`);
  await expect(
    page.getByText("桌宠工程加载失败", { exact: true }),
  ).toBeVisible();
  await page.unroute(path);
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.getByText("形象与皮肤")).toBeVisible();
  await expect(page.getByText("桌宠工程加载失败", { exact: true })).toHaveCount(
    0,
  );
});
