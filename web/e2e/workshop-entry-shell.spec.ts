import { expect, test, type Page } from "@playwright/test";
import { newDeck } from "../src/features/presentation-workshop/templates";

const workshops = [
  [
    "presentation-workshop",
    "presentation",
    "演示工坊",
    "我的演示文稿",
    "搜索文稿",
    "新建演示文稿",
  ],
  [
    "thought-workshop",
    "thought",
    "思绪工坊",
    "我的知识库",
    "搜索知识库",
    "创建知识库",
  ],
  ["interview-assistant", "interview", "面试助手", null, null, "新建面试"],
  [
    "visual-workshop",
    "visual",
    "视觉创作工坊",
    "我的创作项目",
    "搜索项目",
    "新建项目",
  ],
  [
    "galgame-workshop",
    "galgame",
    "Galgame 工坊",
    "我的 Galgame 工程",
    "搜索工程",
    "新建工程",
  ],
  [
    "video-editor",
    "video",
    "视频剪辑工坊",
    "我的视频剪辑工程",
    "搜索剪辑项目",
    "新建剪辑",
  ],
  [
    "motion-compositor",
    "motion",
    "特效制作工坊",
    "我的特效项目",
    "搜索特效项目",
    "新建项目",
  ],
  [
    "audio-annotation",
    "annotation",
    "录音标注工坊",
    "我的标注任务",
    "搜索标注任务",
    "新建任务",
  ],
  [
    "director-desk",
    "director",
    "导演台",
    "我的预演工程",
    "搜索预演工程",
    "新建预演",
  ],
] as const;

// Serve the actual independent HTML entry at its production URL. Both
// assemblies use the isolated website API for these UI assertions.
async function useIndependentEntries(page: Page) {
  const entries = new Map<string, string>([
    ...workshops.map(([id, entry]): [string, string] => [
      `/apps/${id}`,
      `/${entry}.html`,
    ]),
    ["/creative-workshop", "/creative.html"],
  ]);
  const entryFor = (path: string) =>
    [...entries].find(
      ([root]) => path === root || path.startsWith(root + "/"),
    )?.[1];
  await page.route(
    (url) => !!entryFor(url.pathname),
    async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({
        url: new URL(entryFor(url.pathname)!, url).href,
      });
      await route.fulfill({ response });
    },
  );
}

const barFor = (page: Page) =>
  page.getByRole("region", { name: "工坊公共工具栏" });

for (const assembly of ["website", "independent"] as const) {
  test(`${assembly} workshop entry pages share one responsive utility bar`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    if (assembly === "independent") await useIndependentEntries(page);
    await page.setViewportSize({ width: 1600, height: 1000 });

    for (const [id, , name, title, search, create] of workshops) {
      await page.goto(`/apps/${id}`);
      const toolbar = barFor(page);
      await expect(toolbar).toHaveCount(1);
      if (title) {
        await expect(
          toolbar.getByRole("heading", { name: title, exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: title, exact: true }),
        ).toHaveCount(1);
      } else {
        await expect(
          toolbar.getByRole("combobox", { name: "已保存的面试" }),
        ).toBeVisible();
        await expect(page.locator("main h1")).toHaveCount(1);
      }
      if (search) {
        await expect(
          toolbar.getByRole("textbox", { name: search, exact: true }),
        ).toBeVisible();
      }
      await expect(
        toolbar.getByRole("button", { name: create, exact: true }),
      ).toBeVisible();
      if (id === "presentation-workshop") {
        await expect(
          page.getByText("让想法，成为精彩的演示", { exact: true }),
        ).toHaveCount(0);
      }

      await expect(page.getByRole("group", { name: "外观模式" })).toHaveCount(
        1,
      );
      await expect(page.locator(".workshop-brand strong")).toHaveText(name);
      const brand = page.locator(".workshop-brand img");
      await expect(brand).toHaveCount(1);
      await expect
        .poll(() => brand.evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBeGreaterThan(0);
      await expect(
        toolbar.getByRole("link", { name: "文档中心" }),
      ).toHaveAttribute("href", "/docs.html");
      await expect(
        toolbar.getByRole("button", { name: "打开 Amadeus" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "打开 Amadeus" }),
      ).toHaveCount(1);
      await expect(
        toolbar.getByRole("button", { name: "账号菜单" }),
      ).toBeVisible();
      const back = page.getByRole("button", { name: "返回应用中心" });
      await expect(back).toHaveCount(1);

      for (const width of [390, 768, 1600]) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 1000,
        });
        for (const [label, theme] of [
          ["浅色", "light"],
          ["深色", "dark"],
        ]) {
          await toolbar.getByRole("button", { name: label }).click();
          await expect(page.locator("html")).toHaveAttribute(
            "data-theme",
            theme,
          );
          const bounds = await toolbar.evaluate((el) => {
            const main = el.closest("main")!;
            return {
              viewport: [document.documentElement.scrollWidth, innerWidth],
              toolbar: [el.scrollWidth, el.clientWidth],
              main: [main.scrollWidth, main.clientWidth],
              outsideMain: Array.from(main.querySelectorAll("*"))
                .filter(
                  (child) =>
                    child.getBoundingClientRect().right >
                    main.getBoundingClientRect().right + 1,
                )
                .slice(0, 6)
                .map((child) => child.getAttribute("class")),
            };
          });
          for (const [scroll, visible] of [
            bounds.viewport,
            bounds.toolbar,
            bounds.main,
          ]) {
            expect(
              scroll,
              `${id} ${width}px ${theme} ${JSON.stringify(bounds)}`,
            ).toBeLessThanOrEqual(visible + 1);
          }
          if (width === 1600 && theme === "light") {
            const oneRow = await toolbar.evaluate((el) => {
              const groups = Array.from(el.children);
              const centers = groups.map((node) => {
                const box = node.getBoundingClientRect();
                return box.top + box.height / 2;
              });
              return Math.max(...centers) - Math.min(...centers) < 2;
            });
            expect(oneRow, `${id} uses one desktop header row`).toBe(true);
            await page.screenshot({
              path: info.outputPath(`${id}.png`),
              animations: "disabled",
            });
          }
        }
      }
      if (id === "thought-workshop") {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole("button", { name: "目录", exact: true }).click();
        await expect(back).toBeVisible();
        await page.keyboard.press("Escape");
      } else {
        await page.getByRole("button", { name: `收起${name}导航` }).click();
        await expect(back).toBeVisible();
        await page.getByRole("button", { name: `展开${name}导航` }).click();
      }
    }
  });

  test(`${assembly} toolbar keeps navigation, theme, account and assistant behavior`, async ({
    page,
  }) => {
    if (assembly === "independent") await useIndependentEntries(page);
    const login = await page.request.post("/v1/auth/login", {
      data: {
        username: "e2e-admin",
        password: process.env.FPL_E2E_PASSWORD || "E2E-Password-2026!",
      },
    });
    expect(login.ok()).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/apps/interview-assistant");
    const toolbar = barFor(page);
    await toolbar.getByRole("button", { name: "深色" }).click();
    const account = toolbar.getByRole("button", { name: "账号菜单" });
    await account.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu", { name: "账号菜单" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(account).toBeFocused();

    const assistant = toolbar.getByRole("button", { name: "打开 Amadeus" });
    await page.evaluate(() => {
      window.addEventListener(
        "future-props:amadeus-context",
        (event) => {
          const { application, path } = (event as CustomEvent).detail;
          document.body.dataset.assistantSource = `${application} ${path}`;
        },
        { once: true },
      );
    });
    await assistant.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("complementary", { name: "Amadeus 助手" }),
    ).toBeVisible();
    await expect(page.locator("body")).toHaveAttribute(
      "data-assistant-source",
      "面试助手 /apps/interview-assistant",
    );
    await page.getByRole("button", { name: "关闭 Amadeus" }).click();
    await expect(assistant).toBeFocused();

    const [docs] = await Promise.all([
      page.waitForEvent("popup"),
      toolbar.getByRole("link", { name: "文档中心" }).click(),
    ]);
    await expect(docs).toHaveURL(/\/docs\.html/);
    await docs.close();

    const role = page.getByRole("textbox", { name: "岗位名称" });
    await role.fill("测试未保存拦截");
    const back = page.getByRole("button", { name: "返回应用中心" });
    await back.click();
    await expect(
      page.getByRole("alertdialog", { name: "放弃未保存的练习或材料？" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "留在当前页面" }).click();
    await expect(role).toHaveValue("测试未保存拦截");
    await back.click();
    await page.getByRole("button", { name: "放弃未保存内容并继续" }).click();
    await expect(page).toHaveURL(/\/apps$/);
    await page.goto("/apps/audio-annotation");
    await expect(toolbar.getByRole("button", { name: "深色" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await account.click();
    await page.getByRole("menuitem", { name: "退出登录" }).click();
    await expect(
      page.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    await expect(toolbar).toHaveCount(0);
    await expect(page).toHaveURL(/\/apps\/audio-annotation$/);
    await page.getByLabel("用户名").fill("e2e-admin");
    await page
      .getByLabel("密码", { exact: true })
      .fill(process.env.FPL_E2E_PASSWORD || "E2E-Password-2026!");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(toolbar).toBeVisible();
    await expect(page).toHaveURL(/\/apps\/audio-annotation$/);
  });

  test(`${assembly} read-only workshop pages retain their read-only content`, async ({
    page,
  }) => {
    if (assembly === "independent") await useIndependentEntries(page);
    await page.route("**/v1/auth/me", async (route) => {
      const response = await route.fetch();
      const account = await response.json();
      account.permission_keys = account.permission_keys.filter(
        (key: string) => key !== "content.write",
      );
      await route.fulfill({ response, json: account });
    });
    for (const [id, create] of [
      ["audio-annotation", "新建任务"],
      ["thought-workshop", "创建知识库"],
      ["visual-workshop", "新建项目"],
    ]) {
      await page.goto(`/apps/${id}`);
      await expect(barFor(page)).toBeVisible();
      await expect(page.locator("main h1").first()).toBeVisible();
      await expect(
        page.getByRole("button", { name: create, exact: true }),
      ).toHaveCount(0);
    }
  });
}

async function openAndDragAssistant(page: Page) {
  const trigger = page.getByRole("button", {
    name: "打开 Amadeus",
    exact: true,
  });
  const path = page.url();
  await expect(trigger).toHaveCount(1);
  await trigger.click();
  await expect(page).toHaveURL(path);
  const assistant = page.getByRole("complementary", { name: "Amadeus 助手" });
  const divider = page.getByRole("separator", {
    name: "调整 Amadeus 分屏宽度",
  });
  await expect(
    assistant.getByRole("textbox", { name: "向 Amadeus 提问" }),
  ).toBeVisible();
  await expect(divider).toBeVisible();
  const bounds = (await divider.boundingBox())!;
  const leftPane = page.locator(".website-page");
  const start = (await leftPane.boundingBox())!.width;
  const assistantWidth = (await assistant.boundingBox())!.width;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 45, y, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await leftPane.boundingBox())!.width)
    .toBeCloseTo(start + 45, 0);
  await expect
    .poll(async () => (await assistant.boundingBox())!.width)
    .toBeCloseTo(assistantWidth - 45, 0);
  await divider.press("ArrowLeft");
  await expect
    .poll(async () => (await leftPane.boundingBox())!.width)
    .toBeCloseTo(start + 35, 0);
  const [left, right] = await Promise.all([
    leftPane.boundingBox(),
    assistant.boundingBox(),
  ]);
  expect(right!.x - left!.x - left!.width).toBeCloseTo(6, 0);
  expect(page.viewportSize()!.width - right!.x - right!.width).toBeCloseTo(
    6,
    0,
  );
  await divider.dblclick();
  await expect
    .poll(async () => (await leftPane.boundingBox())!.width)
    .toBeCloseTo(start, 0);
  return assistant;
}

for (const assembly of ["monolith", "independent"] as const) {
  test(`${assembly} Amadeus opens and resizes across workshops and project routes`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    if (assembly === "independent") await useIndependentEntries(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/apps/visual-workshop");
    const csrf = (await page.context().cookies()).find(
      ({ name }) => name === "fpl_csrf",
    )!.value;
    const headers = {
      "X-CSRF-Token": csrf,
      Origin: new URL(page.url()).origin,
    };
    const project = async (
      app: string,
      extra: Record<string, unknown> = {},
      collection = "projects",
    ) => {
      const response = await page.request.post(`/v1/${app}/${collection}`, {
        headers,
        data: { title: `Amadeus ${app} ${assembly}`, ...extra },
      });
      expect(
        response.ok(),
        `${app} project fixture (${response.status()})`,
      ).toBeTruthy();
      return (await response.json()).id as string;
    };
    const audio = Buffer.alloc(1644);
    audio.write("RIFF");
    audio.writeUInt32LE(audio.length - 8, 4);
    audio.write("WAVEfmt ", 8);
    audio.writeUInt32LE(16, 16);
    audio.writeUInt16LE(1, 20);
    audio.writeUInt16LE(1, 22);
    audio.writeUInt32LE(8000, 24);
    audio.writeUInt32LE(16000, 28);
    audio.writeUInt16LE(2, 32);
    audio.writeUInt16LE(16, 34);
    audio.write("data", 36);
    audio.writeUInt32LE(audio.length - 44, 40);
    const upload = await page.request.post("/v1/files", {
      headers,
      multipart: {
        upload: { name: "split.wav", mimeType: "audio/wav", buffer: audio },
      },
    });
    expect(upload.ok()).toBeTruthy();
    const [
      visual,
      video,
      presentation,
      director,
      galgame,
      thought,
      motion,
      annotation,
    ] = await Promise.all([
      project("visual-workshop", { kind: "canvas" }),
      project("video-editor"),
      project("presentation-workshop", { document: newDeck("cover") }),
      project("director-desk"),
      project("galgame-workshop"),
      project("thought-workshop", {}, "knowledge-bases"),
      project("motion-compositor"),
      project("audio-annotation", { asset_id: (await upload.json()).id }),
    ]);
    const routes = [
      ...workshops.map(([id]) => `/apps/${id}`),
      "/creative-workshop",
      "/apps/visual-workshop/tasks",
      `/apps/visual-workshop/projects/${visual}/assets`,
      `/apps/visual-workshop/projects/${visual}/canvas`,
      "/apps/video-editor/tasks",
      `/apps/video-editor/projects/${video}/editor`,
      "/apps/presentation-workshop/templates",
      "/apps/presentation-workshop/templates/new",
      `/apps/presentation-workshop/projects/${presentation}`,
      `/apps/director-desk/projects/${director}`,
      `/apps/galgame-workshop/projects/${galgame}/overview`,
      `/apps/galgame-workshop/projects/${galgame}/editor`,
      `/apps/thought-workshop/knowledge-bases/${thought}`,
      "/apps/thought-workshop/community",
      `/apps/motion-compositor/projects/${motion}/editor`,
      `/apps/audio-annotation/projects/${annotation}`,
    ];
    for (const path of routes) {
      await test.step(path, async () => {
        await page.goto(path);
        const assistant = await openAndDragAssistant(page);
        if (path.endsWith(`/${visual}/canvas`)) {
          await page.getByRole("button", { name: "看板", exact: true }).click();
          await page.reload();
          await expect(
            page.getByRole("button", { name: "看板", exact: true }),
          ).toHaveAttribute("aria-pressed", "true");
          await openAndDragAssistant(page);
          const picker = assistant.getByRole("button", {
            name: "选择工坊项目",
          });
          await picker.click();
          const selected = page.getByRole("list", { name: "已选项目" });
          await expect(
            selected.getByText(`Amadeus visual-workshop ${assembly}`),
          ).toBeVisible();
          await page
            .getByRole("textbox", { name: "搜索工坊或项目" })
            .fill(`Amadeus video-editor ${assembly}`);
          await page
            .getByRole("checkbox", {
              name: `Amadeus video-editor ${assembly}`,
              exact: true,
            })
            .check();
          await expect(
            selected.getByText(`Amadeus video-editor ${assembly}`),
          ).toBeVisible();
          await page.getByRole("button", { name: "完成", exact: true }).click();
          await page.getByRole("button", { name: "返回项目列表" }).click();
          await expect(page).toHaveURL(/\/apps\/visual-workshop$/);
          if (assembly === "independent") {
            await page.getByRole("button", { name: "打开 Amadeus" }).click();
          }
          await picker.click();
          await expect(
            selected.getByText(`Amadeus visual-workshop ${assembly}`),
          ).toHaveCount(0);
          await expect(
            selected.getByText(`Amadeus video-editor ${assembly}`),
          ).toBeVisible();
          await page.getByRole("button", { name: "完成", exact: true }).click();
        }
        if (path.endsWith(`/${director}`)) {
          const divider = page.getByRole("separator", {
            name: "调整 Amadeus 分屏宽度",
          });
          await divider.press("End");
          await expect
            .poll(
              async () =>
                (await page.locator(".director-desk-root").boundingBox())!
                  .width,
            )
            .toBeCloseTo(880, 0);
          await page.setViewportSize({ width: 1200, height: 1000 });
          await expect(assistant).toHaveCSS("position", "fixed");
          await expect(divider).toHaveCount(0);
          await page.setViewportSize({ width: 1600, height: 1000 });
        }
      });
    }
    await page.route("**/v1/auth/me", async (route) => {
      const response = await route.fetch();
      const account = await response.json();
      account.permission_keys = account.permission_keys.filter(
        (key: string) => key !== "content.write",
      );
      await route.fulfill({ response, json: account });
    });
    for (const path of [
      `/apps/visual-workshop/projects/${visual}/assets`,
      `/apps/video-editor/projects/${video}/editor`,
      `/apps/audio-annotation/projects/${annotation}`,
    ]) {
      await page.goto(path);
      await openAndDragAssistant(page);
    }
  });
}
