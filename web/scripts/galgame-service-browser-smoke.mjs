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
  const root = origin + "/apps/galgame-workshop";

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

  const base = `/projects/${project}`;
  await visit("", 390, page.getByRole("heading", { name: "Compose Galgame" }));
  await visit(
    base + "/overview",
    390,
    page.getByText("线路就绪", { exact: true }),
  );
  for (const width of [390, 768, 1440]) {
    await visit(
      base + "/editor",
      width,
      page.getByRole("navigation", { name: "创作工作区" }),
    );
  }
  await visit(base + "/preview", 768, page.locator(".galgame-fast-preview"));
  await page.getByText(/预演服务器已保存版本/).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Chromium verified Galgame project, overview, editor and saved-story preview",
  );
} finally {
  await browser.close();
}
