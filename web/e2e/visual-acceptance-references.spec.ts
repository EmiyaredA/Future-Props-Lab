import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const directory = resolve("../.local/reference-preview/screenshots");
test.use({ hasTouch: true });
test("参考素材列表显示格式，与验收节点使用一致的整行选择交互", async ({
  page,
}) => {
  test.setTimeout(120000);
  mkdirSync(directory, { recursive: true });
  const videoPath = resolve(directory, "reference.mp4");
  execFileSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=12",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    videoPath,
  ]);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/visual-workshop");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const project = await page.request.post("/v1/visual-workshop/projects", {
    headers,
    data: { title: "素材选择 · 隔离验收", kind: "canvas" },
  });
  expect(project.ok()).toBeTruthy();
  const id = (await project.json()).id;
  const base = `/v1/visual-workshop/projects/${id}`;
  let revision = 0;
  const longTitle = `角色基准_${"长名称用于检查两行省略与完整预览标题_".repeat(5)}`;
  const titles = [
    longTitle,
    "动作参考",
    ...Array.from({ length: 6 }, (_, index) => `场景参考 ${index + 1}`),
  ];
  for (const [index, title] of titles.entries()) {
    const video = index === 1;
    const result = await page.request.post(`${base}/node-uploads`, {
      headers,
      multipart: {
        expected_revision: String(revision),
        file: {
          name: `${title}.${video ? "mp4" : "png"}`,
          mimeType: video ? "video/mp4" : "image/png",
          buffer: readFileSync(
            video
              ? videoPath
              : resolve("public/brand/visual-workshop-mark-cutout.png"),
          ),
        },
      },
    });
    expect(result.ok(), await result.text()).toBeTruthy();
    revision = (await result.json()).revision;
  }
  await page.goto(`/apps/visual-workshop/projects/${id}/canvas`);
  await page.getByRole("button", { name: "项目验收", exact: true }).click();
  await page.getByRole("button", { name: "从空白开始", exact: true }).click();
  await page.getByRole("button", { name: "添加验收项", exact: true }).click();
  await page.getByRole("button", { name: "选择参考", exact: true }).click();
  const picker = page.getByRole("region", { name: "选择项目参考素材" });
  const options = picker.getByRole("list", { name: "项目参考素材" });
  await expect(options.getByRole("listitem")).toHaveCount(8);
  const imageRow = options.getByRole("listitem", {
    name: longTitle,
    exact: true,
  });
  const videoRow = options.getByRole("listitem", {
    name: "动作参考",
    exact: true,
  });
  await expect(imageRow).toContainText("图片 · PNG");
  await expect(videoRow).toContainText("视频 · MP4");
  const thumbnail = imageRow.locator(".acceptance-thumbnail");
  await expect(thumbnail).toHaveCSS("width", "64px");
  await expect(thumbnail).toHaveCSS("height", "40px");
  await expect(imageRow.locator("strong")).toHaveCSS("-webkit-line-clamp", "2");
  await imageRow.hover();
  await expect(picker.getByRole("button", { name: /^预览 / })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(videoRow.locator("video")).toBeVisible();
  const last = options.getByRole("listitem", {
    name: "场景参考 6",
    exact: true,
  });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toContainText("图片 · PNG");
  await expect
    .poll(() => options.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.screenshot({
    path: resolve(directory, "reference-list-dark.png"),
    animations: "disabled",
  });
  await last
    .getByRole("button", { name: "绑定 场景参考 6", exact: true })
    .click();
  const bound = page.getByRole("list", { name: "已绑定参考" });
  await expect(bound).toContainText("场景参考 6");
  await expect(bound.getByRole("button", { name: /^预览 / })).toHaveCount(0);
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: "条目详情", exact: true }).click();
    await page.getByRole("button", { name: "选择参考", exact: true }).click();
    await expect(picker).toBeVisible();
    await expect(imageRow.locator(".acceptance-thumbnail")).toBeVisible();
    await expect(picker.getByRole("button", { name: /^预览 / })).toHaveCount(0);
    await page.screenshot({
      path: resolve(directory, `reference-list-${width}.png`),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "选择参考", exact: true }),
    ).toBeFocused();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBeTruthy();
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page
    .getByRole("button", { name: "发布并选择验收版本", exact: true })
    .click();
  for (const width of [1600, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const trigger = page.getByRole("button", { name: "验收节点", exact: true });
    await trigger.click();
    const nodePicker = page.getByRole("region", {
      name: "选择验收节点",
      exact: true,
    });
    await expect(nodePicker.getByRole("listitem")).toHaveCount(8);
    const imageOption = nodePicker.getByRole("button", {
      name: `选择 ${longTitle}`,
      exact: true,
    });
    await expect(imageOption).toContainText("图片 · PNG");
    await expect(imageOption.locator(".acceptance-thumbnail")).toHaveCSS(
      "width",
      "64px",
    );
    const videoOption = nodePicker.getByRole("button", {
      name: "选择 动作参考",
      exact: true,
    });
    await expect(videoOption).toContainText("视频 · MP4");
    await expect(
      nodePicker.getByRole("button", { name: /^预览 / }),
    ).toHaveCount(0);
    await page.screenshot({
      path: resolve(directory, `node-list-${width}.png`),
      animations: "disabled",
    });
    await videoOption.tap();
    await expect(nodePicker).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveText("动作参考");
    await expect(page.getByLabel(/v1 · 最终输出/)).toBeVisible();
    await trigger.click();
    await expect(
      nodePicker.getByRole("button", { name: "选择 动作参考", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBeTruthy();
  }
  expect(errors).toEqual([]);
});
