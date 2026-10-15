import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("saves a spin blur from the library and previews cropped video without proxy borders", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/video-editor");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const created = await page.request.post("/v1/video-editor/projects", {
    headers,
    data: { title: "旋转模糊验收" },
  });
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  const base = `/v1/video-editor/projects/${project.id}`;
  try {
    const fixture = info.outputPath("pattern.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=160x120:rate=10:duration=5",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-y",
      fixture,
    ]);
    const uploaded = await page.request.post(`${base}/assets`, {
      headers,
      multipart: {
        upload: {
          name: "pattern.mp4",
          mimeType: "video/mp4",
          buffer: readFileSync(fixture),
        },
      },
    });
    expect(uploaded.ok()).toBeTruthy();
    const asset = await uploaded.json();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`${base}/assets`)).json()).items.find(
            (item: { id: string }) => item.id === asset.id,
          )?.processingStatus,
        { timeout: 30_000 },
      )
      .toBe("ready");
    const timeline = await (await page.request.get(`${base}/timeline`)).json();
    const trackId = timeline.document.tracks.find(
      (item: { kind: string }) => item.kind === "visual",
    ).id;
    const seeded = await page.request.post(`${base}/timeline/operations`, {
      headers,
      data: {
        expectedRevision: timeline.revision,
        requestId: crypto.randomUUID(),
        operations: ["a", "b"].map((id, index) => ({
          type: "addClip",
          clip: {
            id,
            trackId,
            name: id,
            kind: "video",
            assetId: asset.id,
            timelineStartUs: index * 2_000_000,
            durationUs: 2_000_000,
            sourceInUs: index * 2_000_000,
          },
        })),
      },
    });
    expect(seeded.ok()).toBeTruthy();
    await page.goto(`/apps/video-editor/projects/${project.id}/editor`);
    await page
      .getByRole("button", { name: "添加片段之间转场", exact: true })
      .click();
    await page.getByRole("tab", { name: "模糊", exact: true }).click();
    const effect = page.getByRole("button", { name: "旋转模糊", exact: true });
    await effect.focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("button", { name: "应用到片段之间", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`${base}/timeline`)).json()).document
            .transitions[0]?.kind,
      )
      .toBe("spin-blur");
    await page.reload();
    await expect(page.locator('[data-clip-id="a"]')).toBeVisible();
    const precise = page.getByRole("button", { name: "精确停帧", exact: true });
    if ((await precise.getAttribute("class"))?.split(" ").includes("active"))
      await precise.click();
    const a = (await page.locator('[data-clip-id="a"]').boundingBox())!;
    const b = (await page.locator('[data-clip-id="b"]').boundingBox())!;
    const ruler = page.locator(".ve-ruler");
    const bounds = (await ruler.boundingBox())!;
    await ruler.click({ position: { x: b.x - bounds.x, y: 10 } });
    expect(b.x).toBeGreaterThan(a.x);
    const surfaces = page.locator(".ve-stage canvas.ve-keyed-media");
    await expect(surfaces).toHaveCount(2);
    for (const surface of await surfaces.all()) {
      await expect
        .poll(async () =>
          surface.evaluate((node) => {
            const canvas = node as HTMLCanvasElement;
            if (!canvas.width || !canvas.height) return false;
            const context = canvas.getContext("2d")!;
            const corners = [
              [0, 0],
              [canvas.width - 1, 0],
              [0, canvas.height - 1],
              [canvas.width - 1, canvas.height - 1],
            ];
            return (
              Math.abs(canvas.width / canvas.height - 4 / 3) < 0.01 &&
              corners.every(
                ([x, y]) => context.getImageData(x, y, 1, 1).data[3] >= 250,
              )
            );
          }),
        )
        .toBeTruthy();
    }
    await page
      .locator(".ve-stage")
      .screenshot({ path: info.outputPath("spin-preview.png") });
    await precise.click();
    await expect(page.getByAltText("后端精确停帧")).toBeVisible();
    await page
      .locator(".ve-stage")
      .screenshot({ path: info.outputPath("spin-precise.png") });
  } finally {
    const latest = await (await page.request.get(base)).json();
    expect(
      (
        await page.request.delete(
          `${base}?expected_revision=${latest.revision}`,
          { headers },
        )
      ).ok(),
    ).toBeTruthy();
  }
});
