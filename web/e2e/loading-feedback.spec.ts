import { statSync } from "node:fs";
import { resolve } from "node:path";
import { imageVariants } from "../src/shared/lib/imageVariants";
import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`application loading and small icons on a slow connection: ${theme}`, async ({
    page,
    context,
  }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({
      width: theme === "light" ? 1280 : 390,
      height: 900,
    });
    await page.addInitScript(
      (value) => localStorage.setItem("future_props_theme", value),
      theme,
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    let release!: () => void;
    let requested!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loading = new Promise<void>((resolve) => {
      requested = resolve;
    });
    await page.route(
      "**/src/features/applications/ApplicationCenterPage.tsx",
      async (route) => {
        requested();
        await gate;
        await route.continue();
      },
    );
    const imageRequests: string[] = [];
    const received: Array<Promise<{ url: string; bytes: number }>> = [];
    page.on("request", (request) => {
      if (request.resourceType() === "image") imageRequests.push(request.url());
    });
    page.on("response", (response) => {
      if (response.url().includes("/brand/thumbnails/"))
        received.push(
          response
            .body()
            .then((body) => ({ url: response.url(), bytes: body.length })),
        );
    });
    await page.goto("/apps", { waitUntil: "domcontentloaded" });
    await loading;
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 80,
      downloadThroughput: 150_000,
      uploadThroughput: 80_000,
    });
    try {
      await expect(page.locator(".studio-sidebar")).toBeVisible({
        timeout: 60_000,
      });
      await expect(
        page.getByRole("progressbar", { name: "正在加载…", exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: info.outputPath(`loading-${theme}.png`) });
    } finally {
      release();
    }
    await expect(
      page.getByRole("heading", { name: "应用", exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".application-icon img").first()).toBeVisible();
    await page.waitForFunction(() =>
      Array.from(
        document.querySelectorAll<HTMLImageElement>(".application-icon img"),
      )
        .filter((img) => img.getBoundingClientRect().top < innerHeight)
        .every((img) => img.complete && img.naturalWidth > 0),
    );
    const sources = await page
      .locator(".application-icon img")
      .evaluateAll((images) =>
        images.map((img) => (img as HTMLImageElement).currentSrc),
      );
    expect(
      sources.every(
        (source) => source.includes("/brand/thumbnails/") || source === "",
      ),
    ).toBe(true);
    expect(
      imageRequests.filter((url) => /\/brand\/[^/]+\.png(?:\?|$)/.test(url)),
    ).toEqual([]);
    const downloads = await Promise.all(received);
    const sizes = downloads.map((download) => download.bytes);
    const originals = new Set(
      downloads.flatMap((download) =>
        Object.entries(imageVariants)
          .filter(([, variants]) =>
            Object.values(variants).includes(new URL(download.url).pathname),
          )
          .map(([source]) => source),
      ),
    );
    const originalBytes = [...originals].reduce(
      (sum, source) => sum + statSync(resolve("public", source.slice(1))).size,
      0,
    );
    const loadedBytes = sizes.reduce((a, b) => a + b, 0);
    expect(loadedBytes).toBeLessThan(originalBytes * 0.1);
    await info.attach("icon-transfer", {
      body: JSON.stringify({
        originalBytes,
        loadedBytes,
        reductionPercent: (1 - loadedBytes / originalBytes) * 100,
      }),
      contentType: "application/json",
    });
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.max(...sizes)).toBeLessThan(30 * 1024);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThan(300 * 1024);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`applications-${theme}.png`),
      fullPage: true,
    });
  });
}
