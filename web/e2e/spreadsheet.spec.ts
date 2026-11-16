import { expect, test, type Page } from "@playwright/test";

type Workbook = {
  id: string;
  title: string;
  revision: number;
  calculation: string;
  created_at: string;
  updated_at: string;
  source_name?: string;
  document: { schema_version: number; sheets: Record<string, unknown>[] };
};

async function workbookApi(page: Page) {
  const projects = new Map<string, Workbook>();
  const receipts = new Map<string, Workbook>();
  let next = 0;
  let loseReply = false;
  await page.route("**/v1/spreadsheet-workshop/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const suffix = url.pathname.replace("/v1/spreadsheet-workshop", "");
    const method = request.method();
    const body =
      method === "POST" || method === "PUT" ? request.postDataJSON() : null;
    const json = (value: unknown, status = 200) =>
      route.fulfill({ status, json: value });
    if (suffix === "/projects" && method === "GET")
      return json({
        total: projects.size,
        items: [...projects.values()].map((project) =>
          Object.fromEntries(
            Object.entries(project).filter(([field]) => field !== "document"),
          ),
        ),
      });
    if (suffix === "/projects" && method === "POST") {
      const value: Workbook = {
        id: `test-${++next}`,
        title: body.title,
        revision: 0,
        calculation: "not_needed",
        created_at: "2026-11-16T12:00:00Z",
        updated_at: "2026-11-16T12:00:00Z",
        document: body.document || {
          schema_version: 1,
          sheets: [
            {
              id: "sheet-1",
              name: "工作表1",
              row: 100,
              column: 26,
              celldata: [],
              config: {},
              order: 0,
              status: 1,
            },
          ],
        },
      };
      projects.set(value.id, value);
      return json(value);
    }
    const id = suffix.split("/")[2];
    const project = projects.get(id);
    if (project && suffix.endsWith("/export"))
      return route.fulfill({
        contentType: "application/octet-stream",
        body: "file",
      });
    if (project && method === "GET") return json(project);
    if (project && method === "PUT") {
      if (receipts.has(body.request_id))
        return json(receipts.get(body.request_id));
      if (project.revision !== body.expected_revision)
        return json(
          {
            code: "revision_conflict",
            detail: "内容已被其他操作更新",
            current: project,
          },
          409,
        );
      const result = {
        ...project,
        ...body,
        calculation: "browser_calculated",
        revision: project.revision + 1,
      };
      projects.set(id, result);
      receipts.set(body.request_id, result);
      if (loseReply) {
        loseReply = false;
        return json(
          { detail: "确认丢失，请重试", code: "storage_unavailable" },
          503,
        );
      }
      return json(result);
    }
    if (project && method === "DELETE") {
      projects.delete(id);
      return json({ deleted: true });
    }
    return json({ code: "not_found", detail: "工作簿不存在" }, 404);
  });
  return {
    projects,
    loseNextReply: () => {
      loseReply = true;
    },
  };
}

test("spreadsheet editor calculates, saves, retries lost acknowledgements and protects conflicts", async ({
  page,
}, testInfo) => {
  const state = await workbookApi(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/apps/spreadsheet-workshop");
  await page.getByRole("button", { name: "新建工作簿", exact: true }).click();
  await expect(page.locator(".fortune-sheet-canvas")).toBeVisible();
  const title = page.getByRole("textbox", { name: "工作簿名称" });
  await title.fill("浏览器验收工作簿");
  await expect
    .poll(() => state.projects.get("test-1")?.title)
    .toBe("浏览器验收工作簿");
  const area = page.locator(".fortune-cell-area");
  const formula = page.getByLabel("当前单元格输入", { exact: true });
  await area.click({ position: { x: 15, y: 10 } });
  await formula.fill("10");
  await formula.press("Enter");
  await expect
    .poll(() => JSON.stringify(state.projects.get("test-1")?.document))
    .toContain('"v":10');
  await area.click({ position: { x: 15, y: 30 } });
  await formula.fill("=SUM(A1,5)");
  await formula.press("Enter");
  await expect
    .poll(() => JSON.stringify(state.projects.get("test-1")?.document))
    .toContain('"f":"=SUM(A1,5)"');
  await expect
    .poll(() => JSON.stringify(state.projects.get("test-1")?.document))
    .toContain('"v":15');
  state.loseNextReply();
  await title.fill("确认丢失后继续编辑");
  await expect(
    page.getByRole("button", { name: "重试保存", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已保存" }),
  ).toBeVisible();
  state.projects.get("test-1")!.revision++;
  await title.fill("保留冲突草稿");
  await expect(
    page.getByRole("button", { name: "另存副本", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "另存副本", exact: true }).click();
  await expect(title).toHaveValue("保留冲突草稿（副本）");
  await page.screenshot({
    path: testInfo.outputPath("spreadsheet-editor.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("spreadsheet has bounded responsive layouts in both themes", async ({
  page,
}, testInfo) => {
  await workbookApi(page);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    for (const theme of ["light", "dark"]) {
      await page.addInitScript(
        (value) => localStorage.setItem("future_props_theme", value),
        theme,
      );
      await page.goto("/apps/spreadsheet-workshop");
      await expect(
        page.getByRole("heading", { name: "我的工作簿", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "新建工作簿", exact: true })
        .click();
      await expect(page.locator(".fortune-sheet-canvas")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "导出", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`spreadsheet-${width}-${theme}.png`),
        fullPage: true,
      });
    }
  }
});
