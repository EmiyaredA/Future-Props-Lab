import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const directory = resolve("../.local/acceptance/screenshots");
const fixtures = resolve("../.local/acceptance/fixtures");
test("视频证据、同步复验、参考绑定与返修草稿使用真实隔离接口", async ({
  page,
}) => {
  test.setTimeout(120000);
  mkdirSync(directory, { recursive: true });
  mkdirSync(fixtures, { recursive: true });
  const buffers = [2, 3].map((duration) => {
    const path = resolve(fixtures, `inspection-${duration}s.mp4`);
    execFileSync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=640x360:rate=12",
      "-t",
      String(duration),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      path,
    ]);
    return readFileSync(path);
  });
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
    data: { title: "镜头复验 · 合成视频", kind: "canvas" },
  });
  expect(project.ok()).toBeTruthy();
  const id = (await project.json()).id,
    base = `/v1/visual-workshop/projects/${id}`;
  const uploaded = await page.request.post(`${base}/node-uploads`, {
    headers,
    multipart: {
      expected_revision: "0",
      file: { name: "S03 镜头.mp4", mimeType: "video/mp4", buffer: buffers[0] },
    },
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  const document = await uploaded.json(),
    node = document.nodes[0];
  const reference = await page.request.post(`${base}/node-uploads`, {
    headers,
    multipart: {
      expected_revision: String(document.revision),
      file: {
        name: "角色基准.png",
        mimeType: "image/png",
        buffer: readFileSync(
          resolve("public/brand/visual-workshop-mark-cutout.png"),
        ),
      },
    },
  });
  expect(reference.ok(), await reference.text()).toBeTruthy();
  const template = await page.request.post(
    "/v1/visual-workshop/acceptance-templates",
    {
      headers,
      data: {
        expected_revision: 0,
        document: {
          title: "角色替换基础验收",
          node_ids: [],
          criteria: [
            {
              id: "look",
              title: "角色与道具",
              requirement: "关键造型一致",
              kinds: ["image", "video"],
              method: "manual",
              required: true,
            },
          ],
        },
      },
    },
  );
  expect(template.ok()).toBeTruthy();
  await page.goto(`/apps/visual-workshop/projects/${id}/canvas`);
  await page.getByRole("button", { name: "项目验收", exact: true }).click();
  // Real Workspace template rows exercise the compact table rather than fake mock data.
  await expect(page.getByRole("table")).toContainText("角色替换基础验收");
  await expect(
    page.getByRole("button", { name: "使用模板并配置" }),
  ).toBeInViewport();
  expect((await page.locator(".acceptance-header").boundingBox())?.height).toBe(
    56,
  );
  expect(
    (await page.locator(".acceptance-navigation").boundingBox())?.height,
  ).toBe(40);
  await page.screenshot({
    path: resolve(directory, "density-template-library.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "使用模板并配置" }).click();
  for (const title of ["角色外观一致", "动作与道具"]) {
    await page.getByRole("button", { name: new RegExp(title) }).click();
    await page
      .getByRole("radiogroup", { name: "检查方式" })
      .getByRole("radio", { name: "人工确认", exact: true })
      .click();
    await page.getByRole("button", { name: "选择参考", exact: true }).click();
    await page
      .getByRole("button", {
        name: title === "角色外观一致" ? "绑定 角色基准" : "绑定 S03 镜头",
        exact: true,
      })
      .click();
  }
  await page.getByLabel("强制验收后才能采用输出").check();
  await page.screenshot({
    path: resolve(directory, "density-standard-editor.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "发布并选择验收版本" }).click();
  await expect(
    page.getByRole("heading", { name: "选择输出版本开始验收" }),
  ).toBeVisible();
  const upload = async (buffer: Buffer, version: number) => {
    const canvas = await (await page.request.get(`${base}/canvas`)).json();
    const result = await page.request.post(
      `${base}/nodes/${node.id}/output-uploads`,
      {
        headers,
        multipart: {
          expected_revision: String(canvas.revision),
          file: { name: `候选-v${version}.mp4`, mimeType: "video/mp4", buffer },
        },
      },
    );
    expect(result.ok(), await result.text()).toBeTruthy();
  };
  await upload(buffers[0], 2);
  await page.getByRole("button", { name: "刷新版本列表" }).click();
  await page.getByLabel(/v2 · 候选版本/).check();
  await page.getByRole("button", { name: /开始验收（/ }).click();
  await expect(
    page.getByRole("button", {
      name: "动作与道具 人工确认 待确认",
      exact: true,
    }),
  ).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: /动作与道具/ }).click();
  await page.getByText("问题区间与加密取样", { exact: true }).click();
  await page.getByLabel("起始秒").fill("0.25");
  await page.getByLabel("结束秒").fill("1.25");
  await page.getByRole("button", { name: "区间加密取样" }).click();
  await expect(
    page.getByRole("button", { name: "查看 250 毫秒证据", exact: true }),
  ).toBeVisible();
  await page.getByLabel("判断说明").fill("道具在问题区间接触不自然");
  await page.getByRole("button", { name: "需修改", exact: true }).click();
  await page
    .getByRole("button", { name: "查看 250 毫秒证据", exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .getByLabel("验收视频")
        .evaluate((video: HTMLVideoElement) => video.currentTime),
    )
    .toBeCloseTo(0.25, 1);
  await page.getByRole("button", { name: "返修草稿", exact: true }).click();
  await page
    .getByLabel("返修提示词")
    .fill("保留构图，修正道具接触。由用户手动生成。");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "保存草稿", exact: true })
    .click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.screenshot({
    path: resolve(directory, "density-version-result.png"),
    animations: "disabled",
  });
  await upload(buffers[1], 3);
  await page
    .getByRole("button", { name: "选择返修版本复验", exact: true })
    .click();
  await page.getByRole("button", { name: "刷新版本列表" }).click();
  await page.getByLabel(/v3 · 候选版本/).check();
  await page.getByRole("button", { name: /开始复验（/ }).click();
  await expect(
    page.getByText("输出 v3 · 标准 v1 · 检查完成", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.getByLabel("同步播放")).toBeChecked();
  await expect(
    page.getByRole("button", { name: "播放视频", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "播放视频", exact: true }).click();
  await expect
    .poll(() =>
      page
        .getByLabel("验收视频")
        .evaluate((video: HTMLVideoElement) => video.ended),
    )
    .toBeTruthy();
  await expect
    .poll(() =>
      page
        .getByLabel("返修前视频")
        .evaluate((video: HTMLVideoElement) => video.currentTime),
    )
    .toBeCloseTo(2, 1);
  for (const title of ["角色外观一致", "动作与道具", "表演与情绪"]) {
    await page.getByRole("button", { name: new RegExp(title) }).click();
    await page.getByRole("button", { name: "确认通过", exact: true }).click();
  }
  await page.getByRole("button", { name: "确认整体验收结论" }).click();
  await expect(page.getByText("已解决", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看返修草稿", exact: true }).click();
  await expect(page.getByLabel("返修提示词")).toHaveValue(
    "保留构图，修正道具接触。由用户手动生成。",
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.screenshot({
    path: resolve(directory, "density-recheck.png"),
    animations: "disabled",
  });
  await expect(page.locator(".acceptance-review-media")).toHaveCSS(
    "overflow-y",
    "auto",
  );
  for (const width of [1600, 1366, 768, 390]) {
    await page.setViewportSize({ width, height: width === 1366 ? 900 : 1000 });
    if (width < 1200)
      await page.getByRole("button", { name: "检查详情", exact: true }).click();
    if (width >= 1200)
      await expect(
        page.getByRole("button", { name: "设为最终输出", exact: true }),
      ).toBeInViewport();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBeTruthy();
    await page.getByRole("button", { name: "深色", exact: true }).click();
    await page.screenshot({
      path: resolve(directory, `density-recheck-${width}-dark.png`),
      animations: "disabled",
    });
    await page.getByRole("button", { name: "浅色", exact: true }).click();
  }
  await page.getByRole("button", { name: "设为最终输出", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`${base}/canvas`)).json()).nodes.find(
          (item: { id: string }) => item.id === node.id,
        ).final_version,
    )
    .toBe(3);
  expect(errors).toEqual([]);
});
