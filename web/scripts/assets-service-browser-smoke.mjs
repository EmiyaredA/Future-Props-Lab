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
  origin.pathname !== "/"
)
  throw new Error("Assets acceptance must use an isolated loopback origin");
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
try {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/files", origin).href);
  await page
    .getByRole("textbox", { name: "用户名", exact: true })
    .fill(options.username);
  await page.getByLabel("密码", { exact: true }).fill(options.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page
      .getByRole("main")
      .getByRole("button", { name: "文件管理", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".studio-sidebar").getByRole("button", { name: "文件管理" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByText("container-fixture", { exact: true }).first(),
  ).toBeVisible();
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
        throw new Error("Assets document overflow: " + width + " / " + theme);
      if (width === 390) {
        const controls = await page
          .locator(".file-primary-actions button")
          .evaluateAll((buttons) =>
            buttons.map((button) => {
              const rows = new Set();
              for (const node of button.childNodes) {
                if (
                  node.nodeType !== Node.TEXT_NODE ||
                  !node.textContent.trim()
                )
                  continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                for (const rect of range.getClientRects())
                  rows.add(Math.round(rect.top));
              }
              return {
                label: button.textContent.trim(),
                lines: rows.size,
                height: button.getBoundingClientRect().height,
              };
            }),
          );
        if (
          controls.some((control) => control.lines > 1 || control.height < 44)
        )
          throw new Error(
            "Mobile file controls must keep readable one-line labels and 44px targets: " +
              JSON.stringify(controls),
          );
      }
      await page.screenshot({
        path: path.join(output, "files-" + width + "-" + theme + ".png"),
        fullPage: true,
      });
    }
  }
  await page
    .getByRole("textbox", { name: "搜索文件或文件夹" })
    .fill("container-fixture");
  await expect(
    page.getByText("container-fixture", { exact: true }).first(),
  ).toBeVisible();
  const program = await page
    .locator("script[type='module']")
    .getAttribute("src");
  if (!program?.startsWith("/_apps/assets/"))
    throw new Error("Files page loaded another service program");
  const missing = new URL(program, origin);
  missing.pathname =
    missing.pathname.slice(0, missing.pathname.lastIndexOf("/")) +
    "/missing.js";
  if ((await page.request.get(missing.href)).status() !== 404)
    throw new Error("Missing resource was not 404");
  const immutable = await page.request.get(new URL(program, origin).href);
  if (!immutable.headers()["cache-control"]?.includes("immutable"))
    throw new Error("Program cache is not version-bound");
  if (errors.length) throw new Error(errors.join("; "));
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(
      { status: "passed", widths: [390, 768, 1600], themes: ["light", "dark"] },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Assets browser passed: embedded login, owned files, search, immutable program and responsive themes",
  );
  await context.close();
} finally {
  await browser.close();
}
