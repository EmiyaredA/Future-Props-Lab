import { expect, test } from "@playwright/test";

test("manages and validates an integration across deep-link tabs", async ({
  page,
}) => {
  const toolApis: Array<Record<string, unknown>> = [];
  await page.route("**/v1/integrations/tool-apis", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const created = {
        ...body,
        id: "e2e-tool-api",
        has_secret: false,
        secret_hint: "",
        status: "unchecked",
        status_message: "",
        last_checked_at: null,
        revision: 0,
        created_at: "2026-08-23T10:00:00Z",
        updated_at: "2026-08-23T10:00:00Z",
      };
      toolApis.push(created);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(created),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items: toolApis,
        overview: {
          primary_count: toolApis.length,
          failed_count: 0,
          tertiary_count: 0,
          recent: [],
        },
      }),
    });
  });
  await page.route("**/v1/integrations/tool-apis/*/validate", async (route) => {
    const item = toolApis[0];
    if (item) {
      item.status = "healthy";
      item.status_message = "HTTP 200";
      item.last_checked_at = "2026-08-23T10:01:00Z";
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        check: {
          id: "e2e-check",
          resource_kind: "tool_api",
          resource_id: "e2e-tool-api",
          resource_name: "E2E 查询",
          ok: true,
          status_code: 200,
          latency_ms: 9,
          summary: "HTTP 200",
          created_at: "2026-08-23T10:01:00Z",
        },
        response_preview: '{"fixture":true}',
        content_type: "application/json",
      }),
    });
  });
  await page.route("**/v1/integrations/mcp", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items: [],
        overview: {
          primary_count: 0,
          failed_count: 0,
          tertiary_count: 0,
          recent: [],
        },
      }),
    }),
  );
  await page.route("**/v1/integrations/skills", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items: [],
        enabled_count: 0,
        draft_count: 0,
        version_count: 0,
      }),
    }),
  );

  await page.goto("/integrations/tool-apis");
  await expect(page.getByRole("heading", { name: "集成中心" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "集成中心", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  await page.getByRole("button", { name: "新建工具 API" }).click();
  await page.getByLabel("名称").fill("E2E 查询");
  await page
    .getByLabel("HTTPS 或本机回环 URL")
    .fill("https://api.example.com/query");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("heading", { name: "E2E 查询" })).toBeVisible();

  await page.getByRole("button", { name: "验证 E2E 查询" }).click();
  await page.getByRole("button", { name: "开始验证" }).click();
  await expect(page.getByText('{"fixture":true}')).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭" })
    .last()
    .click();

  const edit = page.getByRole("button", { name: "编辑 E2E 查询" });
  await edit.click();
  await page.getByLabel("名称", { exact: true }).fill("未提交草稿");
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("future-props:integration-change", {
        detail: ["tool-apis"],
      }),
    ),
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "继续编辑" }).click();
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue(
    "未提交草稿",
  );
  await expect(page.getByLabel("名称", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "放弃修改" }).click();
  await expect(edit).toBeFocused();
  await page.getByRole("button", { name: "处理完当前编辑后查看更新" }).click();
  expect(toolApis).toHaveLength(1);

  await page.getByRole("tab", { name: "MCP" }).click();
  await expect(page).toHaveURL(/\/integrations\/mcp$/);
  await expect(page.getByText("还没有 MCP 服务。")).toBeVisible();
  await page.getByRole("tab", { name: "Skill" }).click();
  await expect(page).toHaveURL(/\/integrations\/skills$/);
  await expect(
    page.getByText("还没有 Skill，上传 ZIP 后会先进行安全校验。"),
  ).toBeVisible();
});
