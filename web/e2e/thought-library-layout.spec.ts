import { expect, test, type Page } from "@playwright/test";
import { setThoughtTheme } from "./thought-helpers";

const root = "/v1/thought-workshop/knowledge-bases";
const examples = [
  { title: "短标题", description: "简短说明。" },
  { title: "空简介", description: "" },
  {
    title: "四行简介",
    description:
      "用知识库整理研究资料、记录阅读心得、归纳实践经验，并通过目录组织相关文档，让每次阅读与写作都有清晰的起点，也让后续补充与回顾更加方便。",
  },
  {
    title: "长简介",
    description: "这是很长的简介，保留全文但在卡片中只显示四行。".repeat(20),
  },
  {
    title: "需要自动换行并省略的知识库长标题".repeat(5),
    description: "连续文本也应换行：" + "LongUnbrokenDescription".repeat(25),
  },
];

async function write(
  page: Page,
  path: string,
  data?: unknown,
  method = "POST",
) {
  const response = await page.request.fetch(path, {
    method,
    data,
    headers: {
      Origin: `http://127.0.0.1:${process.env.FPL_E2E_WEB_PORT || "3000"}`,
      "X-CSRF-Token":
        (await page.context().cookies()).find((c) => c.name === "fpl_csrf")
          ?.value || "",
    },
  });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.status() === 204 ? null : response.json();
}

async function expectAlignedCards(page: Page, columns: number) {
  // Measure the rendered layout rather than relying on CSS property assertions.
  await page.mouse.move(0, 0);
  const cards = await page
    .locator(".knowledge-cards .workshop-project-card")
    .evaluateAll((nodes) =>
      nodes.map((card) => {
        const bounds = card.getBoundingClientRect();
        const measure = (selector: string) => {
          const el = card.querySelector(selector)!;
          const rect = el.getBoundingClientRect();
          return {
            top: rect.top - bounds.top,
            height: rect.height,
            width: rect.width,
          };
        };
        return {
          top: bounds.top,
          height: bounds.height,
          cover: measure(".workshop-project-cover"),
          title: measure("h2"),
          description: measure("p"),
          actions: measure(".workshop-project-actions"),
          button: measure(".workshop-project-actions > button"),
        };
      }),
    );
  expect(cards).toHaveLength(examples.length);
  expect(cards.filter((c) => Math.abs(c.top - cards[0].top) < 1)).toHaveLength(
    columns,
  );
  for (const card of cards) {
    expect(Math.abs(card.height - cards[0].height)).toBeLessThan(1);
    expect(
      Math.abs(card.cover.width / card.cover.height - 16 / 9),
    ).toBeLessThan(0.01);
    for (const part of ["title", "description", "actions", "button"] as const) {
      expect(Math.abs(card[part].top - cards[0][part].top)).toBeLessThan(1);
      expect(Math.abs(card[part].height - cards[0][part].height)).toBeLessThan(
        1,
      );
    }
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
}

test("knowledge library cards align with four-line previews across screen sizes and themes", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const marker = `布局验收${Date.now()}`;
  const libraries = [];
  for (const example of examples)
    libraries.push(
      await write(page, root, {
        ...example,
        title: `${example.title} · ${marker}`,
      }),
    );
  await page.goto("/apps/thought-workshop");
  await page
    .getByRole("textbox", { name: "搜索知识库", exact: true })
    .fill(marker);
  const cards = page.locator(".knowledge-cards .workshop-project-card");
  await expect(cards).toHaveCount(examples.length);
  const longCard = cards.filter({
    has: page.getByRole("heading", { name: libraries[3].title, exact: true }),
  });
  await expect(longCard.locator("p")).toHaveText(examples[3].description);
  await expect(cards.filter({ hasText: "空简介" }).locator("p")).toHaveText(
    "一个属于你的知识空间",
  );

  for (const { width, columns } of [
    { width: 1600, columns: 4 },
    { width: 1280, columns: 3 },
    { width: 768, columns: 2 },
    { width: 390, columns: 1 },
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await setThoughtTheme(page, theme);
      await expectAlignedCards(page, columns);
      const preview = await longCard.locator("p").evaluate((el) => ({
        height: el.getBoundingClientRect().height,
        lineHeight: parseFloat(getComputedStyle(el).lineHeight),
        fullHeight: el.scrollHeight,
      }));
      expect(Math.abs(preview.height - preview.lineHeight * 4)).toBeLessThan(1);
      expect(preview.fullHeight).toBeGreaterThan(preview.height);
      const title = cards.filter({ hasText: libraries[4].title }).locator("h2");
      await expect(title).toHaveText(libraries[4].title);
      const titlePreview = await title.evaluate((el) => ({
        height: el.getBoundingClientRect().height,
        lineHeight: parseFloat(getComputedStyle(el).lineHeight),
        fullHeight: el.scrollHeight,
      }));
      expect(
        Math.abs(titlePreview.height - titlePreview.lineHeight * 2),
      ).toBeLessThan(1);
      expect(titlePreview.fullHeight).toBeGreaterThan(titlePreview.height);
      await page.locator(".knowledge-main").evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.screenshot({
        path: info.outputPath(`library-${width}-${theme}.png`),
        animations: "disabled",
      });

      const more = cards.filter({ hasText: "短标题" }).getByRole("combobox");
      await more.focus();
      await page.keyboard.press("ArrowDown");
      const menu = page.getByRole("listbox", {
        name: `${libraries[0].title}操作`,
        exact: true,
      });
      await expect(
        menu.getByRole("option", { name: "重命名", exact: true }),
      ).toBeFocused();
      const box = (await menu.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(1000);
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(more).toBeFocused();
    }
  }

  await cards
    .filter({ hasText: "短标题" })
    .getByRole("button", { name: "进入知识库", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/knowledge-bases/${libraries[0].id}$`),
  );
  await expect(
    page.getByRole("button", { name: "编辑首页", exact: true }),
  ).toBeVisible();

  for (const library of libraries)
    await write(
      page,
      `${root}/${library.id}?expected_revision=${library.revision}`,
      undefined,
      "DELETE",
    );
  await page.goto("/apps/thought-workshop");
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole("button", { name: "知识库回收站", exact: true }).click();
  await page
    .getByRole("textbox", { name: "搜索知识库", exact: true })
    .fill(marker);
  await expect(cards).toHaveCount(examples.length);
  await expectAlignedCards(page, 4);
  await page.setViewportSize({ width: 390, height: 1000 });
  await expectAlignedCards(page, 1);
  await page.screenshot({
    path: info.outputPath("library-trash-390-dark.png"),
    animations: "disabled",
  });
  await cards
    .filter({ hasText: "短标题" })
    .getByRole("button", { name: "恢复知识库", exact: true })
    .click();
  await expect(cards).toHaveCount(examples.length - 1);
});
