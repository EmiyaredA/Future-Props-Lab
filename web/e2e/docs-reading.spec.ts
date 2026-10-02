import { expect, test } from "@playwright/test";
import { OFFICIAL_KNOWLEDGE_BASES } from "../src/features/thought-workshop/official/catalog";
import { setResponsiveTheme } from "./responsive-capture";

const root = "/apps/thought-workshop/official-knowledge-bases";
const delivery = `${root}/director-desk/documents/delivery`;

test("official reader provides three columns, callouts, code copying and linked reading", async ({
  page,
  context,
}, info) => {
  test.setTimeout(60_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(delivery);
  const article = page.getByRole("article", { name: "官方文档正文" });
  const outline = page.locator(".official-outline");
  await expect(article).toContainText("给拍摄团队看节奏与构图");
  await expect(
    article.getByRole("complementary", { name: "说明", exact: true }),
  ).toBeVisible();
  await expect(
    article.getByRole("complementary", { name: "注意", exact: true }),
  ).toHaveCount(1);
  await expect(article).not.toContainText("[!NOTE]");
  const articleBox = await article.boundingBox();
  const outlineBox = await outline.boundingBox();
  const navigationBox = await page
    .getByRole("navigation", { name: "官方文档目录" })
    .boundingBox();
  expect(navigationBox!.x + navigationBox!.width).toBeLessThan(articleBox!.x);
  expect(outlineBox!.x).toBeGreaterThanOrEqual(
    articleBox!.x + articleBox!.width,
  );
  await page.screenshot({
    path: info.outputPath("reader-three-columns-light.png"),
  });

  await article.getByRole("button", { name: "复制代码", exact: true }).click();
  await expect(article.getByText("复制成功", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "fpl open director PROJECT_ID",
  );
  const chapter = article.getByRole("heading", {
    name: "用外部 Agent 操作场景",
    exact: true,
  });
  await article
    .getByRole("button", {
      name: "复制章节链接：用外部 Agent 操作场景",
      exact: true,
    })
    .click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(link).pathname).toBe(delivery);
  expect(new URL(link).hash).toBe(`#${await chapter.getAttribute("id")}`);
  await page.goto(link);
  await expect(chapter).toBeInViewport();
  await expect(
    outline.getByRole("link", { name: "用外部 Agent 操作场景", exact: true }),
  ).toHaveAttribute("aria-current", "location");
  await page.reload();
  await expect(chapter).toBeInViewport();
  await page
    .getByRole("navigation", { name: "前后篇导航" })
    .getByRole("button", { name: /下一篇/ })
    .click();
  await expect(page).toHaveURL(`${root}/director-desk/documents/help`);
  await page
    .getByRole("navigation", { name: "前后篇导航" })
    .getByRole("button", { name: /上一篇/ })
    .click();
  await expect(page).toHaveURL(delivery);
  await page
    .getByRole("navigation", { name: "相关阅读", exact: true })
    .getByRole("button", { name: /集成与 Agent\/SDK/ })
    .click();
  await expect(page).toHaveURL(`${root}/technical/documents/automation`);
  await expect(page.locator(".thought-mermaid-preview svg")).toBeVisible();
});

test("reader adapts outline and tables to tablet and mobile in both themes", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await page.goto(`${root}/motion-compositor/documents/help`);
  for (const width of [1600, 1000, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const outline = page.locator(".official-outline");
    if (width <= 1200) {
      await expect(outline).not.toHaveAttribute("open", "");
      await outline.locator("summary").click();
      await expect(outline).toHaveAttribute("open", "");
      await outline
        .getByRole("link", { name: "按现象排查", exact: true })
        .click();
    }
    await expect(page.getByRole("table")).toBeVisible();
    await page.getByRole("table").scrollIntoViewIfNeeded();
    for (const theme of ["light", "dark"]) {
      await setResponsiveTheme(page, theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`reader-table-${width}-${theme}.png`),
      });
    }
    if (width <= 1200) {
      await outline.locator("summary").click();
      await expect(outline).not.toHaveAttribute("open", "");
      const trigger = page.getByRole("button", { name: "目录", exact: true });
      await trigger.click();
      await expect(
        page.getByRole("dialog", { name: "官方知识库导航" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
    }
  }
});

test("read-only accounts browse summaries and keep graph state without external networking", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const principal = await response.json();
    principal.workspace.permission_keys = ["content.read"];
    await route.fulfill({ response, json: principal });
  });
  await page.route("**/*", (route) =>
    ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
      ? route.fallback()
      : route.abort(),
  );
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/v1/thought-workshop/") &&
      !request.url().includes("/preferences/") &&
      !["GET", "HEAD"].includes(request.method())
    )
      writes.push(request.url());
  });
  await page.goto(`${root}/audio-annotation`);
  await expect(page.locator(".official-start")).toContainText(
    "用一段双人访谈建立时间、人物与正文对应关系",
  );
  await expect(
    page.locator(".official-article-cards .official-result"),
  ).toHaveCount(5);
  await page.locator(".official-start").click();
  await expect(page).toHaveURL(`${root}/audio-annotation/documents/overview`);
  await expect(
    page
      .getByRole("navigation", { name: "相关阅读", exact: true })
      .getByRole("button"),
  ).toHaveCount(2);
  await page.goto(`${root}/technical/documents/system`);
  const figure = page
    .locator(".diagram-viewer")
    .filter({ has: page.locator("svg[role=img]") });
  await expect(figure).toBeVisible();
  await figure.getByRole("button", { name: "放大图表", exact: true }).click();
  await expect(figure.getByText("125%", { exact: true })).toBeVisible();
  await page.locator(".official-outline summary").click();
  await page.locator(".official-outline summary").click();
  await expect(figure.getByText("125%", { exact: true })).toBeVisible();
  await figure.getByRole("button", { name: "放大阅读", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("125%", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    figure.getByRole("button", { name: "放大阅读", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "复制到个人笔记", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".thought-mermaid-preview svg")).toBeVisible();
  expect(writes).toEqual([]);
});

test("all 84 bundled articles remain readable without internet or resource failures", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400)
      failures.push(`${response.status()} ${response.url()}`);
  });
  await page.route("**/*", (route) =>
    ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
      ? route.fallback()
      : route.abort(),
  );
  const documents = OFFICIAL_KNOWLEDGE_BASES.flatMap((library) =>
    library.documents.map((document) => ({ library, document })),
  );
  expect(documents).toHaveLength(84);
  for (const { library, document } of documents) {
    await test.step(`${library.id}/${document.id}`, async () => {
      await page.goto(`${root}/${library.id}/documents/${document.id}`);
      const article = page.getByRole("article", { name: "官方文档正文" });
      await expect(article.locator("h1")).toBeVisible();
      await expect(article.locator("p").first()).not.toBeEmpty();
      expect((await article.innerText()).length).toBeGreaterThan(300);
      await expect(article).not.toContainText(/\[!(NOTE|TIP|WARNING)\]/);
      await expect(
        page
          .getByRole("navigation", { name: "相关阅读", exact: true })
          .getByRole("button"),
      ).toHaveCount(document.related.length);
      if (library.id === "general" && document.id === "automation") {
        await expect(
          article.locator(".official-code-block .hljs-keyword").first(),
        ).toBeVisible();
      }
      if (library.id === "technical") {
        await expect(
          article.locator(".thought-mermaid-preview svg"),
        ).toBeVisible({ timeout: 20_000 });
        await expect(
          article.locator(".diagram-viewer svg[role=img]"),
        ).toHaveCount(1);
      }
    });
  }
  expect(failures).toEqual([]);
});
