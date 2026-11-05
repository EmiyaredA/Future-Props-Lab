import { statSync } from "node:fs";
import { resolve } from "node:path";
import { imageVariants } from "../src/shared/lib/imageVariants";
import { expect, test, type Response } from "@playwright/test";

test("file loading art, label and progress dots share a center line", async ({
  page,
}, info) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/v1\/files(?:\?.*)?$/, async (route) => {
    await gate;
    await route.continue();
  });
  await page.addInitScript(() =>
    localStorage.setItem("future_props_theme", "dark"),
  );
  try {
    await page.goto("/files", { waitUntil: "domcontentloaded" });
    const loading = page.getByRole("status").filter({
      hasText: "正在读取文件…",
    });
    const label = loading.getByText("正在读取文件…", { exact: true });
    await expect(label).toBeVisible();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const centerX = async (locator: typeof loading) => {
        const box = (await locator.boundingBox())!;
        return box.x + box.width / 2;
      };
      const center = await centerX(loading);
      for (const item of [
        loading.locator(".fpl-loading-scene"),
        label,
        loading.getByRole("progressbar"),
      ]) {
        expect(Math.abs((await centerX(item)) - center)).toBeLessThan(1);
      }
    }
    await loading.screenshot({
      path: info.outputPath("file-loading-centered.png"),
    });
  } finally {
    release();
  }
});

test("startup loading covers the viewport through each handoff", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.addInitScript(() =>
    localStorage.setItem("future_props_theme", "dark"),
  );
  await page.setViewportSize({ width: 1920, height: 1071 });

  const phases = [
    [
      /\/src\/app\/entries\/website\.tsx(?:\?.*)?$/,
      "正在打开 Future Props Lab…",
    ],
    [/\/v1\/auth\/me$/, "正在连接 Future Props Lab…"],
    [/\/src\/app\/SignedInApp\.tsx(?:\?.*)?$/, "正在打开工作台…"],
  ] as const;
  const releases: Array<() => void> = [];
  for (const [url] of phases) {
    const gate = new Promise<void>((resolve) => releases.push(resolve));
    await page.route(url, async (route) => {
      await gate;
      await route.continue();
    });
  }

  try {
    await page.goto("/apps", { waitUntil: "domcontentloaded" });
    for (const [index, [, label]] of phases.entries()) {
      const loading = page.getByRole("status").filter({ hasText: label });
      await expect(loading.getByText(label, { exact: true })).toBeVisible({
        timeout: 25_000,
      });
      for (const viewport of [
        { width: 1920, height: 1071 },
        { width: 390, height: 844 },
        { width: 740, height: 360 },
      ]) {
        await page.setViewportSize(viewport);
        expect(await loading.boundingBox()).toEqual({
          x: 0,
          y: 0,
          ...viewport,
        });
        expect(
          await loading.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const scene = element.firstElementChild!.getBoundingClientRect();
            const copy = element.lastElementChild!.getBoundingClientRect();
            return Math.abs(
              (scene.top + copy.bottom) / 2 - (bounds.top + bounds.bottom) / 2,
            );
          }),
        ).toBeLessThan(1);
      }
      releases[index]();
    }
    await expect(page.locator(".studio-sidebar")).toBeVisible();
    await expect(page.locator(".fpl-loading--fullscreen")).toHaveCount(0);
  } finally {
    releases.forEach((release) => release());
  }
});

test("an editor waiting for its document fills the available page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1071 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/v1/presentation-workshop/projects/loading-test",
    async (route) => {
      await gate;
      await route.fulfill({ status: 404, json: { detail: "Not found" } });
    },
  );
  try {
    await page.goto("/apps/presentation-workshop/projects/loading-test");
    const loading = page.getByRole("status").filter({
      hasText: "正在打开演示文稿…",
    });
    await expect(loading).toBeVisible();
    expect(await loading.boundingBox()).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1071,
    });
  } finally {
    release();
  }
  await expect(
    page.getByRole("alert").filter({ hasText: "文稿加载失败" }),
  ).toBeVisible();
});

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
    const received: Response[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "image") imageRequests.push(request.url());
    });
    page.on("response", (response) => {
      if (response.url().includes("/brand/thumbnails/"))
        received.push(response);
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
      const panel = page.locator(".studio-main");
      expect(await panel.locator(".fpl-loading--page").boundingBox()).toEqual(
        await panel.evaluate((element) => {
          const { x, y } = element.getBoundingClientRect();
          return {
            x: x + element.clientLeft,
            y: y + element.clientTop,
            width: element.clientWidth,
            height: element.clientHeight,
          };
        }),
      );
      await expect(page.locator(".fpl-loading-character img")).toBeVisible();
      await expect(page.locator(".fpl-loading-character video")).toHaveCount(0);
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
    const downloads = await Promise.all(
      received.map(async (response) => ({
        url: response.url(),
        bytes: (await response.body()).length,
      })),
    );
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

for (const theme of ["light", "dark"] as const) {
  test(`Kurisu page and region loading: ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({
      width: theme === "light" ? 1280 : 390,
      height: 900,
    });
    await page.addInitScript(
      (value) => localStorage.setItem("future_props_theme", value),
      theme,
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    let releaseModule!: () => void;
    let releaseData!: () => void;
    const moduleGate = new Promise<void>((resolve) => {
      releaseModule = resolve;
    });
    const dataGate = new Promise<void>((resolve) => {
      releaseData = resolve;
    });
    await page.route(
      "**/src/features/creative-workshop/CreativeWorkshopPage.tsx",
      async (route) => {
        await moduleGate;
        await route.continue();
      },
    );
    await page.route("**/v1/creative-workshop/items?*", async (route) => {
      await dataGate;
      await route.fulfill({ json: { items: [], next_cursor: null } });
    });
    try {
      await page.goto("/creative-workshop", { waitUntil: "domcontentloaded" });
      for (const variant of ["page", "region"] as const) {
        const loading = page.locator(`.fpl-loading--${variant}.is-visible`);
        const character = loading.locator(".fpl-loading-character");
        const video = character.locator("video");
        await expect(character).toHaveAttribute("data-playing", "true");
        await expect(video).toBeVisible();
        expect(
          await video.evaluate((element: HTMLVideoElement) => element.duration),
        ).toBeCloseTo(19 / 24, 2);
        expect(
          await character.evaluate(
            (element) => element.getBoundingClientRect().height,
          ),
        ).toBeCloseTo(
          (await loading
            .locator(".fpl-loading-scene")
            .evaluate((element) => element.getBoundingClientRect().width)) *
            0.45,
          1,
        );
        await expect(loading.locator(".fpl-scene-prop")).toHaveCount(8);
        await expect(loading.getByRole("progressbar")).not.toHaveAttribute(
          "aria-valuenow",
        );
        await expect
          .poll(() =>
            video.evaluate(
              (element: HTMLVideoElement) =>
                element.getVideoPlaybackQuality().totalVideoFrames,
            ),
          )
          .toBeGreaterThan(48);
        const transparency = await video.evaluate(
          (element: HTMLVideoElement) => {
            const canvas = document.createElement("canvas");
            canvas.width = element.videoWidth;
            canvas.height = element.videoHeight;
            const context = canvas.getContext("2d")!;
            context.drawImage(element, 0, 0);
            const pixels = context.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            ).data;
            return {
              cornerAlpha: pixels[3],
              hasCharacter: pixels.some(
                (value, index) => index % 4 === 3 && value > 0,
              ),
            };
          },
        );
        expect(transparency).toEqual({ cornerAlpha: 0, hasCharacter: true });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: info.outputPath(`kurisu-${variant}-${theme}.png`),
        });
        if (variant === "page") releaseModule();
      }
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(page.locator(".fpl-loading--region video")).toHaveCount(0);
      await expect(
        page.locator(".fpl-loading--region .fpl-loading-character img"),
      ).toBeVisible();
      releaseData();
      await expect(page.locator(".fpl-loading--region")).toHaveCount(0);
    } finally {
      releaseModule();
      releaseData();
    }
  });
}
