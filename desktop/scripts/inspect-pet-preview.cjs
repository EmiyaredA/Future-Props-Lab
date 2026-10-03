// Exercises actual renderers and private preview IPC in disposable smoke data.
const path = require("node:path");
const assert = require("node:assert/strict");
const { expect } = require("@playwright/test");

async function inspectPetPreview(
  studio,
  pet,
  context,
  projectId,
  directory,
  human,
) {
  const toggle = studio.getByRole("switch", { name: /同步预览到桌宠/ });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(toggle).toBeEnabled();
  await studio.getByRole("button", { name: "交互", exact: true }).click();
  await studio.getByRole("button", { name: /点击身体/ }).click();
  const canvas = studio.locator(".dp-pet-renderer canvas");
  await canvas.evaluate((element) => {
    element.dataset.previewInstance = "original";
  });
  await studio.getByRole("button", { name: "动作", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-preview-instance", "original");
  await studio
    .getByRole("menuitemradio", { name: "坐下", exact: true })
    .click();
  await studio.getByRole("button", { name: "表情", exact: true }).click();
  if (human) {
    await expect(
      studio.getByRole("menuitemradio", { name: "眨单眼（当前角色未支持）" }),
    ).toBeDisabled();
    await expect(
      studio.getByRole("menuitemradio", { name: "难过（当前角色未支持）" }),
    ).toBeDisabled();
  }
  await studio
    .getByRole("menuitemradio", { name: "开心", exact: true })
    .click();
  await expect(studio.locator(".dp-preview-details")).toHaveText(
    "点击身体 · 坐下 · 开心",
  );
  await expect(canvas).toHaveAttribute("data-preview-instance", "original");
  await toggle.click();
  await expect(pet.locator(".pet-runtime-preview-status")).toHaveText(
    "临时预览，尚未保存",
  );
  await expect(pet.locator(".pet-runtime-bubble")).toHaveText("你好");
  await studio.waitForTimeout(2300);
  await studio.screenshot({
    path: path.join(directory, "editor-live-sit-happy.png"),
  });
  await pet.screenshot({
    path: path.join(directory, "pet-live-sit-happy.png"),
  });
  await studio.getByRole("button", { name: "台词", exact: true }).click();
  await studio
    .getByRole("textbox", { name: "第 1 句台词" })
    .fill("临时草稿，不应保存");
  await expect(pet.locator(".pet-runtime-bubble")).toHaveText(
    "临时草稿，不应保存",
  );
  const saved = await studio.evaluate(
    async (id) =>
      (await fetch(`/v1/desktop-pet/projects/${id}/document`)).json(),
    projectId,
  );
  assert.equal(saved.config.events.click.lines[0], "你好");
  await pet.evaluate(() => window.futurePropsDesktop.openPetChat());
  const chat = context
    .pages()
    .find((page) => page.url().includes("/pet-chat.html"));
  assert.ok(chat);
  await expect(pet.locator(".pet-runtime-preview-status")).toHaveText(
    "聊天中，联动暂停",
  );
  await studio
    .getByRole("textbox", { name: "第 1 句台词" })
    .fill("关闭聊天后展示最新草稿");
  await expect(pet.locator(".pet-runtime-bubble")).toHaveCount(0);
  await chat
    .evaluate(() => window.futurePropsDesktop.closePetChat())
    .catch((error) => {
      if (!chat.isClosed()) throw error;
    });
  await expect(pet.locator(".pet-runtime-bubble")).toHaveText(
    "关闭聊天后展示最新草稿",
  );
  await studio.getByRole("button", { name: "习惯", exact: true }).click();
  await studio.getByRole("slider").focus();
  await studio.keyboard.press("End");
  await expect(pet.locator(".pet-runtime-character")).toHaveCSS(
    "height",
    "300px",
  );
  await toggle.click();
  await expect(pet.locator(".pet-runtime-preview-status")).toHaveCount(0);
  await expect(pet.locator(".pet-runtime-character")).toHaveCSS(
    "height",
    "220px",
  );
  await toggle.click();
  await studio.getByRole("button", { name: "保存", exact: true }).click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(pet.locator(".pet-runtime-character")).toHaveCSS(
    "height",
    "300px",
  );
  await toggle.click();
  await expect(pet.locator(".pet-runtime-character")).toHaveCSS(
    "height",
    "300px",
  );
  // Revert inspection changes through the editor's regular CAS save.
  await studio.getByRole("slider").focus();
  await studio.keyboard.press("Home");
  for (let i = 0; i < 6; i++) await studio.keyboard.press("ArrowRight");
  await studio.getByRole("button", { name: "台词", exact: true }).click();
  await studio.getByRole("textbox", { name: "第 1 句台词" }).fill("你好");
  await studio.getByRole("button", { name: "交互", exact: true }).click();
  await studio.getByRole("button", { name: "动作", exact: true }).click();
  await studio
    .getByRole("menuitemradio", { name: "无动作", exact: true })
    .click();
  await studio.getByRole("button", { name: "表情", exact: true }).click();
  await studio
    .getByRole("menuitemradio", { name: "无表情", exact: true })
    .click();
  await studio.getByRole("button", { name: "保存", exact: true }).click();
  await toggle.click();
  await expect(pet.locator(".pet-runtime-character")).toHaveCSS(
    "height",
    "220px",
  );
  // Reloading destroys the owner lease without persisting its latest draft.
  await studio.reload();
  await expect(pet.locator(".pet-runtime-preview-status")).toHaveCount(0);
  await expect(
    studio.getByRole("switch", { name: /同步预览到桌宠/ }),
  ).toHaveAttribute("aria-checked", "false");
}
module.exports = { inspectPetPreview };
