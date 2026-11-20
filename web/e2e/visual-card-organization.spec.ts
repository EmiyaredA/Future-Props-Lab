import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("三类卡可连续添加同族变体，独立移除、排序并从项目创建变体", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1487, height: 1058 });
  await page.goto("/apps/visual-workshop");
  const csrf = (await page.context().cookies()).find(
    ({ name }) => name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const api = "/v1/visual-workshop";
  const project = await page.request.post(`${api}/projects`, {
    headers,
    data: { title: "三类变体独立收录", kind: "canvas" },
  });
  expect(project.ok(), await project.text()).toBeTruthy();
  const { id } = await project.json();
  const canvas = `${api}/projects/${id}/canvas`;
  const uploaded = await page.request.post("/v1/files", {
    headers,
    multipart: {
      upload: {
        name: "card.webp",
        mimeType: "image/webp",
        buffer: await readFile(
          new URL(
            "../src/features/visual-workshop/creative/design-library-empty.webp",
            import.meta.url,
          ),
        ),
      },
    },
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  const asset = (await uploaded.json()).id as string;
  const entries: {
    kind: string;
    label: string;
    title: string;
    root: string;
    a: string;
    b: string;
  }[] = [];
  for (const [kind, label] of [
    ["character", "人设"],
    ["scene", "场景"],
    ["prop", "道具"],
  ]) {
    const title = `连续收录${label}`;
    const create = async (name: string, parent_id?: string) => {
      const response = await page.request.post(`${api}/asset-cards`, {
        headers,
        data: {
          kind,
          title: name,
          parent_id,
          parent_asset_id: parent_id ? asset : undefined,
          adopted_asset_id: asset,
        },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return (await response.json()).id as string;
    };
    const root = await create(title);
    entries.push({
      kind,
      label,
      title,
      root,
      a: await create(`${title} · 造型10`, root),
      b: await create(`${label}造型2`, root),
    });
  }
  const saved = await page.request.put(canvas, {
    headers,
    data: {
      expected_revision: 0,
      nodes: [
        { id: "text", kind: "text", title: "首帧", position: { x: 0, y: 0 } },
      ],
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.goto(`/apps/visual-workshop/projects/${id}/canvas`);
  await page.getByRole("button", { name: "看板", exact: true }).click();
  const expected: string[] = [];
  for (const entry of entries) {
    const openPicker = async () => {
      await page.getByRole("button", { name: `添加${entry.label}卡` }).click();
      await page.getByRole("menuitem", { name: "从设定库添加" }).click();
      const picker = page.getByRole("dialog", {
        name: "从设定库添加",
        exact: true,
      });
      await picker.getByRole("searchbox").fill(entry.title);
      return picker;
    };
    let picker = await openPicker();
    await picker
      .getByRole("button", { name: new RegExp(`${entry.title} · 造型10`) })
      .click();
    await picker
      .getByRole("button", { name: "添加到项目", exact: true })
      .click();
    expected.push(entry.a);
    await expect
      .poll(
        async () =>
          (await (await page.request.get(canvas)).json()).project_card_ids,
      )
      .toEqual(expected);
    expect(expected).not.toContain(entry.root);
    picker = await openPicker();
    await expect(
      picker.getByRole("button", {
        name: new RegExp(`${entry.title} · 造型10`),
      }),
    ).toBeDisabled();
    await expect(picker.getByText(/已添加到项目/)).toBeVisible();
    // A short sibling name must remain searchable by the parent title.
    await picker
      .getByRole("button", { name: new RegExp(`${entry.label}造型2`) })
      .click();
    await picker
      .getByRole("button", { name: "添加到项目", exact: true })
      .click();
    expected.push(entry.b);
    await expect
      .poll(
        async () =>
          (await (await page.request.get(canvas)).json()).project_card_ids,
      )
      .toEqual(expected);
    await expect(
      page.getByRole("button", {
        name: `查看设定卡 ${entry.title}`,
        exact: true,
      }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: `${entry.label}按名称排序` })
      .click();
    await expect(
      page.getByRole("button", { name: `${entry.label}按名称排序` }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  await page.reload();
  for (const entry of entries)
    await expect(
      page.getByRole("button", { name: `${entry.label}按名称排序` }),
    ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: info.outputPath("project-independent-cards.png"),
  });

  // Creating a variant in a project retries attachment rather than creating twice.
  const entry = entries[0];
  await page
    .getByRole("button", {
      name: `查看设定卡 ${entry.title} · 造型10`,
      exact: true,
    })
    .click();
  const before = await (await page.request.get(`${api}/asset-cards`)).json();
  let fail = true;
  await page.route(`**${canvas}`, async (route) => {
    if (fail && route.request().method() === "PUT") {
      fail = false;
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          title: "模拟网络失败",
          detail: "请重试",
          status: 503,
        }),
      });
    } else await route.continue();
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "创建变体", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: `${entry.title} · 造型10 · 变体`,
    exact: true,
  });
  await expect(editor.getByRole("button", { name: "重试添加" })).toBeVisible();
  await editor.getByRole("button", { name: "重试添加" }).click();
  await expect(editor.getByRole("button", { name: "重试添加" })).toHaveCount(0);
  const after = await (await page.request.get(`${api}/asset-cards`)).json();
  expect(after.length).toBe(before.length + 1);
  const child = after.find(
    (card: { parent_id: string }) => card.parent_id === entry.a,
  );
  await expect
    .poll(async () =>
      (await (await page.request.get(canvas)).json()).project_card_ids.includes(
        child.id,
      ),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: `${entry.title} · 造型10 操作`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: "从项目移除" }).click();
  await expect(
    page.getByRole("button", {
      name: `查看设定卡 ${entry.title} · 造型10`,
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: `查看设定卡 ${entry.label}造型2`,
      exact: true,
    }),
  ).toBeVisible();

  await page.goto("/apps/visual-workshop/card-library");
  for (const item of entries) {
    const label = item.kind === "character" ? "角色卡" : `${item.label}卡`;
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.getByRole("textbox", { name: `搜索${label}` }).fill(item.title);
    const group = page.getByRole("group", {
      name: `${item.title}设定组`,
      exact: true,
    });
    await expect(group).toBeVisible();
    await expect(
      group.getByRole("button", { name: `为${item.title}创建变体` }),
    ).toBeEnabled();
    await expect(
      group.getByRole("button", {
        name: `查看变体 ${item.label}造型2`,
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: `${label}按名称排序` }).click();
    await expect(
      page.getByRole("button", { name: `${label}按名称排序` }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  await page.screenshot({ path: info.outputPath("library-grouped-cards.png") });
});
