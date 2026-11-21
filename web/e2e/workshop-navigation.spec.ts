import { expect, test, type Page } from "@playwright/test";
import { newDeck } from "../src/features/presentation-workshop/templates";

async function independent(
  page: Page,
  baseURL: string,
  service: string,
  root: string,
) {
  await page.route(
    (url) => url.pathname === root || url.pathname.startsWith(root + "/"),
    async (route) => {
      if (!route.request().isNavigationRequest()) return route.fallback();
      const response = await route.fetch({
        url: new URL(service + ".html", baseURL).href,
      });
      await route.fulfill({ response });
    },
  );
  await page.goto(root);
}

function trackDocuments(page: Page) {
  const documents: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") documents.push(request.url());
  });
  return documents;
}

function silentWav() {
  const data = Buffer.alloc(32044);
  data.write("RIFF");
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24);
  data.writeUInt32LE(32000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(32000, 40);
  return data;
}

async function spreadsheetFixture(page: Page, title: string) {
  // The compatibility test server deliberately does not own Spreadsheet data.
  // Exercise the real independent UI with a deterministic owner API fixture.
  const project = {
    id: "navigation-sheet",
    title,
    revision: 0,
    calculation: "not_needed",
    created_at: "2026-11-21T00:00:00Z",
    updated_at: "2026-11-21T00:00:00Z",
    document: {
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
  await page.route("**/v1/spreadsheet-workshop/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET")
      return route.fulfill({ status: 405 });
    await route.fulfill({
      json: path.endsWith("/projects")
        ? { items: [project], total: 1 }
        : project,
    });
  });
}

const workshops = [
  {
    owner: "video-editor",
    service: "video",
    ready: ".ve-editor",
    back: ".ve-back",
  },
  {
    owner: "motion-compositor",
    service: "motion",
    ready: ".mc-editor",
    back: '[aria-label="返回特效项目"]',
  },
  {
    owner: "galgame-workshop",
    service: "galgame",
    ready: '[aria-label="返回工程概览"]',
    back: '[aria-label="返回工程概览"]',
  },
  {
    owner: "director-desk",
    service: "director",
    ready: "#director-desk-back",
    back: "#director-desk-back",
  },
  {
    owner: "audio-annotation",
    service: "annotation",
    ready: '[aria-label="返回任务列表"]',
    back: '[aria-label="返回任务列表"]',
  },
  {
    owner: "presentation-workshop",
    service: "presentation",
    ready: '[aria-label="幻灯片画布"]',
    back: '[aria-label="返回文稿列表"]',
  },
  {
    owner: "spreadsheet-workshop",
    service: "spreadsheet",
    ready: ".fortune-sheet-canvas",
    back: '[aria-label="返回我的工作簿"]',
  },
] as const;

for (const workshop of workshops) {
  test(`独立 ${workshop.service} 项目往返不重新加载网页`, async ({
    page,
    baseURL,
  }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    const root = "/apps/" + workshop.owner;
    const title = `${workshop.service} 导航验收`;
    if (workshop.service === "spreadsheet")
      await spreadsheetFixture(page, title);
    await independent(page, baseURL!, workshop.service, root);
    const csrf = (await page.context().cookies()).find(
      (cookie) => cookie.name === "fpl_csrf",
    )!.value;
    const headers = {
      "X-CSRF-Token": csrf,
      Origin: new URL(page.url()).origin,
    };
    const body: Record<string, unknown> = { title };
    if (workshop.service === "presentation") body.document = newDeck();
    if (workshop.service === "spreadsheet")
      body.request_id = crypto.randomUUID();
    if (workshop.service === "annotation") {
      const uploaded = await page.request.post("/v1/files", {
        headers,
        multipart: {
          upload: {
            name: "navigation.wav",
            mimeType: "audio/wav",
            buffer: silentWav(),
          },
        },
      });
      expect(uploaded.ok(), await uploaded.text()).toBe(true);
      body.asset_id = (await uploaded.json()).id;
    }
    if (workshop.service !== "spreadsheet") {
      const created = await page.request.post(
        `/v1/${workshop.owner}/projects`,
        { headers, data: body },
      );
      expect(created.ok(), await created.text()).toBe(true);
    }
    await page.reload();
    const card = page.locator("article").filter({ hasText: title });
    await expect(card).toBeVisible();
    const origin = await page.evaluate(() => performance.timeOrigin);
    const documents = trackDocuments(page);
    await card.getByRole("button").first().click();
    if (workshop.service === "galgame")
      await page.getByRole("button", { name: "进入编辑器" }).click();
    await expect(page.locator(workshop.ready)).toBeVisible({ timeout: 30_000 });
    const editorPath = new URL(page.url()).pathname;
    await page.screenshot({
      path: info.outputPath(`${workshop.service}-editor.png`),
    });
    await page.locator(workshop.back).click();
    await expect(page).not.toHaveURL(new RegExp(editorPath + "$"));
    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(new RegExp(editorPath + "$"));
    await expect(page.locator(workshop.ready)).toBeVisible();
    await page.evaluate(() => history.forward());
    await expect(page).not.toHaveURL(new RegExp(editorPath + "$"));
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
    expect(documents).toEqual([]);
  });
}

test("集成标签与模型服务侧栏保留当前网页", async ({ page, baseURL }) => {
  for (const [service, root, labels] of [
    ["integrations", "/integrations/tool-apis", ["MCP", "Skill", "工具 API"]],
    ["models", "/model-service", ["模型测试", "模型调用日志", "模型与智能体"]],
  ] as const) {
    await independent(page, baseURL!, service, root.split("/tool-apis")[0]);
    const documents = trackDocuments(page);
    const origin = await page.evaluate(() => performance.timeOrigin);
    for (const label of labels) {
      const control =
        service === "integrations"
          ? page.getByRole("tab", { name: label, exact: true })
          : page
              .getByRole("navigation", { name: "AI 能力子菜单" })
              .getByRole("button", { name: label, exact: true });
      await control.click();
      if (service === "integrations")
        await expect(control).toHaveAttribute("aria-selected", "true");
    }
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
    expect(documents).toEqual([]);
  }
});

test("工具页面与门户内部导航保留当前网页", async ({ page, baseURL }) => {
  await independent(page, baseURL!, "tools", "/tools");
  await expect(
    page.getByRole("button", { name: "打开视频帧导出", exact: true }),
  ).toBeVisible();
  const documents = trackDocuments(page);
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page
    .getByRole("button", { name: "打开视频帧导出", exact: true })
    .click();
  await page.getByRole("button", { name: "返回工具导航" }).click();
  await expect(page).toHaveURL(/\/tools$/);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
  expect(documents).toEqual([]);
  await independent(page, baseURL!, "portal", "/home");
  const portalDocuments = trackDocuments(page);
  await page.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page).toHaveURL(/\/apps$/);
  expect(portalDocuments).toEqual([]);
});

test("思绪工坊首次懒加载保留当前内容直到目标页面就绪", async ({
  page,
  baseURL,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/src/features/thought-workshop/community/KnowledgeCommunityPage.tsx*",
    async (route) => {
      await gate;
      await route.continue();
    },
  );
  await independent(page, baseURL!, "thought", "/apps/thought-workshop");
  const current = page.getByRole("button", { name: "创建知识库", exact: true });
  await expect(current).toBeVisible();
  const documents = trackDocuments(page);
  const request = page.waitForRequest((request) =>
    request.url().includes("/community/KnowledgeCommunityPage.tsx"),
  );
  await page.getByRole("button", { name: "知识社区", exact: true }).click();
  await request;
  await expect(current).toBeVisible();
  release();
  await expect(
    page.getByRole("button", { name: "知识社区", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  expect(documents).toEqual([]);
});
