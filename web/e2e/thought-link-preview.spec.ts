import { expect, test, type Page } from "@playwright/test";
import { newDocument, saveNote } from "./thought-helpers";

const address =
  "https://elevenlabs.io/docs/agents-platform/customization/agent-analysis/success-evaluation";
const html = `<h2>2.7 产品实践：补充佐证，不当作学术标准</h2>
<p>鼠标悬停在引用编号上，查看来源与页面简介。</p>
<table><tr><th>产品 / 通行术语</th><th>已公开口径与测量证据</th><th>使用边界</th></tr>
<tr><td>ElevenLabs 会话成功评价（Success Evaluation）</td><td>自定义准则读取 transcript，经 LLM 给出 success / failure / unknown 与理由；单位为每准则判定。 <a href="${address}">[28]</a></td><td>官方产品实现；不能把 transcript 推断的成功等同业务状态事实。</td></tr>
<tr><td>ElevenLabs 参数验证与重复通过率</td><td>参数 Exact Match、Regex、LLM Evaluation；相同输入多次生成后报告通过次数 / 运行次数。</td><td>工具测试不是远端副作用验收。</td></tr></table>
<p>其他来源 <a href="https://example.com/unavailable">[29]</a></p>`;

async function setup(page: Page) {
  await page.route("**/v1/thought-workshop/link-preview?**", async (route) => {
    const url = new URL(route.request().url()).searchParams.get("url")!;
    const available = url === address;
    await route.fulfill({
      json: {
        url,
        final_url: url,
        domain: new URL(url).hostname,
        available,
        title: available ? "Evaluate agent performance" : null,
        description: available
          ? "了解 Success Evaluation 如何读取会话 transcript，并将每项准则判断为 success、failure 或 unknown。"
          : null,
      },
    });
  });
  await page.goto("/apps/thought-workshop");
  await newDocument(page);
  await page
    .getByLabel("笔记标题", { exact: true })
    .fill("链接悬浮预览 · 产品实践");
  const prose = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await prose.focus();
  await prose.evaluate((element, content) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/html", content);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, html);
  await expect(
    prose.getByRole("link", { name: "[28]", exact: true }),
  ).toBeVisible();
  await saveNote(page);
  return prose;
}

test("table preview, focus, themes, viewport edges, fallback and read-only", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  let prose = await setup(page);
  const writes: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "PUT" && req.url().includes("/notes/"))
      writes.push(req.url());
  });
  let link = prose.getByRole("link", { name: "[28]", exact: true });
  const card = page.getByRole("dialog", { name: "链接预览" });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await link.hover();
    await expect(card.getByText("Evaluate agent performance")).toBeVisible();
    await card.hover();
    await expect(card).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`link-preview-${theme}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
  }
  await link.focus();
  await expect(card).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(card.getByRole("link", { name: "打开原文" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(link).toBeFocused();
  await expect(card).toBeHidden();
  await prose.getByRole("link", { name: "[29]", exact: true }).hover();
  await expect(card.getByText("暂时无法获取页面简介")).toBeVisible();
  await link.hover();
  await expect(card.getByText("Evaluate agent performance")).toBeVisible();
  expect(writes).toEqual([]);
  await page.keyboard.press("Escape");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await link.scrollIntoViewIfNeeded();
    await link.hover();
    await expect(card).toBeVisible();
    const rect = (await card.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(12);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width - 12);
    expect(rect.y).toBeGreaterThanOrEqual(12);
    expect(rect.y + rect.height).toBeLessThanOrEqual(888);
    await page.screenshot({
      path: testInfo.outputPath(`link-preview-${width}.png`),
    });
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.permission_keys = ["content.read"];
    await route.fulfill({ json: body });
  });
  await page.reload();
  prose = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await expect(prose).toHaveAttribute("contenteditable", "false");
  link = prose.getByRole("link", { name: "[28]", exact: true });
  await expect(async () => {
    await page.mouse.move(0, 0);
    await link.hover();
    await expect(card.getByText("Evaluate agent performance")).toBeVisible({
      timeout: 1_000,
    });
  }).toPass({ timeout: 8_000 });
});

test.describe("touch interaction", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 900 } });
  test("first tap previews; open original is an explicit action", async ({
    page,
  }) => {
    const prose = await setup(page);
    const link = prose.getByRole("link", { name: "[28]", exact: true });
    const before = page.url();
    await link.tap();
    const card = page.getByRole("dialog", { name: "链接预览" });
    await expect(card.getByText("Evaluate agent performance")).toBeVisible();
    expect(page.url()).toBe(before);
    await page
      .context()
      .route("https://elevenlabs.io/**", (route) =>
        route.fulfill({ body: "Example destination" }),
      );
    const popup = page.waitForEvent("popup");
    await card.getByRole("link", { name: "打开原文" }).tap();
    await expect(await popup).toHaveURL(address);
  });
});
