// Assertions target only the disposable Electron smoke process and demo model.
const assert = require("node:assert/strict");
const path = require("node:path");
const { expect } = require("@playwright/test");

async function inspectCompanionChat(chat, pet, studio, projectId, directory) {
  const longReply =
    "先给你一个结论。" +
    "完整说明会保留在对话面板中，展开不会重新发送消息。".repeat(12);
  await expect(chat.getByRole("textbox", { name: "输入消息" })).toBeEnabled();
  assert.equal(await chat.evaluate(() => innerWidth), 320);
  await studio.evaluate(async (text) => {
    const csrf = document.cookie
      .split("; ")
      .find((value) => value.startsWith("fpl_csrf="))
      ?.slice(9);
    const headers = {
      "Content-Type": "application/json",
      "X-CSRF-Token": decodeURIComponent(csrf || ""),
    };
    const service = await fetch("/v1/platform/demo-services").then((r) =>
      r.json(),
    );
    const response = await fetch("/v1/platform/demo-services/mock_model", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        expected_revision: service.find((item) => item.id === "mock_model")
          .revision,
        value: { enabled: true, response_text: text },
      }),
    });
    if (!response.ok)
      throw new Error(`Demo setting failed: ${response.status}`);
  }, longReply);
  await chat.getByRole("textbox", { name: "输入消息" }).fill("请展开说明");
  await chat.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    chat.getByRole("button", { name: "展开完整回复" }),
  ).toBeVisible();
  await expect(chat.getByRole("textbox", { name: "输入消息" })).toBeEnabled();
  assert.ok(
    await chat
      .locator(".dp-chat-bubble p")
      .evaluate((p) => Array.from(p.textContent).length <= 121),
  );
  for (const theme of ["light", "dark"]) {
    await chat.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await chat.screenshot({
      path: path.join(directory, `companion-bubble-${theme}.png`),
    });
    await chat.getByRole("button", { name: "展开完整回复" }).click();
    await expect(chat.getByText(longReply, { exact: true })).toHaveCount(1);
    assert.equal(await chat.evaluate(() => innerWidth), 360);
    await chat.screenshot({
      path: path.join(directory, `companion-dialogue-${theme}.png`),
    });
    await chat.getByRole("button", { name: "收回气泡" }).click();
  }
  await chat.getByRole("button", { name: "展开完整回复" }).click();
  await chat.getByRole("button", { name: "完整对话", exact: true }).click();
  await expect(chat.getByRole("button", { name: "完整对话" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const settings = await studio.evaluate(
    async (id) =>
      fetch(`/v1/desktop-pet/projects/${id}/chat`).then((r) => r.json()),
    projectId,
  );
  assert.equal(settings.presentationMode, "dialogue");
  assert.equal(
    settings.messages.filter(
      (item) => item.role === "user" && item.content === "请展开说明",
    ).length,
    1,
  );
  await expect(pet.locator(".pet-runtime-bubble")).toHaveCount(0);
  const layered = (await pet.locator(".dp-whale-renderer").count()) > 0;
  const original = await pet.evaluate(() => ({ x: screenX, y: screenY }));
  await pet.mouse.move(150, 300, { steps: 8 });
  await pet.mouse.down();
  await pet.mouse.move(175, 275, { steps: 10 });
  if (layered)
    await expect(pet.locator("[data-contact-shadow]")).toHaveAttribute(
      "opacity",
      "0",
    );
  await pet.mouse.up();
  if (layered)
    await expect(pet.locator("[data-contact-shadow]")).toHaveAttribute(
      "opacity",
      "1",
    );
  await pet.evaluate(() => window.futurePropsDesktop.movePet(0, 50));
  await expect(chat.locator(".dp-chat-window")).toHaveClass(/tail-right/);
  await pet.evaluate(
    ({ x, y }) => window.futurePropsDesktop.movePet(x, y),
    original,
  );
  await expect(chat.locator(".dp-chat-window")).toHaveClass(/tail-left/);
  await chat.reload();
  await expect(chat.getByRole("button", { name: "完整对话" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(chat.getByText(longReply, { exact: true })).toBeVisible();
  await expect(pet.locator(".pet-runtime-bubble")).toHaveCount(0);
  await chat.mouse.move(1, 1);
  await chat.mouse.move(80, 40);
  await chat.getByRole("button", { name: "聊天设置" }).click();
  await expect(chat.getByRole("heading", { name: "聊天设置" })).toBeVisible();
  await chat.getByRole("button", { name: "完成设置" }).click();
}
module.exports = { inspectCompanionChat };
