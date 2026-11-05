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
  throw new Error("Browser acceptance must use an isolated loopback origin");
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
const checks = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", async (dialog) => {
    errors.push("Unexpected native dialog: " + dialog.type());
    await dialog.dismiss();
  });
  await page.goto(new URL("/agents", origin).href);
  await page
    .getByRole("textbox", { name: "用户名", exact: true })
    .fill(options.username);
  await page.getByLabel("密码", { exact: true }).fill(options.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Agent 工作台" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /isolated original/ }).first(),
  ).toBeVisible();
  checks.push(
    "fresh browser login and native session list work without Portal",
  );
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
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth + 1,
      );
      if (overflow)
        throw new Error(
          "Horizontal document overflow at " + width + " / " + theme,
        );
      await page.screenshot({
        path: path.join(output, "agents-" + width + "-" + theme + ".png"),
        fullPage: true,
      });
    }
  }
  await page.goto(new URL("/agents/sources", origin).href);
  await expect(
    page.getByRole("heading", { name: "连接本机会话来源", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Isolated native source", { exact: true }).first(),
  ).toBeVisible();
  checks.push(
    "source management, themes and mobile/tablet/desktop layouts render independently",
  );
  await page.getByLabel("来源名称", { exact: true }).fill("unsaved fixture");
  const sessionsTab = page
    .getByRole("navigation", { name: "工作台导航" })
    .getByRole("button", { name: "会话", exact: true });
  await sessionsTab.click();
  await expect(
    page.getByRole("alertdialog", { name: "离开来源设置？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "留在此页", exact: true }).click();
  await expect(page.getByLabel("来源名称", { exact: true })).toHaveValue(
    "unsaved fixture",
  );
  await sessionsTab.click();
  await page
    .getByRole("button", { name: "放弃填写并继续", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Agent 工作台" }),
  ).toBeVisible();
  await expect(page).toHaveURL(new URL("/agents", origin).href);
  checks.push(
    "unsaved source settings require confirmation before leaving the application",
  );
  const missing = await page.request.get(
    new URL("/_apps/agents/does-not-exist/assets/missing.js", origin).href,
  );
  if (missing.status() !== 404)
    throw new Error("Missing program resource did not return 404");
  if (errors.length) throw new Error("Browser errors: " + errors.join("; "));
  await context.close();
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify({ status: "passed", checks }, null, 2) + "\n",
  );
  console.log(JSON.stringify({ status: "passed", checks }));
} finally {
  await browser.close();
}
