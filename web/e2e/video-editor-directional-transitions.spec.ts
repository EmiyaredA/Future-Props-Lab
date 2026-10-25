import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

for (const effect of [
  { kind: "whip-pan", label: "甩镜模糊", category: "模糊" },
  { kind: "light-leak", label: "漏光扫过", category: "光效" },
]) {
  test(`${effect.label}: library, preview, exact frames and encoded export agree`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/apps/video-editor");
    const csrf = (await page.context().cookies()).find(
      (cookie) => cookie.name === "fpl_csrf",
    )!.value;
    const headers = {
      "X-CSRF-Token": csrf,
      Origin: new URL(page.url()).origin,
    };
    const created = await page.request.post("/v1/video-editor/projects", {
      headers,
      data: { title: `${effect.label}隔离验收` },
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
        "color=c=0x243858:size=320x240:rate=30:duration=4,drawbox=x=140:y=80:w=40:h=80:color=white:t=fill",
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
            (
              await (await page.request.get(`${base}/assets`)).json()
            ).items.find((x: { id: string }) => x.id === asset.id)
              ?.processingStatus,
          { timeout: 30_000 },
        )
        .toBe("ready");
      const before = await (await page.request.get(`${base}/timeline`)).json();
      const trackId = before.document.tracks[0].id;
      const seeded = await page.request.post(`${base}/timeline/operations`, {
        headers,
        data: {
          expectedRevision: before.revision,
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
              sourceInUs: index * 2_000_000,
              durationUs: 2_000_000,
            },
          })),
        },
      });
      expect(seeded.ok()).toBeTruthy();
      await page.goto(`/apps/video-editor/projects/${project.id}/editor`);
      await page
        .getByRole("button", { name: "添加片段之间转场", exact: true })
        .click();
      await page
        .getByRole("tab", { name: effect.category, exact: true })
        .click();
      const button = page.getByRole("button", {
        name: effect.label,
        exact: true,
      });
      await button.focus();
      await page.keyboard.press("Enter");
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await page
        .getByRole("button", { name: "应用到片段之间", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await (await page.request.get(`${base}/timeline`)).json()).document
              .transitions[0]?.kind,
        )
        .toBe(effect.kind);
      for (const theme of ["light", "dark"]) {
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);
        await expect(button).toBeVisible();
        await page
          .locator(".ve-transition-panel")
          .screenshot({ path: info.outputPath(`library-${theme}.png`) });
      }
      const state = await (await page.request.get(`${base}/timeline`)).json();
      const precise = page.getByRole("button", {
        name: "精确停帧",
        exact: true,
      });
      if ((await precise.getAttribute("class"))?.split(" ").includes("active"))
        await precise.click();
      const borders = page.getByRole("button", { name: "边界线", exact: true });
      if ((await borders.getAttribute("class"))?.split(" ").includes("active"))
        await borders.click();
      const a = (await page.locator('[data-clip-id="a"]').boundingBox())!;
      const b = (await page.locator('[data-clip-id="b"]').boundingBox())!;
      const ruler = page.locator(".ve-ruler");
      const rulerBox = (await ruler.boundingBox())!;
      const pixelsPerSecond = (b.x - a.x) / 2;
      for (const [phase, seconds] of [
        ["start", 1.7],
        ["middle", 2],
        ["end", 2.3],
      ] as const) {
        if (phase === "middle") {
          // Clip selection uses the exact seam; the ruler's 33333us grid can land just before it.
          const incoming = page.locator('[data-clip-id="b"] .ve-clip-body');
          await incoming.focus();
          await incoming.press("Enter");
        } else {
          await ruler.click({
            position: {
              x: a.x - rulerBox.x + seconds * pixelsPerSecond,
              y: 10,
            },
          });
        }
        await expect
          .poll(async () =>
            page
              .locator(".ve-stage canvas.ve-keyed-media")
              .first()
              .evaluate((node) => (node as HTMLCanvasElement).width),
          )
          .toBeGreaterThan(0);
        if (phase === "middle" && effect.kind === "whip-pan") {
          for (const surface of await page
            .locator(".ve-stage canvas.ve-keyed-media")
            .all()) {
            await expect
              .poll(async () =>
                surface.evaluate((node) => {
                  const c = node as HTMLCanvasElement,
                    ctx = c.getContext("2d")!;
                  return (
                    c.width / c.height > 1.32 &&
                    c.width / c.height < 1.34 &&
                    [
                      [0, 0],
                      [c.width - 1, c.height - 1],
                    ].every(
                      ([x, y]) => ctx.getImageData(x, y, 1, 1).data[3] >= 250,
                    )
                  );
                }),
              )
              .toBeTruthy();
          }
        }
        if (phase === "middle" && effect.kind === "light-leak")
          await expect(page.locator(".ve-transition-light-leak")).toBeVisible();
        await page
          .locator(".ve-stage")
          .screenshot({ path: info.outputPath(`${phase}-preview.png`) });
        const exact = await page.request.get(
          `${base}/preview/frame?revision=${state.revision}&timeUs=${seconds * 1_000_000}&width=320`,
        );
        expect(exact.ok()).toBeTruthy();
        writeFileSync(
          info.outputPath(`${phase}-exact.png`),
          await exact.body(),
        );
        const previewError = Number(
          execFileSync(
            "uv",
            [
              "run",
              "--no-cache",
              "--no-sync",
              "python",
              "-c",
              "import sys,numpy as np;from PIL import Image;a=Image.open(sys.argv[1]).convert('RGB');b=Image.open(sys.argv[2]).convert('RGB').resize(a.size);x=int(a.width*.08);y=int(a.height*.08);print(np.abs(np.asarray(a,dtype=float)[y:-y,x:-x]-np.asarray(b,dtype=float)[y:-y,x:-x]).mean())",
              info.outputPath(`${phase}-preview.png`),
              info.outputPath(`${phase}-exact.png`),
            ],
            { cwd: ".." },
          ).toString(),
        );
        expect(previewError).toBeLessThan(8);
      }
      await precise.click();
      await expect(page.getByAltText("后端精确停帧")).toBeVisible();
      const range = {
        expectedRevision: state.revision,
        preset: "720p30",
        startUs: 1_700_000,
        endUs: 2_300_000,
      };
      const preflight = await page.request.post(`${base}/renders/preflight`, {
        headers,
        data: range,
      });
      expect(preflight.ok()).toBeTruthy();
      const preview = await preflight.json();
      expect(preview.ready).toBeTruthy();
      const render = await page.request.post(`${base}/renders`, {
        headers,
        data: {
          ...range,
          requestId: crypto.randomUUID(),
          previewFingerprint: preview.fingerprint,
        },
      });
      expect(render.ok()).toBeTruthy();
      const task = await render.json();
      await expect
        .poll(
          async () =>
            (
              await (
                await page.request.get(`${base}/renders/${task.id}`)
              ).json()
            ).status,
          { timeout: 90_000 },
        )
        .toBe("completed");
      const done = await (
        await page.request.get(`${base}/renders/${task.id}`)
      ).json();
      const download = await page.request.get(
        `/v1/files/${done.outputAssetId}/content`,
      );
      expect(download.ok()).toBeTruthy();
      const output = info.outputPath("export.mp4");
      writeFileSync(output, await download.body());
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-i",
        output,
        "-vf",
        "select=eq(n\\,9),scale=320:180",
        "-frames:v",
        "1",
        "-y",
        info.outputPath("middle-export.png"),
      ]);
      const error = Number(
        execFileSync(
          "uv",
          [
            "run",
            "--no-cache",
            "--no-sync",
            "python",
            "-c",
            "import sys,numpy as np;from PIL import Image;a=np.asarray(Image.open(sys.argv[1]).convert('RGB'),dtype=float);b=np.asarray(Image.open(sys.argv[2]).convert('RGB'),dtype=float);print(np.abs(a-b).mean())",
            info.outputPath("middle-exact.png"),
            info.outputPath("middle-export.png"),
          ],
          { cwd: ".." },
        ).toString(),
      );
      expect(error).toBeLessThan(5);
    } finally {
      const latest = await (await page.request.get(base)).json();
      const removed = await page.request.delete(
        `${base}?expected_revision=${latest.revision}`,
        { headers },
      );
      expect(removed.ok()).toBeTruthy();
    }
  });
}
