import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

(async () => {
  const { origin, cookies, build } = JSON.parse(readFileSync(0, "utf8"));
  const browser = await chromium.launch({ channel: "chrome", headless: true });
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
    const response = await page.goto(origin + "/tools");
    assert.equal(response.status(), 200);
    assert.equal(response.headers()["x-application-build"], build);
    await page.getByRole("heading", { name: "工具导航" }).waitFor();
    const save = page.waitForResponse(
      (result) =>
        result.request().method() === "PATCH" &&
        result.url().endsWith("/v1/tool-navigation/tools/video-frame-exporter"),
    );
    await page
      .getByRole("button", { name: "收藏视频帧导出", exact: true })
      .click();
    assert.equal((await save).status(), 200);
    await page.getByRole("button", { name: "取消收藏视频帧导出" }).waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
      true,
    );
    const frame = await page.goto(origin + "/tools/video-frame-exporter");
    assert.equal(frame.status(), 200);
    await page.getByRole("heading", { name: "视频帧导出" }).waitFor();
    const downloader = await page.goto(origin + "/tools/video-downloader/");
    assert.equal(downloader.status(), 200);
    await page.getByRole("heading", { name: /视频下载/ }).waitFor();
    assert.equal(
      (await page.request.get(origin + "/tools/unknown")).status(),
      404,
    );
    console.log(
      "Chromium: signed-in tools, responsive catalog, persisted favorite and both deep links passed",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
