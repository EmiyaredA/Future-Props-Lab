import { expect, test } from "@playwright/test";
import { newDocument, saveNote } from "./thought-helpers";
import type { components } from "../src/generated/api";

for (const scenario of [
  { width: 1600, theme: "light" },
  { width: 1600, theme: "dark" },
  { width: 768, theme: "light" },
  { width: 768, theme: "dark" },
  { width: 390, theme: "light" },
  { width: 390, theme: "dark" },
]) {
  test(`external connections and article replacement ${scenario.width} ${scenario.theme}`, async ({
    page,
  }, info) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: scenario.width, height: 900 });
    await page.addInitScript(
      (theme) => localStorage.setItem("future_props_theme", theme),
      scenario.theme,
    );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let connection: components["schemas"]["ExternalConnectionOut"] | null =
      null;
    let binding: components["schemas"]["ArticleBindingOut"] | null = null;
    let tasks: components["schemas"]["ArticleSyncTaskOut"][] = [];
    let blocked = false;
    let changed = false;
    let sourceRevision = 0;
    const submissions: unknown[] = [];
    await page.route(
      "**/v1/integrations/external-connections**",
      async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        let result: unknown;
        if (path.endsWith("target-check"))
          result = {
            document_id: "testDoc",
            url: "https://demo.feishu.cn/docx/testDoc",
            title: "飞书专用文档",
            text: "待替换原正文",
            fingerprint: "remote",
            revision: 1,
            can_write: true,
          };
        else if (path.endsWith("check")) {
          connection!.status = "healthy";
          connection!.status_message = "鉴权通过；目标另验权限";
          result = connection;
        } else if (request.method() === "POST") {
          const body = request.postDataJSON();
          expect(body.app_secret).toBe("test-secret");
          connection = {
            id: "connection",
            name: body.name,
            app_id: body.app_id,
            provider: "feishu",
            enabled: true,
            has_secret: true,
            revision: 0,
            status: "unchecked",
            status_message: "",
            last_checked_at: null,
          };
          result = connection;
        } else result = { items: connection ? [connection] : [] };
        await route.fulfill({ status: 200, json: result });
      },
    );
    await page.route(
      "**/v1/thought-workshop/notes/*/external-sync**",
      async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        let result: unknown;
        if (path.endsWith("/binding") && request.method() === "PUT") {
          expect(request.postDataJSON().expected_revision).toBe(0);
          binding = {
            id: "binding",
            connection_id: "connection",
            url: "https://demo.feishu.cn/docx/testDoc",
            title: "飞书专用文档",
            revision: 0,
            last_note_revision: null,
            last_synced_at: null,
          };
          result = binding;
        } else if (path.endsWith("/binding") && request.method() === "DELETE") {
          binding = null;
          await route.fulfill({ status: 204 });
          return;
        } else if (path.endsWith("/preview")) {
          sourceRevision = request.postDataJSON().expected_revision;
          result = {
            preview_id: blocked ? null : "preview",
            note_revision: request.postDataJSON().expected_revision,
            target_title: "飞书专用文档",
            local_text: "本地文章\n文章正文",
            snapshot: [
              {
                kind: "heading",
                level: 1,
                runs: [{ text: "本地文章", link: "" }],
              },
              { kind: "text", runs: [{ text: "文章正文", link: "" }] },
            ],
            remote_text: changed ? "飞书外部修改" : "待替换原正文",
            warnings: ["提示框转为引用块"],
            blockers: blocked ? ["正文/第2块：暂不支持画板"] : [],
            first_sync: !tasks.length,
            remote_changed: changed,
          };
        } else if (path.endsWith("/reconcile")) {
          if (request.postDataJSON().acknowledge_partial) {
            tasks[0] = {
              ...tasks[0],
              status: "failed",
              message: "已核对并结束任务",
            };
          }
          result = {
            task: tasks[0],
            remote_text: "飞书仍保留部分新正文，需要人工核对",
            can_resume: false,
          };
        } else if (path.endsWith("/tasks") && request.method() === "POST") {
          const body = request.postDataJSON();
          expect(body.confirm_replace).toBe(true);
          expect(body.operation_id).toMatch(/^[a-f0-9-]{36}$/);
          submissions.push(body);
          tasks = [
            {
              id: "task",
              status: "succeeded",
              note_revision: sourceRevision,
              message: "同步完成",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              steps: [],
            },
          ];
          binding!.last_note_revision = sourceRevision;
          binding!.last_synced_at = new Date().toISOString();
          result = tasks[0];
        } else result = { binding, tasks };
        await route.fulfill({ status: 200, json: result });
      },
    );
    await page.goto("/integrations/external-connections");
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      scenario.theme,
    );
    await expect(
      page.getByRole("tab", { name: "外部连接", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("heading", {
        name: "添加你的第一个外部连接",
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("01-empty-connections.png"),
    });
    await page.getByRole("button", { name: "添加连接", exact: true }).click();
    const connectionDialog = page.getByRole("dialog", {
      name: "添加飞书连接",
      exact: true,
    });
    await expect(
      connectionDialog.locator('img[src="/providers/feishu-logo.svg"]'),
    ).toBeVisible();
    const closeSize = await connectionDialog
      .getByRole("button", { name: "关闭", exact: true })
      .boundingBox();
    expect(closeSize?.width).toBe(36);
    expect(closeSize?.height).toBe(36);
    await page.screenshot({ path: info.outputPath("02-add-connection.png") });
    await page.getByLabel("连接名称", { exact: true }).fill("文章发布");
    await page.getByLabel("App ID", { exact: true }).fill("cli_test");
    await page.getByLabel("App Secret", { exact: true }).fill("test-secret");
    await page.getByRole("button", { name: "保存连接", exact: true }).click();
    await page.getByRole("button", { name: "检查连接", exact: true }).click();
    await expect(page.getByText("鉴权通过；目标另验权限")).toBeVisible();
    await page.screenshot({ path: info.outputPath("03-connections.png") });
    await page.getByRole("button", { name: "管理", exact: true }).click();
    await expect(page.getByLabel("App Secret", { exact: true })).toHaveValue(
      "",
    );
    await page.screenshot({
      path: info.outputPath("04-manage-connection.png"),
    });
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.goto("/apps/thought-workshop");
    await newDocument(page);
    await page.getByLabel("笔记标题", { exact: true }).fill("同步验收文章");
    await page
      .getByRole("textbox", { name: "笔记正文", exact: true })
      .fill("文章正文");
    await saveNote(page);
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      scenario.theme,
    );
    await page.getByRole("button", { name: "同步到…", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "文章同步", exact: true });
    await expect(
      panel.getByRole("combobox", { name: "使用连接" }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath("05-bind-document.png") });
    await panel.getByRole("combobox", { name: "使用连接" }).click();
    await page.getByRole("option", { name: "文章发布", exact: true }).click();
    await panel
      .getByLabel("目标文档链接", { exact: true })
      .fill("https://demo.feishu.cn/docx/testDoc");
    await panel.getByRole("button", { name: "检查目标", exact: true }).click();
    await expect(panel.getByText("待替换原正文")).toBeVisible();
    await page.screenshot({ path: info.outputPath("06-target-checked.png") });
    await panel.getByRole("button", { name: "绑定文档", exact: true }).click();
    await panel
      .getByRole("button", { name: "预览并同步", exact: true })
      .click();
    await expect(
      panel.getByRole("heading", { name: "同步预览", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath("07-first-preview.png") });
    await panel
      .getByRole("button", { name: "确认并同步", exact: true })
      .click();
    const confirm = page.getByRole("dialog", {
      name: "替换飞书整篇正文？",
      exact: true,
    });
    await expect(confirm).toBeVisible();
    await page.screenshot({
      path: info.outputPath("08-replace-confirmation.png"),
    });
    expect(submissions).toHaveLength(0);
    await page.keyboard.press("Escape");
    await expect(confirm).not.toBeVisible();
    await expect(panel).toBeVisible();
    await panel
      .getByRole("button", { name: "确认并同步", exact: true })
      .click();
    await confirm.getByRole("button", { name: "取消", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(
      confirm.getByRole("button", { name: "确认替换并同步", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(panel.getByText("同步成功", { exact: true })).toBeVisible();
    expect(submissions).toHaveLength(1);
    await page.screenshot({ path: info.outputPath("09-sync-succeeded.png") });
    changed = true;
    await panel
      .getByRole("button", { name: "预览并同步", exact: true })
      .click();
    await expect(
      panel.getByText("飞书外部修改", { exact: true }),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "确认并同步", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "覆盖飞书当前正文？", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.screenshot({ path: info.outputPath("10-conflict-preview.png") });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    ).toBe(true);
    await panel.getByRole("button", { name: "返回", exact: true }).click();
    blocked = true;
    await panel
      .getByRole("button", { name: "预览并同步", exact: true })
      .click();
    await expect(
      panel.getByText("正文/第2块：暂不支持画板", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "确认并同步", exact: true }),
    ).toBeDisabled();
    await page.screenshot({
      path: info.outputPath("11-unsupported-content.png"),
    });
    await panel.getByRole("button", { name: "返回", exact: true }).click();
    tasks[0] = {
      ...tasks[0],
      status: "running",
      message: "正在追加并核验新正文",
    };
    await panel
      .getByRole("button", { name: "关闭文章同步", exact: true })
      .click();
    await page.getByRole("button", { name: "同步到…", exact: true }).click();
    await expect(
      panel.getByText("正在追加并核验新正文", { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath("12-sync-running.png") });
    tasks[0] = {
      ...tasks[0],
      status: "needs_review",
      message: "请求超时，远端结果需要核对",
    };
    await expect(
      panel.getByText("同步结果需要核对", { exact: true }),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "核对远端并尝试继续", exact: true })
      .click();
    await expect(
      panel.getByText("飞书仍保留部分新正文，需要人工核对", { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath("13-needs-review.png") });
    await panel
      .getByRole("button", { name: "我已核对，结束此任务", exact: true })
      .click();
    const endConfirm = page.getByRole("dialog", {
      name: "结束待核对任务？",
      exact: true,
    });
    await expect(endConfirm).toBeVisible();
    await page.screenshot({
      path: info.outputPath("14-end-task-confirmation.png"),
    });
    await endConfirm.getByRole("button", { name: "确认", exact: true }).click();
    await expect(
      panel.getByText("已核对并结束任务", { exact: true }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "解除绑定", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "解除文章绑定？", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("15-unbind-confirmation.png"),
    });
    await page
      .getByRole("dialog", { name: "解除文章绑定？", exact: true })
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "绑定文档", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).not.toBeVisible();
    expect(errors).toEqual([]);
  });
}
