import { expect, test } from "@playwright/test";

function wavFixture(seconds = 1) {
  const sampleRate = 8_000;
  const dataSize = sampleRate * seconds * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

test.beforeEach(async ({ page }) => {
  await page.route("**/v1/tool-navigation/state", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });
  await page.route("**/v1/tool-navigation/tools/*/use", async (route) => {
    const toolId = route.request().url().split("/").at(-2) ?? "tool";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        tool_id: toolId,
        is_favorite: false,
        favorite_updated_at: null,
        last_used_at: "2026-08-03T08:00:00Z",
        use_count: 1,
      }),
    });
  });
});

test("home is the default route and tools stay responsive", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/home$/);
  await expect(
    page.getByRole("heading", { name: "今天想从哪里开始？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /查找工具/ }).click();
  await expect(page).toHaveURL(/\/tools$/);
  await expect(page.getByRole("heading", { name: "工具导航" })).toBeVisible();

  const navItems = page.getByRole("navigation").getByRole("button");
  await expect(navItems.nth(0)).toContainText("首页");
  await expect(navItems.nth(1)).toContainText("AI应用");
  await expect(navItems.nth(2)).toContainText("文件管理");
  await expect(navItems.nth(3)).toContainText("工具导航");
  await expect(navItems.nth(4)).toContainText("基模型");
  await expect(page.locator(".tool-grid")).toHaveCSS(
    "grid-template-columns",
    /\S+px \S+px \S+px/,
  );

  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.locator(".tools-layout")).toHaveCSS(
    "grid-template-columns",
    /\S+px/,
  );
  await expect(page.locator(".tool-grid")).toHaveCSS(
    "grid-template-columns",
    /\S+px \S+px/,
  );

  await page.setViewportSize({ width: 700, height: 800 });
  await expect(page.locator(".tool-grid")).toHaveCSS(
    "grid-template-columns",
    /\S+px/,
  );
  await page.getByRole("button", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("filters tools and records external usage", async ({ page }) => {
  await page.goto("/tools");
  await page.getByRole("button", { name: "模型工具" }).click();
  await page.getByRole("button", { name: "Token", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "打开Token 估算" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "打开模型调用日志" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "打开模型测试" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "打开模型服务" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "打开JSON 格式化" }),
  ).toHaveCount(0);

  const usage = page.waitForRequest(
    "**/v1/tool-navigation/tools/token-estimator/use",
  );
  await page.getByRole("button", { name: "打开Token 估算" }).click();
  await usage;
  await expect(page).toHaveURL(/\/tools$/);
});

test("opens the local video frame exporter", async ({ page }) => {
  await page.goto("/tools");
  const usage = page.waitForRequest(
    "**/v1/tool-navigation/tools/video-frame-exporter/use",
  );
  await page.getByRole("button", { name: "打开视频帧导出" }).click();
  await usage;

  await expect(page).toHaveURL(/\/tools\/video-frame-exporter$/);
  await expect(page.getByRole("heading", { name: "视频帧导出" })).toBeVisible();
  await expect(page.getByText("视频仅在本地处理")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "工具导航", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  await page.setViewportSize({ width: 700, height: 800 });
  await expect(page.locator(".video-frame-header")).toHaveCSS(
    "grid-template-columns",
    /\S+px/,
  );
  await page.getByRole("button", { name: "返回工具导航" }).click();
  await expect(page).toHaveURL(/\/tools$/);
});

test("creates and edits an audio annotation task", async ({ page }) => {
  await page.goto("/tools");
  await page.getByRole("button", { name: "打开录音分段标注" }).click();
  await expect(page).toHaveURL(/\/tools\/audio-annotation$/);

  await page.getByRole("button", { name: "新建任务" }).click();
  await page.getByLabel("上传录音文件").setInputFiles({
    name: `e2e-annotation-${Date.now()}.wav`,
    mimeType: "audio/wav",
    buffer: wavFixture(),
  });
  await expect(
    page.getByRole("option", { name: /e2e-annotation-/ }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "创建并打开" }).click();

  await expect(page).toHaveURL(/\/tools\/audio-annotation\/.+$/);
  await expect(
    page.getByRole("complementary", { name: "片段编辑器" }),
  ).toBeVisible();
  await expect(page.getByLabel("录音波形时间轴")).toBeVisible();
  await page.getByRole("button", { name: "播放当前片段" }).click();
  await expect(
    page.getByRole("button", { name: "暂停当前片段" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "播放当前片段" }),
  ).toBeVisible({ timeout: 3_000 });

  await page.setViewportSize({ width: 1440, height: 900 });
  const transport = page.locator(".annotation-transport");
  await expect(transport).toBeVisible();
  await expect
    .poll(() =>
      transport.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    )
    .toBe(true);
  await expect(page.locator(".annotation-playback-time")).toHaveCSS(
    "white-space",
    "nowrap",
  );

  await page.getByRole("button", { name: "管理", exact: true }).click();
  await page.getByRole("button", { name: "添加说话人" }).click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByRole("combobox", { name: "选择说话人" }).click();
  await page.getByRole("option", { name: "说话人 1" }).click();
  await page
    .getByRole("textbox", { name: "原文说话内容" })
    .fill("自动化验收片段");
  await page.getByRole("checkbox", { name: "标记为已校对" }).click();
  await expect(page.getByText(/已自动保存/)).toBeVisible({ timeout: 5_000 });

  await page
    .getByRole("textbox", { name: "原文说话内容" })
    .fill("这段内容还没有保存");
  await page.getByRole("button", { name: "工具导航", exact: true }).click();
  await expect(
    page.getByRole("alertdialog", { name: "离开并放弃未保存内容？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page).toHaveURL(/\/tools\/audio-annotation\/.+$/);

  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.locator(".annotation-editor-grid")).toHaveCSS(
    "grid-template-columns",
    /\S+px/,
  );
  await expect(page.getByRole("button", { name: "删除片段" })).toBeVisible();
});
