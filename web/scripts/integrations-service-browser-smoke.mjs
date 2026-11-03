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
  throw new Error("Integrations acceptance requires isolated loopback origin");
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
  await context.addCookies(options.cookies);
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  for (const [route, tab] of [
    ["tool-apis", "工具 API"],
    ["mcp", "MCP"],
    ["skills", "Skill"],
    ["external-connections", "外部连接"],
  ]) {
    await page.goto(new URL("/integrations/" + route, origin).href);
    await expect(
      page.getByRole("heading", { name: "集成中心", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: tab, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
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
            `Integrations document overflow: ${route}/${width}/${theme}`,
          );
        await page.getByRole("tab", { name: tab, exact: true }).focus();
        await expect(
          page.getByRole("tab", { name: tab, exact: true }),
        ).toBeFocused();
        await page.screenshot({
          path: path.join(output, `${route}-${width}-${theme}.png`),
        });
      }
    }
  }
  if (!(await page.content()).includes("/_apps/integrations/"))
    throw new Error("Integrations uses a foreign program bundle");
  expect(errors).toEqual([]);
  console.log(
    "Integrations independent pages, tabs and responsive themes verified",
  );
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, "failure.png") });
  throw error;
} finally {
  await browser.close();
}
