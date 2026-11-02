import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { setResponsiveTheme } from "./responsive-capture";

async function uploadSamples(page: Page, info: TestInfo, suffix = "") {
  const video = info.outputPath(`preview${suffix}.mp4`);
  const audio = info.outputPath(`preview${suffix}.wav`);
  const pdf = info.outputPath(`preview${suffix}.pdf`);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x180:r=10",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    video,
  ]);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    audio,
  ]);
  execFileSync(resolve("../.venv/bin/python"), [
    "-c",
    "from PIL import Image, ImageDraw; import sys; a=Image.new('RGB',(400,560),'#faf4e9'); b=Image.new('RGB',(400,560),'#d1e4f4'); ImageDraw.Draw(a).text((30,50),'Actual PDF page one',fill='black',font_size=26); ImageDraw.Draw(b).text((30,50),'Actual PDF page two',fill='black',font_size=26); a.save(sys.argv[1],format='PDF',save_all=True,append_images=[b])",
    pdf,
  ]);
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const rows: Record<string, { id: string; display_name: string }> = {};
  for (const [kind, name, mime, buffer] of [
    ["video", `preview-sample${suffix}.mp4`, "video/mp4", readFileSync(video)],
    ["audio", `preview-sample${suffix}.wav`, "audio/wav", readFileSync(audio)],
    [
      "pdf",
      `preview-sample${suffix}.pdf`,
      "application/pdf",
      readFileSync(pdf),
    ],
  ] as const) {
    const response = await page.request.post("/v1/files", {
      headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
      multipart: { upload: { name, mimeType: mime, buffer } },
    });
    expect(response.ok(), await response.text()).toBe(true);
    rows[kind] = await response.json();
  }
  return rows;
}

test("real homepage and file library previews play media and read PDF and text", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/home");
  const samples = await uploadSamples(page, info);
  const originals: string[] = [];
  page.on("request", (request) => {
    if (/\/v1\/files\/[^/]+\/content/.test(request.url()))
      originals.push(request.url());
  });
  await page.reload();
  const files = page.locator("#home-files");
  await files.scrollIntoViewIfNeeded();
  await expect(files.locator(".home-file-art-video img")).toBeVisible();
  await expect(files.locator(".home-file-art-audio img")).toBeVisible();
  await expect(files.locator(".home-file-art-document img")).toBeVisible();
  const pdfFits = await files
    .locator(".home-file-art-document")
    .evaluate((el) => {
      const content = el.querySelector(".file-content-thumbnail")!;
      const image = el.querySelector("img")!;
      return (
        content.clientHeight <= el.clientHeight &&
        image.clientHeight <= content.clientHeight &&
        getComputedStyle(image).objectFit === "contain"
      );
    });
  expect(pdfFits).toBe(true);
  expect(originals).toEqual([]);
  await page.screenshot({
    path: info.outputPath("home-content-previews.png"),
    animations: "disabled",
  });
  await files.locator(".home-file-art-video").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("video")).toBeVisible();
  await dialog.getByRole("button", { name: "播放", exact: true }).click();
  await expect
    .poll(() =>
      dialog
        .locator("video")
        .evaluate((el: HTMLVideoElement) => el.currentTime),
    )
    .toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "暂停", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(files.locator(".home-file-art-video")).toBeFocused();
  await files.locator(".home-file-art-audio").click();
  await dialog.getByRole("button", { name: "播放", exact: true }).click();
  await expect
    .poll(() =>
      dialog
        .locator("audio")
        .evaluate((el: HTMLAudioElement) => el.currentTime),
    )
    .toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await files.locator(".home-file-art-document").click();
  await expect(dialog.getByAltText("第 1 页")).toBeVisible();
  await dialog.getByRole("button", { name: "下一页" }).click();
  await expect(dialog.getByAltText("第 2 页")).toBeVisible();
  await dialog.getByRole("button", { name: "放大" }).click();
  await expect(dialog.getByText("125%")).toBeVisible();
  await page.screenshot({
    path: info.outputPath("pdf-page-preview.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await files.getByRole("button", { name: "文档资料", exact: true }).click();
  await expect(page).toHaveURL(/\/files\?kind=document$/);
  await page
    .getByRole("button", {
      name: `预览 ${samples.pdf.display_name}`,
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog").getByAltText("第 1 页")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/home");
  await page.getByLabel("选择上传文件").setInputFiles({
    name: "safe-preview.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "# Safe text preview\n<script>window.previewInjected = true</script>",
    ),
  });
  await expect(page.getByRole("status")).toContainText("1 个文件已上传");
  await page.getByRole("button", { name: "预览 safe-preview" }).click();
  await expect(page.locator(".file-document-text")).toContainText(
    "<script>window.previewInjected = true</script>",
  );
  expect(await page.evaluate(() => "previewInjected" in window)).toBe(false);
});

test("homepage sleeves stack three real files without overlapping controls across themes and widths", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.goto("/home");
  const latest: Record<string, string[]> = {
    image: [],
    video: [],
    audio: [],
    document: [],
  };
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  for (const [index, image] of [
    "report-background",
    "structured-template",
    "visual-generation",
  ].entries()) {
    const samples = await uploadSamples(page, info, `-sleeve-${index}`);
    for (const [kind, sampleKind] of [
      ["video", "video"],
      ["audio", "audio"],
      ["document", "pdf"],
    ]) {
      latest[kind].unshift(samples[sampleKind].id);
    }
    const response = await page.request.post("/v1/files", {
      headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
      multipart: {
        upload: {
          name: `sleeve-image-${index}.png`,
          mimeType: "image/png",
          buffer: readFileSync(
            resolve(`public/presentation-templates/${image}.png`),
          ),
        },
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    latest.image.unshift((await response.json()).id);
  }
  const originals: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/\/v1\/files\/[^/]+\/content/.test(request.url()))
      originals.push(request.url());
  });
  await page.reload();
  const section = page.locator("#home-files");
  await section.scrollIntoViewIfNeeded();
  for (const [kind, ids] of Object.entries(latest)) {
    const category = section.locator(`[data-kind="${kind}"]`);
    await expect(category.locator(".home-file-paper")).toHaveCount(3);
    for (const [layer, id] of ids.entries()) {
      await expect(category.locator(`[data-layer="${layer}"]`)).toHaveAttribute(
        "data-file-id",
        id,
      );
    }
    await expect(category.locator(".home-file-paper img")).toHaveCount(3);
    for (const image of await category.locator(".home-file-paper img").all()) {
      await expect(image).toBeVisible();
    }
    await expect(category.getByRole("button")).toHaveCount(2);
  }
  for (const width of [390, 768, 1280, 1581, 1600, 1920]) {
    await page.setViewportSize({ width, height: 995 });
    for (const theme of ["light", "dark"]) {
      await setResponsiveTheme(page, theme);
      await section.scrollIntoViewIfNeeded();
      const layout = await section.evaluate((root) => {
        const header = root
          .querySelector(".home-section-heading")!
          .getBoundingClientRect();
        const categories = [...root.querySelectorAll(".home-file-category")];
        const cards = categories.flatMap((category) => [
          ...category.querySelectorAll(".home-file-paper"),
        ]);
        return {
          columns: getComputedStyle(
            root.querySelector(".home-file-grid")!,
          ).gridTemplateColumns.split(" ").length,
          titleSize: getComputedStyle(
            root.querySelector(".home-file-category-link")!,
          ).fontSize,
          titleWeight: getComputedStyle(
            root.querySelector(".home-file-category-link")!,
          ).fontWeight,
          headerClear: cards.every(
            (card) => card.getBoundingClientRect().top >= header.bottom + 11,
          ),
          contained: cards.every((card) => {
            const box = card.getBoundingClientRect();
            const category = card
              .closest(".home-file-category")!
              .getBoundingClientRect();
            return (
              box.left >= category.left - 1 && box.right <= category.right + 1
            );
          }),
          touchTargets: [...root.querySelectorAll("button")].every(
            (button) => button.getBoundingClientRect().height >= 44,
          ),
          overflow:
            document.querySelector(".studio-main")!.scrollWidth >
            document.querySelector(".studio-main")!.clientWidth + 1,
        };
      });
      expect(layout.columns).toBe(width < 1000 ? 2 : 4);
      expect(layout.titleSize).toBe(width <= 600 ? "13px" : "15px");
      expect(layout.titleWeight).toBe("700");
      expect(layout.headerClear).toBe(true);
      expect(layout.contained).toBe(true);
      expect(layout.overflow).toBe(false);
      if (width === 390) expect(layout.touchTargets).toBe(true);
      await section.screenshot({
        path: info.outputPath(`sleeves-${width}-${theme}.png`),
        animations: "disabled",
      });
      if (width === 1581 && theme === "dark") {
        await page.screenshot({
          path: info.outputPath("sleeves-desktop-context.png"),
          animations: "disabled",
        });
      }
    }
  }
  expect(originals).toEqual([]);
  const preview = section.locator(".home-file-art-document");
  await preview.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog").getByAltText("第 1 页")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toBeFocused();
  await section.screenshot({
    path: info.outputPath("sleeves-keyboard-focus.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Tab");
  await expect(
    section.getByRole("button", { name: "文档资料", exact: true }),
  ).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await section
      .locator('.home-file-paper[data-layer="0"]')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe("0s");
  expect(errors).toEqual([]);
});

test("file and application cards keep compact columns and readable content across sizes and themes", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  for (const path of ["/files", "/apps", "/home"]) {
    await page.goto(path);
    for (const width of [390, 768, 1280, 1600, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"]) {
        await setResponsiveTheme(page, theme);
        expect(
          await page
            .locator(".studio-main")
            .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          `${path} ${width} ${theme}`,
        ).toBe(true);
        if (path === "/files" && width >= 1600) {
          const columns = await page
            .locator(".file-items.grid .file-asset-collection")
            .evaluate(
              (el) =>
                getComputedStyle(el).gridTemplateColumns.split(" ").length,
            );
          expect(columns).toBeGreaterThanOrEqual(5);
          expect(columns).toBeLessThanOrEqual(10);
          const box = await page
            .locator(".file-items.grid article")
            .first()
            .boundingBox();
          expect(box!.height).toBeLessThanOrEqual(180);
        }
        if (path === "/apps" && width >= 1600) {
          expect(
            await page
              .locator(".application-grid")
              .evaluate(
                (el) =>
                  getComputedStyle(el).gridTemplateColumns.split(" ").length,
              ),
          ).toBeGreaterThanOrEqual(4);
          expect(
            (await page.locator(".application-card").first().boundingBox())!
              .height,
          ).toBeLessThanOrEqual(180);
        }
        if (path === "/home")
          await page.locator("#home-files").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: info.outputPath(`${path.slice(1)}-${width}-${theme}.png`),
          animations: "disabled",
        });
      }
    }
  }
});

test.describe("preview touch targets", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("custom media controls retain touch targets", async ({ page }, info) => {
    await page.goto("/home");
    await uploadSamples(page, info);
    await page.reload();
    await page.locator(".home-file-art-video").click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "播放", exact: true }),
    ).toBeVisible();
    for (const button of await page
      .getByRole("dialog")
      .getByRole("button")
      .all()) {
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page
        .getByRole("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
  });
});
