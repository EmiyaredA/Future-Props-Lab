import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const { origin, cookies, build, project } = JSON.parse(readFileSync(0, "utf8"));
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
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
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const index = origin + "/apps/director-desk";
  const list = await page.goto(index);
  assert.equal(list.status(), 200);
  assert.equal(list.headers()["x-application-build"], build);
  await page.getByRole("heading", { name: "Compose Director" }).waitFor();
  const layout = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
    overflowing: Array.from(document.querySelectorAll("main *"))
      .map((element) => ({
        element: element.tagName + "." + (element.getAttribute("class") ?? ""),
        right: Math.round(element.getBoundingClientRect().right),
      }))
      .filter(({ right }) => right > window.innerWidth + 1)
      .slice(0, 12),
  }));
  assert.ok(layout.width <= layout.viewport, JSON.stringify(layout));

  await page.setViewportSize({ width: 1440, height: 900 });
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().endsWith(`/v1/director-desk/projects/${project}`),
  );
  const editor = await page.goto(`${index}/projects/${project}`);
  assert.equal(editor.status(), 200);
  assert.equal(editor.headers()["x-application-build"], build);
  await page.locator("#stage-canvas canvas").waitFor();
  await page
    .locator(".header-actions")
    .getByRole("button", { name: "保存", exact: true })
    .waitFor();
  assert.equal((await saved).status(), 200);
  const logo = page.locator(".director-desk-root img.logo");
  await logo.waitFor();
  await page.waitForFunction(
    () => document.querySelector("img.logo")?.naturalWidth > 0,
  );
  assert.ok(
    (await logo.getAttribute("src")).startsWith(`/_apps/director/${build}/`),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Chromium verified the signed-in mobile list and installed WebGL editor",
  );
} finally {
  await browser.close();
}
