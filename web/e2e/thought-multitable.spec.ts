import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
import fs from "node:fs/promises";
import { setResponsiveTheme } from "./responsive-capture";
const root = "/v1/thought-workshop";
async function write(
  context: BrowserContext,
  path: string,
  data: unknown,
  method = "POST",
) {
  const response = await context.request.fetch(path, {
    method,
    data,
    headers: {
      Origin: `http://127.0.0.1:${process.env.FPL_E2E_WEB_PORT || "3000"}`,
      "X-CSRF-Token":
        (await context.cookies()).find((c) => c.name === "fpl_csrf")?.value ||
        "",
    },
  });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response;
}
async function choose(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function saved(page: Page) {
  await expect(
    page.locator(".multitable-heading").getByRole("status"),
  ).toHaveText("已保存");
}
async function cell(page: Page, name: string, value: string) {
  await page
    .getByRole("button", { name: `编辑 ${name}`, exact: true })
    .first()
    .click();
  const modal = page.getByRole("dialog", { name: `编辑 ${name}`, exact: true });
  await modal.getByRole("textbox", { name, exact: true }).fill(value);
  await modal.getByRole("button", { name: "完成", exact: true }).click();
}
test("多表、三视图、正文独立保存、CSV 和完整备份", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/apps/thought-workshop");
  const kb = await (
    await write(page.context(), root + "/knowledge-bases", {
      title: "表格验收",
    })
  ).json();
  await page.goto(`/apps/thought-workshop/knowledge-bases/${kb.id}`);
  await page
    .getByRole("button", { name: "新建文档", exact: true })
    .and(page.locator('[aria-haspopup="menu"]'))
    .click();
  await page.getByRole("menuitem", { name: "多维表格", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "多维表格", exact: true }),
  ).toBeVisible();
  const noteId = page.url().split("/").at(-1)!;
  const base = root + `/notes/${noteId}/multitable`;
  await page.getByRole("button", { name: "新增记录", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "记录详情", exact: true }),
  ).toBeVisible();
  await cell(page, "名称", "中文任务");
  await choose(page, "状态", "进行中");
  await page.keyboard.press("Escape");
  await saved(page);
  await page.getByRole("button", { name: "字段", exact: true }).click();
  await page.getByRole("button", { name: /新增字段/ }).click();
  await page.getByLabel("字段 5 名称", { exact: true }).fill("预算");
  await choose(page, "预算类型", "数字");
  await page.getByRole("button", { name: "预览字段变更", exact: true }).click();
  await page.getByRole("button", { name: "确认保存字段", exact: true }).click();
  await saved(page);
  await page.getByRole("button", { name: "新建数据表", exact: true }).click();
  await saved(page);
  await page.getByRole("button", { name: "数据表 1", exact: true }).click();
  const beforeCancelledView = (await (await page.request.get(base)).json())
    .revision;
  await page.getByRole("button", { name: "新建视图", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect((await (await page.request.get(base)).json()).revision).toBe(
    beforeCancelledView,
  );
  for (const [name, type, fieldLabel, field] of [
    ["任务看板", "看板", "看板分栏字段", "状态"],
    ["任务日历", "日历", "日历日期字段", "截止日期"],
  ]) {
    await page.getByRole("button", { name: "新建视图", exact: true }).click();
    await page.getByLabel("视图名称", { exact: true }).fill(name);
    await choose(page, "视图类型", type);
    await choose(page, fieldLabel, field);
    await page.getByRole("button", { name: "保存视图", exact: true }).click();
    await saved(page);
  }
  await expect(page.locator(".multitable-calendar")).toBeVisible();
  await page.getByRole("tab", { name: "任务看板", exact: true }).click();
  await expect(
    page.locator(".multitable-card").filter({ hasText: "中文任务" }),
  ).toBeVisible();
  await page
    .locator(".multitable-card")
    .filter({ hasText: "中文任务" })
    .dragTo(
      page
        .locator(".multitable-lane")
        .filter({ has: page.getByRole("heading", { name: /已完成/ }) }),
    );
  await saved(page);
  await page.getByRole("tab", { name: "表格", exact: true }).click();
  await page.getByRole("tab", { name: "任务日历", exact: true }).click();
  await page
    .locator(".multitable-day:not(.is-outside) .multitable-day-add")
    .nth(2)
    .click();
  await cell(page, "名称", "月历任务");
  await page.keyboard.press("Escape");
  await saved(page);
  const nextDay = page.locator(".multitable-day:not(.is-outside)").nth(3);
  const targetDate = await nextDay.getAttribute("data-date");
  await page
    .locator(".multitable-event")
    .filter({ hasText: "月历任务" })
    .dragTo(nextDay);
  await saved(page);
  await expect(
    nextDay.getByRole("button", { name: "月历任务", exact: true }),
  ).toBeVisible();
  const calendarTable = (await (await page.request.get(base)).json()).tables[0];
  const calendarRecords = await (
    await write(page.context(), base + `/tables/${calendarTable.id}/query`, {})
  ).json();
  expect(
    calendarRecords.items.find(
      (r: { values: Record<string, unknown> }) =>
        r.values[calendarTable.fields[0].id] === "月历任务",
    ).values[calendarTable.fields[2].id],
  ).toBe(targetDate);
  await page.getByRole("tab", { name: "表格", exact: true }).click();
  await page.getByRole("button", { name: "多维表格更多操作" }).click();
  await page.getByRole("menuitem", { name: "导入 CSV", exact: true }).click();
  await page.getByLabel("选择 CSV", { exact: true }).setInputFiles({
    name: "tasks.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("名称,状态\nCSV 任务,已完成\n"),
  });
  await page
    .getByRole("button", { name: "预览和字段映射", exact: true })
    .click();
  await expect(page.getByText("共 1 条记录，预览前 1 条。")).toBeVisible();
  await page
    .getByRole("button", { name: "校验类型与映射", exact: true })
    .click();
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(
    page
      .getByRole("button", { name: "编辑 名称", exact: true })
      .filter({ hasText: "CSV 任务" }),
  ).toBeVisible();
  const resizeHandle = page.getByRole("separator", { name: "调整名称列宽" });
  await resizeHandle.focus();
  await page.keyboard.press("ArrowRight");
  await expect(resizeHandle).toHaveAttribute("aria-valuenow", "340");
  await saved(page);
  const box = (await resizeHandle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2);
  await page.mouse.up();
  await expect(resizeHandle).toHaveAttribute("aria-valuenow", "380");
  await saved(page);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "多维表格更多操作" }).click();
  await page
    .getByRole("menuitem", { name: "导出全部记录", exact: true })
    .click();
  const download = await downloading;
  const data = await fs.readFile((await download.path())!, "utf8");
  expect(data).toContain("CSV 任务");
  await page.reload();
  await expect(
    page.getByRole("separator", { name: "调整名称列宽" }),
  ).toHaveAttribute("aria-valuenow", "380");
  await expect(
    page
      .getByRole("button", { name: "编辑 名称", exact: true })
      .filter({ hasText: "中文任务" }),
  ).toBeVisible();
  const s = await (await page.request.get(base)).json();
  const table = s.tables[0];
  const parent = await (
    await write(page.context(), root + "/notes", {
      knowledge_base_id: kb.id,
      expected_knowledge_revision: (
        await (
          await page.request.get(root + `/knowledge-bases/${kb.id}`)
        ).json()
      ).revision,
      title: "嵌入表格",
      document: {
        type: "doc",
        content: [
          {
            type: "multitableView",
            attrs: { noteId, tableId: table.id, viewId: table.views[0].id },
          },
        ],
      },
    })
  ).json();
  await page.goto(
    `/apps/thought-workshop/knowledge-bases/${kb.id}/documents/${parent.id}`,
  );
  await expect(page.locator(".multitable-embed")).toBeVisible();
  await cell(page, "名称", "正文修改任务");
  await expect
    .poll(
      async () =>
        (
          await (
            await write(page.context(), base + `/tables/${table.id}/query`, {})
          ).json()
        ).items[0].values[table.fields[0].id],
    )
    .toBe("正文修改任务");
  expect(
    (await (await page.request.get(root + `/notes/${parent.id}`)).json())
      .revision,
  ).toBe(parent.revision);
  const archive = await (
    await page.request.get(root + "/backup?knowledge_base_id=" + kb.id)
  ).body();
  const files = unzipSync(archive);
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  expect(manifest.version).toBe(7);
  expect(manifest.multitables[noteId].state.tables).toHaveLength(2);
  expect(manifest.multitables[noteId].history.length).toBeGreaterThan(3);
  const imported = await page.request.post(root + "/imports", {
    multipart: {
      upload: {
        name: "backup.zip",
        mimeType: "application/zip",
        buffer: archive,
      },
    },
    headers: {
      "X-CSRF-Token": (await page.context().cookies()).find(
        (c) => c.name === "fpl_csrf",
      )!.value,
      Origin: `http://127.0.0.1:${process.env.FPL_E2E_WEB_PORT || "3000"}`,
    },
  });
  expect(imported.ok(), await imported.text()).toBeTruthy();
  await page.goto(
    `/apps/thought-workshop/knowledge-bases/${kb.id}/documents/${noteId}`,
  );
  await expect(
    page.getByRole("columnheader", { name: "名称", exact: true }),
  ).toHaveCSS("position", "sticky");
  for (const width of [1600, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await setResponsiveTheme(page, theme);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        )
        .toBeTruthy();
      await expect(
        page.getByRole("button", { name: "新增记录", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "新增记录", exact: true }),
      ).toHaveClass(/primary/);
      if (width === 390) {
        const gridWidth = await page
          .getByRole("region", { name: "表格记录" })
          .evaluate((el) => el.clientWidth);
        const nameWidth = await page
          .getByRole("columnheader", { name: "名称", exact: true })
          .evaluate((el) => el.getBoundingClientRect().width);
        expect(nameWidth).toBeLessThanOrEqual(gridWidth / 2 + 1);
      }
      const directory = process.env.FPL_MULTITABLE_PREVIEWS;
      if (directory)
        await page.screenshot({
          path: `${directory}/grid-${width}-${theme}.png`,
          animations: "disabled",
        });
      if (width === 1600 || width === 390) {
        await page
          .getByRole("button", { name: "打开记录 1", exact: true })
          .click();
        await expect(
          page.getByRole("dialog", { name: "记录详情", exact: true }),
        ).toHaveClass(/is-drawer/);
        if (directory)
          await page.screenshot({
            path: `${directory}/detail-${width}-${theme}.png`,
            animations: "disabled",
          });
        await page
          .getByRole("dialog", { name: "记录详情", exact: true })
          .getByRole("button", { name: "关闭", exact: true })
          .click();
      }
      for (const [name, className, fileName] of [
        ["任务看板", ".multitable-board", "kanban"],
        ["任务日历", ".multitable-calendar", "calendar"],
      ]) {
        await page.getByRole("tab", { name, exact: true }).click();
        await expect(page.locator(className)).toBeVisible();
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          )
          .toBeTruthy();
        await expect(
          page.getByRole("textbox", { name: "搜索记录" }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "新增记录", exact: true }),
        ).toBeVisible();
        if (directory)
          await page.screenshot({
            path: `${directory}/${fileName}-${width}-${theme}.png`,
            animations: "disabled",
          });
      }
      await page.getByRole("tab", { name: "表格", exact: true }).click();
      await expect(
        page.getByRole("region", { name: "表格记录" }),
      ).toBeVisible();
    }
  }
});

test("5,000 条记录与 50 字段分页、虚拟滚动及键盘批量粘贴", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("/apps/thought-workshop");
  const kb = await (
    await write(page.context(), root + "/knowledge-bases", {
      title: "容量验收",
    })
  ).json();
  const note = await (
    await write(page.context(), root + "/notes", {
      knowledge_base_id: kb.id,
      expected_knowledge_revision: kb.revision,
      title: "大表",
      kind: "multitable",
    })
  ).json();
  const base = root + `/notes/${note.id}/multitable`;
  const s = await (await page.request.get(base)).json(),
    table = s.tables[0];
  table.fields = Array.from({ length: 50 }, (_, i) => ({
    id: i === 0 ? table.fields[0].id : crypto.randomUUID(),
    name: i ? `字段 ${i}` : "名称",
    type: i === 1 ? "number" : "text",
    position: i,
    options: [],
  }));
  const records = Array.from({ length: 5000 }, (_, i) => ({
    id: crypto.randomUUID(),
    position: i,
    values: Object.fromEntries(
      table.fields.map((f: { id: string }, j: number) => [
        f.id,
        j === 1 ? i : `行 ${i} 列 ${j}`,
      ]),
    ),
  }));
  await write(page.context(), base + "/operations", {
    expected_revision: 0,
    operations: [
      { op: "table.put", table },
      { op: "records.put", table_id: table.id, records },
    ],
  });
  await page.goto(
    `/apps/thought-workshop/knowledge-bases/${kb.id}/documents/${note.id}`,
  );
  await expect(page.getByText(/已加载 100 \/ 5000 条记录/)).toBeVisible();
  const cells = page.getByRole("gridcell");
  expect(await cells.count()).toBeLessThan(2000);
  await cells.first().dispatchEvent("mousedown");
  // Browser ClipboardEvent uses a real DataTransfer so quoted TSV exercises the UI.
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "批量中文\t123\n第二行\t456");
    document.querySelector(".multitable-grid-scroll")!.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  });
  await saved(page);
  await expect(
    page.getByRole("button", { name: "编辑 名称", exact: true }).first(),
  ).toHaveText("批量中文");
  await cells.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(cells.nth(1)).toBeFocused();
  await page.getByRole("region", { name: "表格记录" }).evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect
    .poll(async () =>
      Number(
        (await page.locator(".multitable-footer").innerText()).match(
          /已加载 (\d+)/,
        )![1],
      ),
    )
    .toBeGreaterThan(100);
  expect(await cells.count()).toBeLessThan(2500);
});

test("断网保留操作、刷新恢复，以及第二标签页冲突", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await page.goto("/apps/thought-workshop");
  const kb = await (
    await write(context, root + "/knowledge-bases", { title: "恢复验收" })
  ).json();
  const note = await (
    await write(context, root + "/notes", {
      knowledge_base_id: kb.id,
      expected_knowledge_revision: kb.revision,
      title: "恢复表",
      kind: "multitable",
    })
  ).json();
  const url = `/apps/thought-workshop/knowledge-bases/${kb.id}/documents/${note.id}`;
  await page.goto(url);
  await page.route("**/multitable/operations", (route) =>
    route.abort("internetdisconnected"),
  );
  await page.getByRole("button", { name: "新增记录", exact: true }).click();
  await cell(page, "名称", "离线保留");
  await page.keyboard.press("Escape");
  await expect(
    page.locator(".multitable-heading").getByRole("status"),
  ).toHaveText("保存失败");
  await page.unroute("**/multitable/operations");
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByText(/发现 1 份未保存草稿/)).toBeVisible();
  await page.getByRole("button", { name: /^恢复 \d/ }).click();
  await saved(page);
  await expect(
    page
      .getByRole("button", { name: "编辑 名称", exact: true })
      .filter({ hasText: "离线保留" }),
  ).toBeVisible();
  const second = await context.newPage();
  await second.goto(url);
  await expect(
    second.getByRole("button", { name: "编辑 名称", exact: true }),
  ).toBeVisible();
  await second.route("**/multitable/operations", async (route) => {
    const body = route.request().postDataJSON();
    body.expected_revision = 0;
    await route.continue({ postData: JSON.stringify(body) });
  });
  await cell(second, "名称", "冲突保留");
  await expect(
    second.locator(".multitable-heading").getByRole("status"),
  ).toHaveText("保存冲突");
  await expect(
    second.getByRole("button", { name: "丢弃本机修改", exact: true }),
  ).toBeVisible();
  await second
    .getByRole("button", { name: "核对服务器版本", exact: true })
    .click();
  await expect(
    second.getByRole("dialog", { name: "服务器表格版本", exact: true }),
  ).toContainText("离线保留");
  await second
    .getByRole("dialog", { name: "服务器表格版本", exact: true })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await expect(
    second
      .getByRole("button", { name: "编辑 名称", exact: true })
      .filter({ hasText: "冲突保留" }),
  ).toHaveCount(0);
  await second.close();
});
