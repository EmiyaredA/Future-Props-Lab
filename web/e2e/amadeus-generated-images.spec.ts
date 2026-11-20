import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { RunDetail } from "../src/features/amadeus/protocol";

test("Codex images reopen, download and fit the conversation at every width", async ({
  page,
}, testInfo) => {
  const identity = "11111111-1111-4111-8111-111111111111";
  const at = new Date().toISOString();
  const conversation = {
    id: identity,
    title: "Codex 生图验收",
    agent_id: "codex",
    executor_kind: "code-agent",
    model_id: null,
    revision: 1,
    created_at: at,
    updated_at: at,
  };
  const live = process.env.FPL_CODEX_IMAGE_FIXTURE_REPORT
    ? (JSON.parse(
        readFileSync(process.env.FPL_CODEX_IMAGE_FIXTURE_REPORT, "utf8"),
      ) as {
        image: { bytes: number; sha256: string; width: number; height: number };
        path: string;
      })
    : null;
  const image = {
    kind: "outputs" as const,
    name: "codex-111-abc.png",
    bytes: 68,
    sha256: "a".repeat(64),
    mime_type: "image/png" as const,
    width: 1,
    height: 1,
    ...live?.image,
  };
  const png = live
    ? readFileSync(live.path)
    : Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
        "base64",
      );
  const record: RunDetail = {
    run: {
      id: "image-run",
      conversation_id: identity,
      agent_id: "codex",
      codex_image_generation: false,
      model_id: "",
      status: "completed",
      partial_text: "图片已保存。",
      created_at: at,
    },
    events: [
      {
        sequence: 1,
        kind: "image_generation",
        payload: { item_id: "image", status: "started" },
        created_at: at,
      },
      {
        sequence: 2,
        kind: "image_generation",
        payload: { item_id: "image", status: "completed", image },
        created_at: at,
      },
      {
        sequence: 3,
        kind: "assistant_delta",
        payload: { text: "图片已保存。" },
        created_at: at,
      },
    ],
  };
  await page.route("**/v1/code-agents", (route) =>
    route.fulfill({
      json: {
        items: [{ id: "codex", name: "Codex", available: true, models: [] }],
      },
    }),
  );
  await page.route(/\/v1\/amadeus\/conversations(?:\/.*)?$/, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(`/files/outputs/${image.name}`))
      return route.fulfill({ body: png, contentType: "image/png" });
    if (path.endsWith("/runs")) return route.fulfill({ json: [record] });
    if (path === "/v1/amadeus/conversations")
      return route.fulfill({ json: { items: [conversation] } });
    if (path.endsWith(identity))
      return route.fulfill({
        json: {
          conversation,
          actions: [],
          questions: [],
          messages: [
            {
              id: "assistant",
              role: "assistant",
              content: "图片已保存。",
              references: [],
              run_id: "image-run",
              created_at: at,
            },
          ],
        },
      });
    return route.continue();
  });
  await page.goto(`/amadeus?conversation=${identity}`);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const preview = page.locator(".amadeus-generated-preview");
    await expect(preview.locator("img")).toHaveJSProperty(
      "naturalWidth",
      image.width,
    );
    const bounds = (await preview.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await preview.press("Enter");
    await expect(page.getByRole("dialog", { name: "生成图片" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(preview).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath(`generated-${width}.png`),
    });
  }
  const downloading = page.waitForEvent("download");
  await page
    .locator(".amadeus-generated-image")
    .getByRole("link", { name: "下载原图" })
    .click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(image.name);
  expect(readFileSync((await download.path())!)).toEqual(png);
  await page.reload();
  await expect(page.locator(".amadeus-generated-image img")).toHaveJSProperty(
    "naturalWidth",
    image.width,
  );
  await page.getByRole("button", { name: "运行设置" }).click();
  const toggle = page.getByRole("switch", { name: "Codex 生图" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({ path: testInfo.outputPath("generated-dark.png") });
});
