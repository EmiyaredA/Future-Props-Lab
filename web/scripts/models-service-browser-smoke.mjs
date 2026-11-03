import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const options = JSON.parse(input);
const origin = new URL(options.origin);
if (
  origin.protocol !== "http:" ||
  origin.hostname !== "127.0.0.1" ||
  !origin.port ||
  ["3000", "9000", "9001"].includes(origin.port) ||
  origin.pathname !== "/"
)
  throw new Error("Models acceptance must use an isolated loopback origin");
const output = path.resolve(options.output);
execFileSync("git", ["check-ignore", "--quiet", output], { cwd: options.repo });
fs.mkdirSync(output, { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(
  options.repo,
  ".local/playwright-browsers",
);
const { chromium, expect } = await import("@playwright/test");
const browser = await chromium.launch({ headless: true });
const errors = [];
let page;
try {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/model-service", origin).href);
  await page
    .getByRole("textbox", { name: "用户名", exact: true })
    .fill(options.username);
  await page.getByLabel("密码", { exact: true }).fill(options.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "模型服务", exact: true }),
  ).toBeVisible();
  for (const [route, link, heading] of [
    ["model-service", "模型目录", "模型服务"],
    ["model-test", "模型测试", "模型测试"],
    ["model-call-logs", "调用日志", "模型调用日志"],
  ]) {
    await page
      .getByRole("navigation", { name: "模型服务页面" })
      .getByRole("link", { name: link, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "模型服务页面" })
        .locator('a[aria-current="page"]'),
    ).toHaveText(link);
    for (const width of [390, 768, 1600]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"]) {
        await page
          .getByRole("button", {
            name: theme === "light" ? "浅色" : "深色",
            exact: true,
          })
          .click();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        if (
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth + 1,
          )
        )
          throw new Error(
            `Models document overflow: ${route} / ${width} / ${theme}`,
          );
        if (route === "model-test" && width <= 1200) {
          const grid = await page.locator(".playground-grid").boundingBox();
          const chat = await page.locator(".chat-panel").boundingBox();
          if (!grid || !chat || Math.abs(chat.width - grid.width) > 1)
            throw new Error(
              `Chat does not fill its compact grid: ${width} / ${theme}`,
            );
        }
        const selected = page
          .getByRole("navigation", { name: "模型服务页面" })
          .locator('a[aria-current="page"]');
        await selected.focus();
        await expect(selected).toBeFocused();
        if (width === 390 && (await selected.boundingBox()).height < 44)
          throw new Error("Model page navigation has no mobile touch target");
        await page.screenshot({
          path: path.join(output, `${route}-${width}-${theme}.png`),
        });
      }
    }
  }
  const html = await page.content();
  const match = html.match(/\/_apps\/models\/[a-f0-9]{20}\//);
  if (!match) throw new Error("Models page uses a foreign program bundle");
  const missing = await context.request.get(
    new URL(match[0] + "assets/missing.js", origin).href,
  );
  expect(missing.status()).toBe(404);
  expect(errors).toEqual([]);
  console.log(
    "Models browser routes, permissions, owned resources and responsive themes verified",
  );
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(output, "failure.png") });
    fs.writeFileSync(
      path.join(output, "failure.json"),
      JSON.stringify(
        {
          url: page.url(),
          title: await page.title(),
          text: await page.locator("body").innerText(),
          errors,
        },
        null,
        2,
      ),
    );
  }
  throw error;
} finally {
  await browser.close();
}
