import { expect, test, type Page } from "@playwright/test";

const title = "语音 Agent Harness 评估体系：指标、研究依据与实践";
const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const heading = (text: string, level = 2) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const document = {
  type: "doc",
  content: [
    paragraph("版本：2.0 ｜ 面向：产品、算法与工程团队"),
    paragraph(
      "本文整理语音交互的评估框架与测量方法。使用右侧多级目录浏览章节，点击章节即可定位正文；目录不会修改文档内容。",
    ),
    heading("1. 评估框架与证据分类"),
    paragraph(
      "语音输入下的回答能力、实时会话行为、完整任务结果是不同的评估对象。先明确目标、约束与必要动作，再选择对应的指标。",
    ),
    heading("1.1 对象与问题", 3),
    paragraph(
      "单个模型关注识别和理解能力；完整系统关注任务完成情况。每一类结论都需要适用的证据。",
    ),
    heading("1.2 使用边界", 3),
    paragraph("指标必须结合使用场景解释，不能将不同任务的分数直接互换。"),
    heading("2. 产品实践与测量方法"),
    ...Array.from({ length: 18 }, (_, index) => [
      heading(
        `2.${index + 1} ${index ? "任务评估与实践记录" : "会话成功评价：自定义准则、结果判断与完整证据说明"}`,
        index === 2 ? 5 : 3,
      ),
      paragraph(
        "基于会话记录判断每项准则是否满足，保留成功、失败或未知状态及理由。人工评审与业务结果共同构成校验依据。",
      ),
    ]).flat(),
    {
      type: "details",
      attrs: { open: false },
      content: [
        {
          type: "detailsSummary",
          content: [{ type: "text", text: "附录（折叠内容）" }],
        },
        {
          type: "detailsContent",
          content: [
            heading("3. 折叠中的参考资料"),
            paragraph("此处仅临时展开，不保存折叠状态。"),
          ],
        },
      ],
    },
    heading("4. 总结"),
    paragraph("让评估服务于真实问题，保留证据边界和不确定性。"),
  ],
};

async function fixture(page: Page) {
  await page.goto("/apps/thought-workshop");
  await expect(
    page.getByRole("heading", { name: "我的知识库", exact: true, level: 1 }),
  ).toBeVisible();
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const projectResponse = await page.request.post(
    "/v1/thought-workshop/knowledge-bases",
    { headers, data: { title: "Agent Harness" } },
  );
  expect(projectResponse.ok()).toBe(true);
  const project = await projectResponse.json();
  const response = await page.request.post("/v1/thought-workshop/notes", {
    headers,
    data: {
      title,
      document,
      knowledge_base_id: project.id,
      expected_knowledge_revision: project.revision,
    },
  });
  expect(response.ok()).toBe(true);
  const note = await response.json();
  await page.goto(
    `/apps/thought-workshop/knowledge-bases/${project.id}/documents/${note.id}`,
  );
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue(title);
  return { note, project, headers };
}

test("docked outline, chapter tracking, temporary reveal, themes and no saves", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { note } = await fixture(page);
  const outline = page.getByRole("navigation", { name: "文档章节" });
  const prose = page.getByRole("textbox", { name: "笔记正文", exact: true });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/notes/"))
      writes.push(request.url());
  });
  await expect(outline).toBeVisible();
  const original = (await prose.boundingBox())!;
  const bounds = (await outline.boundingBox())!;
  expect(bounds.x).toBeGreaterThan(original.x + original.width);
  expect(bounds.width).toBeLessThanOrEqual(220);
  await expect(
    page.locator(".knowledge-topbar").getByRole("button", { name: "文内查找" }),
  ).toBeVisible();
  await expect(page.locator(".thought-document-tools")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(outline).toBeVisible();
  await expect
    .poll(async () => (await outline.boundingBox())!.width)
    .toBeLessThanOrEqual(220);
  await page.setViewportSize({ width: 900, height: 1000 });
  await expect(outline).toBeHidden();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(outline).toBeVisible();
  const resize = page.getByRole("separator", { name: "调整知识库导航宽度" });
  await page.setViewportSize({ width: 1300, height: 1000 });
  await expect(outline).toBeVisible();
  await resize.focus();
  for (let step = 0; step < 5; step++)
    await page.keyboard.press("Shift+ArrowRight");
  await expect(outline).toBeHidden();
  await expect(
    page.getByRole("textbox", { name: "笔记正文", exact: true }),
  ).toBeVisible();
  await resize.dblclick();
  await expect(outline).toBeVisible();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect
    .poll(() => outline.evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBe(true);
  await page.getByRole("button", { name: "收起文档大纲" }).click();
  await expect(outline).toBeHidden();
  expect((await prose.boundingBox())!.width).toBeLessThanOrEqual(820);
  await page.getByRole("button", { name: "文档大纲", exact: true }).click();
  await outline
    .getByRole("button", { name: "2. 产品实践与测量方法", exact: true })
    .click();
  await expect(
    outline.getByRole("button", { name: "2. 产品实践与测量方法", exact: true }),
  ).toHaveAttribute("aria-current", "location");
  const chapter = (await prose
    .getByRole("heading", { name: "2. 产品实践与测量方法", exact: true })
    .boundingBox())!;
  const toolbar = (await page.locator(".knowledge-topbar").boundingBox())!;
  expect(chapter.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
  expect(chapter.y).toBeLessThan(toolbar.y + toolbar.height + 40);
  await page.mouse.move(original.x + 100, 700);
  await page.mouse.wheel(0, 500);
  await expect(outline.locator('[aria-current="location"]')).not.toHaveText(
    "2. 产品实践与测量方法",
  );
  await outline
    .getByRole("button", { name: "收起2. 产品实践与测量方法的子章节" })
    .click();
  await expect(
    outline.getByRole("button", {
      name: "2.2 任务评估与实践记录",
      exact: true,
    }),
  ).toBeHidden();
  await page.locator(".knowledge-main").evaluate((main) => {
    const target = main.querySelectorAll(".thought-prose h3")[3];
    main.scrollTop +=
      target.getBoundingClientRect().top -
      main.querySelector(".knowledge-topbar")!.getBoundingClientRect().bottom -
      16;
  });
  await expect(
    outline.getByRole("button", { name: "收起2. 产品实践与测量方法的子章节" }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    prose.getByRole("heading", { name: "3. 折叠中的参考资料" }),
  ).toBeHidden();
  await outline.getByRole("button", { name: "3. 折叠中的参考资料" }).click();
  await expect(
    prose.getByRole("heading", { name: "3. 折叠中的参考资料" }),
  ).toBeVisible();
  await prose.locator('[data-type="details"] > button').click();
  await expect(
    prose.getByRole("heading", { name: "3. 折叠中的参考资料" }),
  ).toBeHidden();
  await page.evaluate(() =>
    document
      .querySelector(".knowledge-main")!
      .scrollTo(0, document.querySelector(".knowledge-main")!.scrollHeight),
  );
  await expect(
    outline.getByRole("button", { name: "4. 总结", exact: true }),
  ).toHaveAttribute("aria-current", "location");
  await outline.getByRole("button", { name: "概览", exact: true }).click();
  await page.mouse.move(1500, 100);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.screenshot({
      path: info.outputPath(`outline-wide-${theme}.png`),
    });
  }
  await expect(outline).toBeVisible();
  expect(writes).toEqual([]);
  const saved = await (
    await page.request.get(`/v1/thought-workshop/notes/${note.id}`)
  ).json();
  expect(saved.revision).toBe(note.revision);
  expect(saved.document).toEqual(note.document);
});

test("compact popover, keyboard, empty outline, home and read-only", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const { note, project, headers } = await fixture(page);
  for (const width of [900, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const directory = page.getByRole("button", {
      name: "笔记目录",
      exact: true,
    });
    await expect(directory).toBeVisible();
    await directory.click();
    await expect(
      page.getByRole("dialog", { name: "知识库导航" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    const trigger = page.getByRole("button", { name: "文档大纲", exact: true });
    const popup = page.getByRole("dialog", { name: "文档大纲", exact: true });
    await trigger.click();
    await expect(popup).toBeVisible();
    const bounds = (await popup.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(12);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 12);
    await page.keyboard.press("Tab");
    await expect(
      popup.getByRole("button", { name: "概览", exact: true }),
    ).toBeFocused();
    await page.screenshot({
      path: info.outputPath(`outline-compact-${width}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(popup).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await popup
      .getByRole("button", { name: "2. 产品实践与测量方法", exact: true })
      .click();
    await expect(popup).toBeHidden();
    await expect(trigger).toBeFocused();
    const chapter = await page
      .getByRole("textbox", { name: "笔记正文", exact: true })
      .getByRole("heading", { name: "2. 产品实践与测量方法", exact: true })
      .boundingBox();
    const launcher = (await trigger.boundingBox())!;
    expect(chapter!.y).toBeGreaterThanOrEqual(launcher.y + launcher.height + 8);
    await trigger.click();
    await page.mouse.click(width - 8, 850);
    await expect(popup).toBeHidden();
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(
    page.getByRole("navigation", { name: "文档章节" }),
  ).toBeVisible();
  // The home note opens in the editor and has no headings until one is saved.
  await page.goto(`/apps/thought-workshop/knowledge-bases/${project.id}`);
  await expect(page.getByLabel("笔记标题", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "文档大纲", exact: true }).click();
  await expect(page.getByText("使用标题样式生成文档目录")).toBeVisible();
  await page.keyboard.press("Escape");
  const home = await (
    await page.request.get(`/v1/thought-workshop/notes/${project.home_note_id}`)
  ).json();
  const updated = await page.request.put(
    `/v1/thought-workshop/notes/${home.id}`,
    {
      headers,
      data: {
        title: home.title,
        document,
        knowledge_base_id: project.id,
        expected_revision: home.revision,
      },
    },
  );
  expect(updated.ok()).toBe(true);
  await page.reload();
  await expect(
    page.getByRole("navigation", { name: "文档章节" }),
  ).toBeVisible();
  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.permission_keys = ["content.read"];
    await route.fulfill({ json: body });
  });
  await page.goto(
    `/apps/thought-workshop/knowledge-bases/${project.id}/documents/${note.id}`,
  );
  await expect(
    page.getByRole("textbox", { name: "笔记正文", exact: true }),
  ).toHaveAttribute("contenteditable", "false");
  const trigger = page.getByRole("button", { name: "文档大纲", exact: true });
  await expect(trigger).toBeVisible();
  if ((await trigger.getAttribute("aria-expanded")) !== "true")
    await trigger.click();
  await expect(
    page.getByRole("navigation", { name: "文档章节" }),
  ).toBeVisible();
});
