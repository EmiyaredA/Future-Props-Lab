import { expect, test } from "@playwright/test";
import { readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const entries = readdirSync(resolve(import.meta.dirname, "..")).filter((name) =>
  name.endsWith(".html"),
);

async function framePixel(data: string) {
  const image = new Image();
  image.src = "data:image/png;base64," + data;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);
  return Array.from(
    context.getImageData(image.width - 2, image.height - 2, 1, 1).data,
  );
}

for (const scenario of [
  {
    saved: "dark",
    system: "light",
    expected: "dark",
    background: "rgb(18, 20, 19)",
  },
  {
    saved: "light",
    system: "dark",
    expected: "light",
    background: "rgb(247, 244, 239)",
  },
  {
    saved: null,
    system: "dark",
    expected: "dark",
    background: "rgb(18, 20, 19)",
  },
] as const) {
  test(`所有 HTML 首屏在脚本和样式不可用时遵守主题 ${scenario.saved ?? "system"}/${scenario.system}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: scenario.system });
    await page.addInitScript((saved) => {
      if (saved === null) localStorage.removeItem("future_props_theme");
      else localStorage.setItem("future_props_theme", saved);
    }, scenario.saved);
    await page.route("**/*", (route) =>
      ["script", "stylesheet"].includes(route.request().resourceType())
        ? route.abort()
        : route.continue(),
    );
    for (const entry of entries) {
      await page.goto("/" + entry);
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        scenario.expected,
      );
      await expect(page.locator("html")).toHaveCSS(
        "background-color",
        scenario.background,
      );
      await expect(page.locator("html")).toHaveCSS(
        "color-scheme",
        scenario.expected,
      );
      expect(
        await page.evaluate(() => localStorage.getItem("future_props_theme")),
      ).toBe(scenario.saved);
      if (scenario.saved === "dark" && entry === "visual.html")
        await page.screenshot({
          path: info.outputPath("dark-before-react.png"),
        });
    }
  });
}

test("从暗色应用目录进入工坊的实际渲染帧不闪白", async ({
  page,
  baseURL,
}, info) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.route(/\/apps(?:\/visual-workshop)?$/, async (route) => {
    if (!route.request().isNavigationRequest()) return route.fallback();
    const service =
      new URL(route.request().url()).pathname === "/apps" ? "portal" : "visual";
    const response = await route.fetch({
      url: new URL(service + ".html", baseURL).href,
    });
    await route.fulfill({ response });
  });
  await page.goto("/apps");
  await expect(
    page.getByRole("heading", { name: "应用", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // Capture compositor frames, including document replacement, before React/CSS can repair it.
  const cdp = await page.context().newCDPSession(page);
  const frames: string[] = [];
  cdp.on("Page.screencastFrame", (frame) => {
    frames.push(frame.data);
    void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
  });
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  await expect.poll(() => frames.length).toBeGreaterThan(0);
  const destinationDocument = page.waitForRequest(
    (request) =>
      request.isNavigationRequest() &&
      new URL(request.url()).pathname === "/apps/visual-workshop",
  );
  await page.route("**/*", (route) =>
    ["script", "stylesheet"].includes(route.request().resourceType())
      ? route.abort()
      : route.fallback(),
  );
  await page
    .getByRole("button", { name: "打开视觉创作工坊", exact: true })
    .click({ noWaitAfter: true });
  await destinationDocument;
  await page.waitForURL(/\/apps\/visual-workshop$/);
  await expect(page.locator("#fpl-initial-theme")).toHaveCount(1);
  await expect(page.locator("html")).toHaveCSS(
    "background-color",
    "rgb(18, 20, 19)",
  );
  await page.screenshot({
    path: info.outputPath("destination-before-react.png"),
  });
  // Require the actual destination canvas, not just source hover repaints.
  await expect
    .poll(() => page.evaluate(framePixel, frames[frames.length - 1]))
    .toEqual([18, 20, 19, 255]);
  await cdp.send("Page.stopScreencast");
  const pixels = await Promise.all(
    frames.map((data) => page.evaluate(framePixel, data)),
  );
  for (const [index, pixel] of pixels.entries()) {
    expect(
      Math.max(...pixel.slice(0, 3)),
      `frame ${index}: ${pixel}`,
    ).toBeLessThan(150);
    await writeFile(
      info.outputPath(`navigation-frame-${index}.png`),
      Buffer.from(frames[index], "base64"),
    );
  }
});
