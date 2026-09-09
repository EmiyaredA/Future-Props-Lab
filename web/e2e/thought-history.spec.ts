import { expect, test } from "@playwright/test";
import { setThoughtTheme } from "./thought-helpers";

test("document autosave, visible save controls, inline history and safe restore", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.goto("/apps/thought-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const projectResponse = await page.request.post(
    "/v1/thought-workshop/knowledge-bases",
    { headers, data: { title: "文档历史验收" } },
  );
  expect(projectResponse.ok()).toBeTruthy();
  const project = await projectResponse.json();
  const para = (text: string) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  });
  const initial = await page.request.post("/v1/thought-workshop/notes", {
    headers,
    data: {
      title: "Claude Code · 使用笔记",
      knowledge_base_id: project.id,
      expected_knowledge_revision: project.revision,
      document: {
        type: "doc",
        content: [
          para("记录命令行开发工具的使用方法，以及值得保留的实践经验。"),
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "工作习惯" }],
          },
          para("先理解需求，再开始修改。"),
          {
            type: "bulletList",
            content: ["阅读项目说明", "确认修改范围", "验证关键行为"].map(
              (text) => ({ type: "listItem", content: [para(text)] }),
            ),
          },
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "实践记录" }],
          },
          ...Array.from({ length: 12 }, (_, i) =>
            para(
              `第 ${i + 1} 条记录：让每一次修改都有清晰的目的，并为后续维护留下足够的信息。`,
            ),
          ),
        ],
      },
    },
  });
  expect(initial.ok()).toBeTruthy();
  let note = await initial.json();
  const path = `/v1/thought-workshop/notes/${note.id}`;
  const url = `/apps/thought-workshop/knowledge-bases/${project.id}/documents/${note.id}`;
  await page.goto(url);
  const title = page.getByRole("textbox", { name: "笔记标题", exact: true });
  const prose = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await expect(title).toHaveValue("Claude Code · 使用笔记");
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeVisible();
  await prose.locator("p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Verification complete.");
  await expect(page.getByText(/^已保存 ·/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeInViewport();
  await page.reload();
  await expect(prose).toContainText("Verification complete.");
  await prose
    .locator("p")
    .filter({ hasText: /^先理解需求/ })
    .click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("修改完成后，检查结果并记录原因。");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText(/^已保存 ·/)).toBeVisible();
  await page.getByRole("button", { name: "历史记录", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "历史文档预览" }),
  ).toBeVisible();
  await expect(prose).toHaveAttribute("contenteditable", "false");
  await expect(page.getByRole("group", { name: "排版工具栏" })).toHaveCount(0);
  await expect(page.locator(".thought-history-change").first()).toBeVisible();
  for (const width of [1600, 1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const theme of ["light", "dark"]) {
      await setThoughtTheme(page, theme);
      await page
        .getByRole("button", { name: "下一处修改", exact: true })
        .click();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 2,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: info.outputPath(`history-${width}-${theme}.png`),
        animations: "disabled",
      });
    }
  }
  await page.getByRole("button", { name: "记录", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "历史记录" })).toBeVisible();
  await page.screenshot({
    path: info.outputPath("history-mobile-list.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole("switch", { name: "显示更改" }).click();
  await expect(page.locator(".thought-history-change")).toHaveCount(0);
  await page.locator(".thought-history-row").last().click();
  await expect(
    page.getByRole("button", { name: "还原此记录", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "还原此记录", exact: true }).click();
  await page.getByRole("button", { name: "还原", exact: true }).click();
  await expect(title).toHaveValue("Claude Code · 使用笔记");
  await expect(prose).not.toContainText("Verification complete.");
  note = await (await page.request.get(path)).json();
  expect(note.document.content[2].content[0].text).toBe(
    "先理解需求，再开始修改。",
  );
  // A failure must keep the draft and the leave prompt; retry navigates once.
  let failing = true,
    puts = 0;
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    puts++;
    if (failing)
      return route.fulfill({ status: 503, json: { detail: "暂时无法保存" } });
    return route.continue();
  });
  await title.fill("不能丢失的草稿");
  await page.getByRole("button", { name: "知识库", exact: true }).click();
  const leave = page.getByRole("alertdialog", { name: "仍有未保存的内容" });
  await expect(leave).toBeVisible();
  await expect(title).toHaveValue("不能丢失的草稿");
  await leave.getByRole("button", { name: "重试保存并离开" }).click();
  await expect(leave).toBeVisible();
  failing = false;
  await leave.getByRole("button", { name: "重试保存并离开" }).click();
  await expect(leave).not.toBeVisible();
  await expect(page).not.toHaveURL(new RegExp(`${note.id}$`));
  expect(puts).toBeGreaterThanOrEqual(3);
  await page.goto(url);
  await expect(title).toHaveValue("不能丢失的草稿");
});
