import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const options = JSON.parse(input);
const origin = new URL(options.origin);
if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || !origin.port || origin.pathname !== "/")
  throw new Error("Portal acceptance must use an isolated loopback origin");
const output = path.resolve(options.output);
execFileSync("git", ["check-ignore", "--quiet", output], { cwd: options.repo });
fs.mkdirSync(output, { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(options.repo, ".local/playwright-browsers");
const { chromium, expect } = await import("@playwright/test");
const browser = await chromium.launch({ headless: true });
const errors = [];
const checks = [];
try {
  const context = await browser.newContext({viewport: {width: 1600, height: 1000}, reducedMotion: "reduce"});
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin.href);
  await page.getByRole("textbox", {name: "用户名", exact: true}).fill(options.username);
  await page.getByLabel("密码", {exact: true}).fill(options.password);
  await page.getByRole("button", {name: "登录", exact: true}).click();
  await expect(page.getByRole("heading", {name: "今天想从哪里开始？"})).toBeVisible();
  for (const section of ["home", "apps"]) {
    await page.goto(new URL(section === "home" ? "/" : "/apps", origin).href);
    await expect(page.getByRole("heading", {name: section === "home" ? "今天想从哪里开始？" : "应用", exact: true})).toBeVisible();
    if (section === "apps" && options.checkUndeployedApplication) {
      const status = page.getByRole("button", {name: "查看演示工坊服务状态：未部署", exact: true});
      await expect(status).toBeVisible({timeout: 15000});
      await status.focus();
      await page.keyboard.press("Enter");
      const details = page.getByRole("region", {name: "演示工坊服务状态", exact: true});
      await expect(details).toContainText("此服务尚未部署");
      await expect(details).toContainText("最近检查");
      await expect(page).toHaveURL(new URL("/apps", origin).href);
      checks.push("an undeployed application's observed status expands by keyboard without navigating the card");
    }
    for (const width of [390, 768, 1600]) {
      await page.setViewportSize({width, height: 1000});
      for (const theme of ["light", "dark"]) {
        await page.getByRole("button", {name: theme === "light" ? "浅色" : "深色", exact: true}).click();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1))
          throw new Error("Portal document overflow: " + section + " / " + width);
        await page.screenshot({path: path.join(output, section + "-" + width + "-" + theme + ".png"), fullPage: true});
      }
    }
  }
  await page.getByRole("link", {name: "云控", exact: true}).click();
  await expect(page).toHaveURL(new URL("/cloud-control", origin).href);
  await expect(page.getByRole("heading", {name: "云控", exact: true})).toBeVisible();
  await page.goto(new URL("/agents", origin).href);
  await expect(page.getByRole("region", {name: "Agent 工作台"})).toBeVisible();
  checks.push("portal login, homepage, application catalogue, Cloud Control link and shared-session Agents entry");
  await page.goto(new URL("/docs.html", origin).href);
  await expect(page.locator(".docs-shell")).toBeVisible();
  await expect(page.locator("h1").first()).toBeVisible();
  for (const width of [390, 768, 1600]) {
    await page.setViewportSize({width, height: 1000});
    if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1))
      throw new Error("Documentation document overflow: " + width);
    await page.screenshot({path: path.join(output, "docs-" + width + ".png"), fullPage: true});
  }
  const screenshot = await page.request.get(new URL("/docs/files-library.jpg", origin).href);
  if (screenshot.status() !== 200 || !screenshot.url().includes("/_apps/portal/"))
    throw new Error("Documentation screenshot must resolve to a verified portal program resource");
  const missing = await page.request.get(new URL("/docs/missing-file.jpg", origin).href);
  if (missing.status() !== 404) throw new Error("Missing documentation resource did not return 404");
  const developer = await page.request.get(new URL("/v1/account/developer-documents", origin).href);
  if (developer.status() !== 200 || !developer.headers()["cache-control"].includes("no-store"))
    throw new Error("Authorized developer documents are unavailable or cacheable");
  checks.push("protected documentation is reused intact, with owned versioned assets and authorized developer references");
  if (errors.length) throw new Error(errors.join("; "));
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify({status: "passed", checks}, null, 2) + "\n");
  console.log(JSON.stringify({status: "passed", checks}));
  await context.close();
} finally {
  await browser.close();
}
