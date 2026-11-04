import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const { origin, cookies, build, password } = JSON.parse(
  readFileSync(0, "utf8"),
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await context.addCookies(
    Object.entries(cookies).map(([name, value]) => ({
      name,
      value,
      url: origin,
      httpOnly: name !== "fpl_csrf",
      sameSite: "Lax",
    })),
  );
  const page = await context.newPage();
  const response = await page.goto(origin + "/code-agents");
  assert.equal(response.status(), 200);
  assert.equal(response.headers()["x-application-build"], build);
  const codex = page.getByRole("article", { name: "Codex 连接" });
  await codex.getByRole("button", { name: "启用 CLI 连接" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("FPL 管理员密码").fill(password);
  const enabled = page.waitForResponse(
    (result) =>
      result.request().method() === "POST" &&
      result.url().endsWith("/v1/code-agents/codex/enable"),
  );
  await dialog.getByRole("button", { name: "启用连接", exact: true }).click();
  assert.equal((await enabled).status(), 204);
  const connected = codex.locator(".code-agent-status.is-ok");
  await connected.waitFor();
  assert.equal((await connected.textContent()).trim(), "已连接");
  await codex.getByRole("button", { name: "连接详情" }).click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.getByRole("button", { name: "重新检测" }).click();
  await page.getByText("连接状态已更新", { exact: true }).waitFor();
  console.log(
    "Chromium verified local reauthentication, CLI enablement and responsive detection",
  );
} finally {
  await browser.close();
}
