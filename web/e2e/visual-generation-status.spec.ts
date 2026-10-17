import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

test("生成状态保持紧凑，转圈覆盖各入口，终态恢复生成操作", async ({ page }) => {
  test.setTimeout(60_000);
  const screenshots = resolve(
    process.env.FPL_GENERATION_SCREENSHOTS ||
      "../.local/generation-status-ui-20261017/browser",
  );
  mkdirSync(screenshots, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/apps/visual-workshop");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const created = await page.request.post("/v1/visual-workshop/projects", {
    headers,
    data: { title: "绿幕舞蹈 · 生成状态验收", kind: "canvas" },
  });
  expect(created.ok()).toBeTruthy();
  const projectId = (await created.json()).id;
  const base = `/v1/visual-workshop/projects/${projectId}`;
  const saved = await page.request.put(`${base}/canvas`, {
    headers,
    data: {
      expected_revision: 0,
      nodes: [
        {
          id: "video",
          kind: "video",
          title: "真由理 / GIF舞蹈 / 绿幕",
          position: { x: 200, y: 0 },
          generation_draft: {
            model_id: "fixture-video",
            prompt:
              "Uniform pure green screen throughout the video. Preserve the character and dance motion.",
            mode: "text",
            duration: 7,
            resolution: "720p",
            ratio: "16:9",
            watermark: false,
            generate_audio: false,
          },
        },
        {
          id: "idle",
          kind: "text",
          title: "舞蹈动作说明",
          text: "7 秒绿幕舞蹈，固定机位。",
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  let status = "processing";
  let progress = 0;
  const task = () => ({
    id: "fixture-task",
    project_id: projectId,
    canvas_node_id: "video",
    provider_id: "fixture-provider",
    model_id: "fixture-video",
    provider_kind: "zealman_video",
    kind: "video",
    provider_name: "本地验收",
    model_slug: "u17",
    request_payload: {},
    provider_task_id: null,
    status,
    progress,
    error_message: null,
    result_asset_id: null,
    can_retry_materialization: false,
    revision: 1,
    created_at: new Date(Date.now() - 84_000).toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
  });
  await page.route("**/v1/visual-workshop/generation-options", (route) =>
    route.fulfill({
      json: {
        models: [
          {
            id: "fixture-video",
            provider_id: "fixture-provider",
            provider_name: "本地验收",
            kind: "video",
            slug: "fixture-video",
            label: "U17 视频 · 隔离验收",
            description: "不提交模型",
            max_prompt_length: 6000,
            max_reference_images: 9,
            sizes: [],
            supports_seed: false,
          },
        ],
      },
    }),
  );
  await page.route("**/v1/visual-workshop/generation-tasks?**", (route) =>
    route.fulfill({ json: { items: [task()], total: 1 } }),
  );
  await page.goto(`/apps/visual-workshop/projects/${projectId}/canvas`);
  await page.getByRole("button", { name: "看板", exact: true }).click();
  const tree = page.getByRole("complementary", {
    name: "项目素材",
    exact: true,
  });
  await tree.getByRole("button", { name: /^真由理.*GIF舞蹈/ }).click();
  const output = page.getByRole("region", { name: "节点输出历史" });
  const activity = page.getByLabel("当前生成状态");
  await expect(activity.getByRole("status")).toHaveText("正在生成视频");
  await expect(
    page.getByText("项目发生并发更新，本地草稿已保留。"),
  ).toHaveCount(0);
  await expect(output.getByLabel("等待生成画面")).toBeVisible();
  await expect(page.getByRole("button", { name: "视频生成中" })).toBeDisabled();
  await expect(tree.getByLabel("真由理 / GIF舞蹈 / 绿幕生成中")).toBeVisible();
  expect(
    (await tree.getByLabel("真由理 / GIF舞蹈 / 绿幕生成中").boundingBox())!
      .width,
  ).toBeLessThanOrEqual(16);
  await expect(activity.getByRole("progressbar")).not.toHaveAttribute(
    "aria-valuenow",
  );
  expect((await activity.boundingBox())!.height).toBeLessThanOrEqual(45);
  const stage = (await output.locator(".board-large-preview").boundingBox())!;
  expect(Math.abs(stage.width / stage.height - 16 / 9)).toBeLessThan(0.02);
  await expect(output.getByText("过程预览")).toHaveCount(0);
  await expect(output.getByText("已提交", { exact: true })).toHaveCount(0);
  expect(
    await activity
      .locator("svg")
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("visual-generation-spin");
  await page.screenshot({
    animations: "disabled",
    path: resolve(screenshots, "light.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByText("项目发生并发更新，本地草稿已保留。"),
  ).toHaveCount(0);
  await page.screenshot({
    animations: "disabled",
    path: resolve(screenshots, "dark.png"),
    fullPage: true,
  });
  progress = 82;
  await expect(activity.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "82",
  );
  await page.getByRole("button", { name: "状态分组", exact: true }).click();
  const card = page.locator(".board-task-card.is-running");
  await expect(card.getByText("82%")).toBeVisible();
  expect(
    await card
      .locator(".visual-generation-spinner")
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("visual-generation-spin");
  await card.getByRole("button", { name: /打开任务/ }).click();
  await expect(activity).toBeVisible();
  await tree.getByRole("button", { name: /^舞蹈动作说明/ }).click();
  await expect(activity).toHaveCount(0);
  await tree.getByRole("button", { name: /^真由理.*GIF舞蹈/ }).click();
  await expect(activity).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await activity.scrollIntoViewIfNeeded();
  expect((await activity.boundingBox())!.height).toBeLessThanOrEqual(68);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    animations: "disabled",
    path: resolve(screenshots, "mobile.png"),
    fullPage: true,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await activity
      .locator("svg")
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  status = "completed";
  await expect(activity).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "生成视频", exact: true }),
  ).toBeEnabled();
  await page.request.delete(base, { headers });
});
