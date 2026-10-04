// Inspect only the disposable smoke's windows. No project writes or provider calls.
const path = require("node:path");
const { expect } = require("@playwright/test");

async function inspectPetUi(studio, pet, chat, projectId, directory) {
  const theme = async (page, value) =>
    page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, value);
  await studio.setViewportSize({ width: 1440, height: 900 });
  for (const value of ["light", "dark"]) {
    await theme(studio, value);
    await studio.getByRole("button", { name: "形象", exact: true }).click();
    await studio.screenshot({
      path: path.join(directory, `editor-look-${value}.png`),
    });
    await studio.getByRole("button", { name: "交互", exact: true }).click();
    const canvas = await studio
      .locator(".dp-pet-renderer canvas")
      .elementHandle();
    await studio.getByRole("button", { name: "动作", exact: true }).click();
    const item = studio.getByRole("menuitemradio", {
      name: "无动作",
      exact: true,
    });
    await item.hover();
    await expect(
      studio.getByRole("menuitemradio", { checked: true }),
    ).toHaveCount(1);
    await studio.screenshot({
      path: path.join(directory, `editor-menu-${value}.png`),
    });
    expect(await canvas.evaluate((element) => element.isConnected)).toBe(true);
    await studio.keyboard.press("Escape");
    await expect(
      studio.getByRole("button", { name: "动作", exact: true }),
    ).toBeFocused();
    await theme(chat, value);
    await chat.getByRole("button", { name: "聊天设置" }).click();
    await chat.screenshot({
      path: path.join(directory, `chat-settings-${value}.png`),
    });
    await chat.getByRole("button", { name: "完成设置" }).click();
    await theme(pet, value);
    await pet.mouse.move(150, 300, { steps: 8 });
    await expect(
      pet.getByRole("button", { name: "隐藏", exact: true }),
    ).toBeVisible();
    await pet.screenshot({
      path: path.join(directory, `pet-actions-${value}.png`),
    });
  }
  // Real scrolling in the companion preserves a reader's place while opening settings.
  await chat.locator(".dp-chat-history").evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(chat.getByRole("button", { name: "回到最新" })).toBeVisible();
  await chat.getByRole("button", { name: "聊天设置" }).click();
  await chat.getByRole("button", { name: "完成设置" }).click();
  expect(
    await chat
      .locator(".dp-chat-history")
      .evaluate((element) => element.scrollTop),
  ).toBe(0);
  await chat.screenshot({
    path: path.join(directory, "chat-reading-history.png"),
  });
  await chat.getByRole("button", { name: "回到最新" }).click();
  await expect(chat.getByRole("button", { name: "回到最新" })).toHaveCount(0);
  // A deterministic read failure exercises the native error surface, then restores the real snapshot.
  const documentPath = `**/v1/desktop-pet/projects/${projectId}/document`;
  await pet.route(documentPath, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify({ detail: "隔离验收：临时读取失败" }),
    }),
  );
  await pet.reload();
  await expect(pet.getByRole("alert")).toContainText("桌宠加载失败");
  for (const value of ["light", "dark"]) {
    await theme(pet, value);
    await pet.screenshot({
      path: path.join(directory, `pet-error-${value}.png`),
    });
    await expect(pet.getByRole("button", { name: "打开应用" })).toBeVisible();
  }
  await pet.unroute(documentPath);
  await pet.reload();
  await expect(pet.locator(".pet-runtime canvas")).toBeVisible();
  await expect(pet.getByRole("alert")).toHaveCount(0);
}
module.exports = { inspectPetUi };
