import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
if (!args.includes("--base-url") || !args.includes("--output-dir"))
  throw Error(
    "需要 --base-url 与 --output-dir；不会使用默认项目或覆盖正式资产。",
  );
const base = new URL(option("--base-url"));
if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
  throw Error("请使用本机隔离演示服务");
const output = resolve(option("--output-dir"));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    reducedMotion: "reduce",
  });
  await page.goto(new URL("/docs.html?page=overview", base).href);
  await page.getByRole("heading", { name: "欢迎使用未来道具研究所" }).waitFor();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  for (const [id, name] of [
    ["overview", "home-dark"],
    ["providers", "module-dark"],
    ["annotation-json", "tool-dark"],
    ["visual-quickstart", "application-dark"],
  ]) {
    await page.goto(new URL("/docs.html?page=" + id, base).href);
    await page.locator(".docs-prose h1").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page
      .locator(".docs-prose img")
      .evaluateAll((images) =>
        Promise.all(
          images.map((image) => image.decode().catch(() => undefined)),
        ),
      );
    await page.screenshot({ path: resolve(output, name + ".png") });
  }
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await page.screenshot({ path: resolve(output, "application-light.png") });
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开功能目录" }).click();
  await expect(page.locator(".docs-sidebar")).toHaveCSS(
    "transform",
    "matrix(1, 0, 0, 1, 0, 0)",
  );
  await page.screenshot({ path: resolve(output, "mobile-drawer.png") });
  console.log("文档阅读界面验收截图：" + output);
} finally {
  await browser.close();
}
