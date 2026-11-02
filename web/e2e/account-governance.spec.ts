import { expect, test, type BrowserContext } from "@playwright/test";

async function write(context: BrowserContext, path: string, data: unknown) {
  const csrf =
    (await context.cookies()).find((c) => c.name === "fpl_csrf")?.value || "";
  const result = await context.request.post(path, {
    data,
    headers: {
      Origin: `http://127.0.0.1:${process.env.FPL_E2E_WEB_PORT || "3000"}`,
      "X-CSRF-Token": csrf,
    },
  });
  expect(result.ok(), await result.text()).toBeTruthy();
  return result.status() === 204 ? null : result.json();
}

test("账号管理保留一次性密码，私人数据和旧空间 API 有明确边界", async ({
  page,
  context,
  browser,
}) => {
  await page.goto("/home");
  await page.getByRole("button", { name: "账号菜单" }).click();
  await expect(page.getByRole("menuitem", { name: "管理中台" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "工作区管理", exact: true }),
  ).toHaveCount(0);
  const me = await (await context.request.get("/v1/auth/me")).json();
  expect(me.user.platform_role).toBe("admin");
  expect(me).not.toHaveProperty("workspace");
  expect((await context.request.get("/v1/account/workspaces")).status()).toBe(
    404,
  );
  const username = `owned-${Date.now()}`;
  const account = await write(context, "/v1/platform/accounts", {
    username,
    display_name: "账号归属测试",
  });
  expect(account.temporary_password.length).toBeGreaterThan(12);
  const privateProject = await write(
    context,
    "/v1/thought-workshop/knowledge-bases",
    { title: "管理员私人项目" },
  );
  const other = await browser.newContext({
    baseURL: `http://127.0.0.1:${process.env.FPL_E2E_WEB_PORT || "3000"}`,
  });
  try {
    await write(other, "/v1/auth/login", {
      username,
      password: account.temporary_password,
    });
    await write(other, "/v1/auth/change-password", {
      current_password: account.temporary_password,
      new_password: "Account-Owned-E2E-2026!",
    });
    const response = await other.request.get(
      `/v1/thought-workshop/knowledge-bases/${privateProject.id}`,
    );
    expect(response.status()).toBe(404);
    const p = await other.newPage();
    await p.goto("/home");
    await p.getByRole("button", { name: "账号菜单" }).click();
    await expect(p.getByRole("menuitem", { name: "管理中台" })).toHaveCount(0);
    const userProject = await write(
      other,
      "/v1/thought-workshop/knowledge-bases",
      { title: "普通用户私人项目" },
    );
    expect(
      (
        await context.request.get(
          `/v1/thought-workshop/knowledge-bases/${userProject.id}`,
        )
      ).status(),
    ).toBe(404);
  } finally {
    await other.close();
  }
  // Independent management UI and runtime permissions are covered by management.spec.ts.
});

for (const theme of ["light", "dark"]) {
  test(`账号设置适配桌面和手机：${theme}`, async ({ page }) => {
    await page.addInitScript(
      (t) => localStorage.setItem("future_props_theme", t),
      theme,
    );
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/home");

      await page.getByRole("button", { name: "账号菜单", exact: true }).click();
      await page
        .getByRole("menuitem", { name: "账号设置", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "账号设置",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "API 密钥", exact: true }),
      ).toBeVisible();
      await expect(dialog.getByText("工作区", { exact: true })).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBeTruthy();
      await page.screenshot({
        path: `../.local/account-ownership/browser/settings-${width}-${theme}.png`,
      });
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
      await expect(dialog).toBeHidden();
    }
  });
}

test("升级旧本机草稿时重建账号索引并保留未提交的操作", async ({ page }) => {
  await page.goto("/home");
  const recovered = await page.evaluate(async () => {
    function seed(
      name: string,
      version: number,
      rows: unknown[],
      index: string,
      path: string | string[],
    ) {
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore("drafts", {
            keyPath: "key",
          });
          store.createIndex(index, path);
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("drafts", "readwrite");
          for (const row of rows) tx.objectStore("drafts").put(row);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    }
    await seed(
      "fpl-thought-drafts",
      2,
      [
        {
          key: "old-note-draft",
          userId: "alice",
          workspaceId: "old-space",
          noteId: "note",
          tabId: "tab",
          revision: 3,
          updatedAt: 1,
          body: { title: "未保存标题" },
        },
      ],
      "by-document",
      ["userId", "workspaceId", "noteId"],
    );
    await seed(
      "fpl-multitable-drafts",
      1,
      [
        {
          key: "old-table-draft",
          document: "alice/old-space/table",
          tab: "tab",
          revision: 2,
          operations: [{ op: "records.delete", ids: ["row"] }],
          time: 1,
        },
      ],
      "document",
      "document",
    );
    const storagePath = "/src/features/thought-workshop/drafts/storage.ts";
    const tablePath = "/src/features/thought-workshop/multitable/drafts.ts";
    const storage = await import(/* @vite-ignore */ storagePath),
      table = await import(/* @vite-ignore */ tablePath);
    return {
      notes: await storage.listLocalDrafts(
        { userId: "alice", accountId: "alice" },
        "note",
      ),
      tables: await table.drafts("alice/alice/table"),
    };
  });
  expect(recovered.notes).toHaveLength(1);
  expect(recovered.notes[0].body.title).toBe("未保存标题");
  expect(recovered.notes[0]).not.toHaveProperty("workspaceId");
  expect(recovered.tables).toHaveLength(1);
  expect(recovered.tables[0].operations[0].ids).toEqual(["row"]);
});
