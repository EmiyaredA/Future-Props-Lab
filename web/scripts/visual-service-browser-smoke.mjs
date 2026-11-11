import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const { origin, cookies, build, project } = JSON.parse(readFileSync(0, "utf8"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext();
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
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const root = origin + "/apps/visual-workshop";

  async function visit(path, width, locator) {
    await page.setViewportSize({ width, height: 900 });
    const response = await page.goto(root + path);
    assert.equal(response.status(), 200);
    assert.equal(response.headers()["x-application-build"], build);
    await locator.waitFor({ timeout: 15000 });
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    assert.ok(
      overflow <= 1,
      `Unexpected horizontal overflow on ${path} at ${width}px`,
    );
  }

  await visit("", 390, page.getByRole("heading", { name: "Compose Visual" }));
  await visit(
    "/tasks",
    390,
    page.getByText("暂无符合条件的生成任务", { exact: true }),
  );
  await visit(
    `/projects/${project}/assets`,
    768,
    page.getByRole("heading", { name: "项目素材库" }),
  );
  for (const width of [390, 768, 1440]) {
    await visit(
      `/projects/${project}/canvas`,
      width,
      page.getByLabel("节点画布", { exact: true }),
    );
  }
  const saved = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    const canvas = `/v1/visual-workshop/projects/${project}/canvas`;
    return (
      (response.request().method() === "PUT" && path === canvas) ||
      (response.request().method() === "POST" &&
        path === canvas + "/operations")
    );
  });
  await page.getByRole("button", { name: "添加内容" }).click();
  await page.getByRole("menuitem", { name: "添加文本节点" }).click();
  const result = await saved;
  assert.equal(result.status(), 200, await result.text());
  assert.equal(result.request().headers()["x-application-build"], build);
  assert.ok((await result.json()).nodes.some((node) => node.kind === "text"));
  const legacy = await context.request.get(
    origin + `/v1/visual-workshop/projects/${project}/conversations`,
  );
  assert.equal(legacy.status(), 404);
  const oldButton = page.getByRole("button", { name: "对话", exact: true });
  assert.equal(await oldButton.count(), 0);
  await page.getByRole("button", { name: "看板", exact: true }).click();
  assert.equal(await oldButton.count(), 0);
  await page.getByRole("button", { name: "打开 Amadeus", exact: true }).click();
  await page.getByRole("complementary", { name: "Amadeus 助手" }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Chromium verified Visual entries, responsive layout and a saved Canvas edit",
  );
} finally {
  await browser.close();
}
