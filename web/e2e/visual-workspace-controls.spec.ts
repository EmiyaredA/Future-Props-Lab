import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  createSceneDocument,
  createSceneObject,
} from "../vendor/toonflow/truman-map/sceneDocument";

async function createProject(page: Page) {
  await page.goto("/apps/visual-workshop");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const response = await page.request.post("/v1/visual-workshop/projects", {
    headers,
    data: { title: "室内对话 · 控件验收", kind: "canvas" },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const project = (await response.json()).id;
  const base = `/v1/visual-workshop/projects/${project}`;
  const episodes = [
    {
      id: randomUUID(),
      title: "第1集 · 咖啡馆",
      scenes: [
        {
          id: randomUUID(),
          title: "第1场 · 意外来客",
          heading: "室内 · 咖啡馆 · 夜",
          text: "窗外雨声渐密，咖啡馆只剩角落的一盏灯。\n\n马奎尔将杯子放回桌面，抬眼看向对面。\n\n马奎尔：你说的那件事，我想再确认一次。\n\n女孩没有立刻回答，只是缓缓转动手中的杯子。\n\n女孩：你已经知道答案了，不是吗？",
        },
      ],
    },
    {
      id: randomUUID(),
      title: "第2集 · 雨夜",
      scenes: [
        {
          id: randomUUID(),
          title: "第1场 · 街角重逢",
          heading: "街角 · 夜",
          text: "女孩在街角停下。",
        },
      ],
    },
  ];
  const script = await page.request.put(`${base}/script`, {
    headers,
    data: { expected_revision: 0, episodes },
  });
  expect(script.ok(), await script.text()).toBeTruthy();
  await page.goto(`/apps/visual-workshop/projects/${project}/canvas`);
  return { base, headers };
}

async function setTheme(page: Page, theme: "light" | "dark") {
  if (
    (await page.evaluate(() => document.documentElement.dataset.theme)) !==
    theme
  ) {
    await page
      .getByRole("button", {
        name: theme === "dark" ? "切换深色" : "切换浅色",
        exact: true,
      })
      .click();
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function openScriptCreation(page: Page) {
  await page.getByRole("button", { name: "添加预演场景", exact: true }).click();
  await page.getByRole("menuitem", { name: "从剧本创建", exact: true }).click();
}

async function contrast(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    function luminance(color: string) {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const channels = [...context.getImageData(0, 0, 1, 1).data]
        .slice(0, 3)
        .map((channel) => {
          const value = channel / 255;
          return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4;
        });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    }
    let surface: Element | null = element;
    while (
      surface &&
      getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)"
    )
      surface = surface.parentElement;
    const first = luminance(style.color),
      second = luminance(
        getComputedStyle(surface ?? document.body).backgroundColor,
      );
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  });
}

test("分镜文字与 hover 对比度、剧本多集展开及跨集新建分镜", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1584, height: 994 });
  const { base } = await createProject(page);
  await page.getByRole("tab", { name: "分镜", exact: true }).click();
  const filter = page.getByRole("combobox", { name: "剧本分镜" });
  await expect(filter).toHaveText("全部分镜");
  await expect(filter.locator(".custom-select-trigger-content")).toBeVisible();
  const create = page.getByRole("button", { name: "新建分镜", exact: true });
  for (const theme of ["dark", "light"] as const) {
    await setTheme(page, theme);
    await expect.poll(() => contrast(create)).toBeGreaterThanOrEqual(4.5);
    await create.hover();
    await expect.poll(() => contrast(create)).toBeGreaterThanOrEqual(4.5);
    await page.keyboard.press("Tab");
    await create.focus();
    expect(
      await create.evaluate(
        (element) => getComputedStyle(element).outlineStyle,
      ),
    ).not.toBe("none");
    await filter.click();
    await expect(
      page.getByRole("option", { name: "全部分镜", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.screenshot({ path: info.outputPath(`storyboard-${theme}.png`) });
  }
  await setTheme(page, "dark");
  await page.getByRole("tab", { name: "剧本", exact: true }).click();
  await page.getByRole("button", { name: "展开第2集 · 雨夜" }).click();
  await expect(
    page.getByRole("button", { name: "第1场 · 意外来客", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "第1场 · 街角重逢", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("script-dark.png") });
  const owner = page
    .getByRole("button", { name: "收起第2集 · 雨夜" })
    .locator("../..");
  await owner.getByRole("button", { name: "新建分镜" }).click();
  await expect(page.getByLabel("分镜名称", { exact: true })).toHaveValue(
    "分镜 02",
  );
  await expect(page.getByLabel("场景信息", { exact: true })).toHaveValue(
    "室内 · 咖啡馆 · 夜",
  );
  await expect(page.getByLabel("剧本文本", { exact: true })).toHaveValue(
    /林舟：/,
  );
  await expect(
    page.getByRole("button", { name: "提取设定", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "转为白模预演", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: info.outputPath("script-new-scene-example.png"),
  });
  await page.getByRole("button", { name: "保存剧本", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存剧本", exact: true }),
  ).toBeDisabled();
  const saved = await (await page.request.get(`${base}/script`)).json();
  expect(
    saved.episodes.map(
      (episode: { scenes: unknown[] }) => episode.scenes.length,
    ),
  ).toEqual([1, 2]);
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const workspace of ["工作台", "剧本", "白模预演"]) {
      await page.getByRole("tab", { name: workspace, exact: true }).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        (await page.locator(".visual-project-header:visible").boundingBox())!
          .height,
      ).toBe(56);
    }
  }
});

test("未关联分镜居中编辑镜头设计并集中视频制作入口", async ({ page }, info) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const { base, headers } = await createProject(page);
  const saved = await page.request.put(`${base}/storyboard`, {
    headers,
    data: {
      expected_revision: 0,
      shots: [
        {
          id: randomUUID(),
          title: "雨夜 · 拆开信封",
          description: "林舟将信封推向苏晚，镜头缓慢推进到她的手部。",
          duration: 3.5,
        },
      ],
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.reload();
  await page.getByRole("tab", { name: "分镜", exact: true }).click();
  const header = page.locator(".visual-project-header");
  await header.getByRole("button", { name: "看板", exact: true }).click();
  const editor = page.getByRole("region", { name: "分镜制作", exact: true });
  const start = page.getByRole("region", { name: "制作镜头视频", exact: true });
  await expect(editor.getByLabel("镜头标题")).toHaveValue("雨夜 · 拆开信封");
  await expect(
    start.getByRole("button", { name: "开始制作镜头视频", exact: true }),
  ).toHaveCount(1);
  await expect(start.getByLabel("镜头标题")).toHaveCount(0);
  await editor.getByLabel("景别", { exact: true }).fill("手部特写");
  for (const theme of ["dark", "light"] as const) {
    await setTheme(page, theme);
    for (const size of [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await editor.getByLabel("镜头标题").scrollIntoViewIfNeeded();
      await expect(editor.getByLabel("镜头标题")).toBeInViewport();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`unlinked-${theme}-${size.width}.png`),
      });
      if (size.width === 390) {
        const create = start.getByRole("button", {
          name: "开始制作镜头视频",
          exact: true,
        });
        await create.scrollIntoViewIfNeeded();
        await expect(create).toBeInViewport();
        const frame = (await start.boundingBox())!;
        const preview = (await start
          .locator(".storyboard-start-preview")
          .boundingBox())!;
        expect(preview.x + preview.width).toBeLessThanOrEqual(
          frame.x + frame.width,
        );
        await page.screenshot({
          path: info.outputPath(`unlinked-${theme}-mobile-actions.png`),
        });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await header.getByRole("button", { name: "画布", exact: true }).click();
  await expect(
    page.locator(".workbench-unlinked-shot").getByLabel("镜头标题"),
  ).toHaveValue("雨夜 · 拆开信封");
  await page.screenshot({ path: info.outputPath("unlinked-canvas.png") });
  await header.getByRole("button", { name: "看板", exact: true }).click();
  await start
    .getByRole("button", { name: "开始制作镜头视频", exact: true })
    .click();
  await expect(
    page.locator(".canvas-generation-drawer.video-node-composer"),
  ).toBeVisible();
  await expect(start).toHaveCount(0);
  await expect
    .poll(async () => {
      const response = await page.request.get(`${base}/storyboard`);
      return (await response.json()).shots[0].video_node_id;
    })
    .toBeTruthy();
  const storyboard = await page.request.get(`${base}/storyboard`);
  const shot = (await storyboard.json()).shots[0];
  expect(shot.video_node_id).toBeTruthy();
  expect(shot.shot_size).toBe("手部特写");
  await page.getByRole("button", { name: "新建分镜", exact: true }).click();
  await page.getByRole("button", { name: "保存分镜", exact: true }).click();
  await expect
    .poll(async () => {
      const response = await page.request.get(`${base}/storyboard`);
      const shots = (await response.json()).shots;
      return (
        shots.length === 2 &&
        shots.every((shot: { video_node_id: string | null }) =>
          Boolean(shot.video_node_id),
        )
      );
    })
    .toBe(true);
  await page.getByRole("tab", { name: "剧本", exact: true }).click();
  const text = page.getByRole("textbox", { name: "剧本文本", exact: true });
  await text.focus();
  await text.press("ControlOrMeta+A");
  expect(
    await text.evaluate(
      (element: HTMLTextAreaElement) =>
        element.selectionEnd > element.selectionStart,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "从选段新建镜头", exact: true })
    .click();
  await expect(
    page.locator(".storyboard-production-editor .video-node-composer"),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const response = await page.request.get(`${base}/storyboard`);
      const shots = (await response.json()).shots;
      return (
        shots.length === 3 &&
        shots.every((shot: { video_node_id: string | null }) =>
          Boolean(shot.video_node_id),
        )
      );
    })
    .toBe(true);
});

test("39镜分镜列表保留卡片高度，滚动后可选末镜", async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const { base, headers } = await createProject(page);
  const shots = Array.from({ length: 39 }, (_, index) => ({
    id: randomUUID(),
    title: `第${index + 1}镜 · 人物对话`,
    duration: 3,
  }));
  const saved = await page.request.put(`${base}/storyboard`, {
    headers,
    data: { expected_revision: 0, shots },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.reload();
  for (const name of ["文件", "人设", "场景", "道具"]) {
    if (name !== "文件")
      await page.getByRole("tab", { name, exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: `搜索${name}`, exact: true }),
    ).toBeVisible();
    expect(
      (await page.locator(".board-material-pane-heading").boundingBox())!
        .height,
    ).toBe(28);
    expect((await page.locator(".board-search").boundingBox())!.height).toBe(
      32,
    );
    if (name === "场景")
      await page.screenshot({
        path: info.outputPath("compact-scene-directory.png"),
      });
  }
  await page.getByRole("tab", { name: "分镜", exact: true }).click();
  const list = page.getByRole("region", { name: "镜头列表", exact: true });
  const cards = list.locator(".storyboard-shot");
  await expect(cards).toHaveCount(39);
  for (const theme of ["dark", "light"] as const) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setTheme(page, theme);
    for (const size of [
      { width: 1440, height: 900 },
      { width: 1024, height: 600 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      if (!(await list.isVisible()))
        await page.getByRole("tab", { name: "分镜", exact: true }).click();
      const header = page.locator(".visual-project-header");
      if (size.width >= 701) {
        const toggle = header.getByRole("group", { name: "工作台视图" });
        await expect(toggle).toBeVisible();
        const headerBox = (await header.boundingBox())!;
        const toggleBox = (await toggle.boundingBox())!;
        expect(toggleBox.y).toBeGreaterThanOrEqual(headerBox.y);
        expect(toggleBox.y + toggleBox.height).toBeLessThanOrEqual(
          headerBox.y + headerBox.height,
        );
        await header.getByRole("button", { name: "看板", exact: true }).click();
        await expect(page.locator(".workbench-local-tools")).toHaveCount(0);
        await header.getByRole("button", { name: "画布", exact: true }).click();
      } else {
        await header.getByRole("button", { name: "项目更多操作" }).click();
        await page.getByRole("menuitem", { name: "切换到看板" }).click();
        await header.getByRole("button", { name: "项目更多操作" }).click();
        await page.getByRole("menuitem", { name: "切换到画布" }).click();
      }
      await expect(
        page.locator(".board-main .workbench-view-toggle"),
      ).toHaveCount(0);
      await expect(page.locator(".workbench-local-tools")).toHaveCount(0);
      if (!(await list.isVisible()))
        await page.getByRole("tab", { name: "分镜", exact: true }).click();
      const pane = page.locator(".board-material-pane");
      const paneBox = (await pane.boundingBox())!;
      const createBox = (await page
        .getByRole("button", { name: "新建分镜", exact: true })
        .boundingBox())!;
      const importBox = (await page
        .getByRole("button", { name: "纳入已有视频", exact: true })
        .boundingBox())!;
      expect(Math.abs(createBox.y - importBox.y)).toBeLessThan(1);
      expect(createBox.height).toBe(32);
      expect((await list.boundingBox())!.y - paneBox.y).toBeLessThanOrEqual(
        180,
      );
      expect(
        await page
          .locator(".board-material-view-title")
          .evaluate((element) => getComputedStyle(element).fontSize),
      ).toBe("14px");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(
        page.getByRole("group", { name: "分镜显示方式", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("combobox", { name: "剧本分镜", exact: true }),
      ).toHaveText("全部分镜");
      await list.evaluate((element) => (element.scrollTop = 0));
      await expect
        .poll(() =>
          cards.evaluateAll((items) =>
            Math.min(
              ...items.map((item) => item.getBoundingClientRect().height),
            ),
          ),
        )
        .toBeGreaterThanOrEqual(56);
      expect(
        await list.evaluate(
          (element) => element.scrollHeight > element.clientHeight,
        ),
      ).toBe(true);
      await expect(
        cards.first().getByText(shots[0].title, { exact: true }),
      ).toBeInViewport();
      const last = cards.last().getByRole("button");
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
      await last.click();
      await expect(last).toHaveAttribute("aria-pressed", "true");
      await page.screenshot({
        path: info.outputPath(`shots-${theme}-${size.width}.png`),
      });
    }
  }
});

test("白模深色视口、弹层与创建面板保存保护", async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1584, height: 994 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { base, headers } = await createProject(page);
  const document = createSceneDocument();
  document.objects = [
    createSceneObject(
      {
        id: "box",
        name: "立方体",
        category: "基础",
        kind: "primitive",
        shape: "box",
      },
      { x: 0, y: 0.5, z: 0 },
    ),
  ];
  document.gridVisible = true;
  document.time = {
    date: "2026-11-21",
    hour: 12,
    latitude: 35,
    northOffset: 0,
    speed: 1,
    paused: true,
    moonIntensity: 1,
    starIntensity: 1,
  };
  const created = await page.request.post(`${base}/previs-scenes`, {
    headers,
    data: { title: "测试", format_version: 1, document },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  await setTheme(page, "dark");
  await page.getByRole("tab", { name: "白模预演", exact: true }).click();
  await page.getByRole("button", { name: "测试", exact: true }).click();
  const viewport = page.locator(".visual-previs-host .worldCanvas");
  await expect(viewport).toBeVisible({ timeout: 45_000 });
  const host = page.locator(".visual-previs-host");
  await expect(host).toHaveAttribute("data-previs-theme", "dark");
  await expect
    .poll(() =>
      host.evaluate((element) =>
        getComputedStyle(element)
          .getPropertyValue("--previs-editor-background")
          .trim(),
      ),
    )
    .toBe("#343a3d");
  await expect
    .poll(() =>
      contrast(host.getByRole("button", { name: "世界设置", exact: true })),
    )
    .toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: info.outputPath("previs-dark.png") });
  const scenesBefore = await (
    await page.request.get(`${base}/previs-scenes`)
  ).json();
  const addScene = page.getByRole("button", {
    name: "添加预演场景",
    exact: true,
  });
  await expect(
    page.getByRole("button", { name: "从剧本创建", exact: true }),
  ).toHaveCount(0);
  await addScene.click();
  await expect(
    page.getByRole("menuitem", { name: "新建空白场景" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "从剧本创建", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("previs-create-menu-dark.png"),
  });
  await page.keyboard.press("Escape");
  await expect(addScene).toBeFocused();
  const title = page
    .locator(".visual-previs-bar")
    .getByRole("textbox", { name: "场景名称", exact: true });
  await page.getByText("场景设置", { exact: true }).click();
  await title.fill("测试·已修改");
  await page.route(`**${base}/previs-scenes/*`, (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 503, json: { detail: "验收保存失败" } })
      : route.fallback(),
  );
  await openScriptCreation(page);
  await expect(page.getByText("验收保存失败", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "从剧本创建预演" }),
  ).toHaveCount(0);
  await page.unroute(`**${base}/previs-scenes/*`);
  await openScriptCreation(page);
  const draft = page.getByRole("region", { name: "从剧本创建预演" });
  await expect(draft).toBeVisible();
  await expect(title).toBeDisabled();
  await expect(viewport).toBeVisible();
  await draft
    .getByLabel("剧本文本", { exact: true })
    .fill("室内 · 咖啡馆 · 夜\n马奎尔：你来了。\n女孩：我来了。");
  await page.screenshot({ path: info.outputPath("previs-create-dark.png") });
  await draft.getByRole("button", { name: "规则解析", exact: true }).click();
  await expect(page.locator(".previs-candidate .worldCanvas")).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.locator(".visual-previs-host .worldCanvas")).toHaveCount(0);
  await expect(draft.getByRole("button", { name: "创建白模场景" })).toBeEnabled(
    { timeout: 45_000 },
  );
  await page.screenshot({ path: info.outputPath("previs-create-preview.png") });
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.locator(".previs-candidate .worldCanvas")).toBeVisible();
  await expect(draft).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(draft.getByRole("button", { name: "创建白模场景" })).toBeEnabled(
    { timeout: 45_000 },
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(
    draft.getByRole("button", { name: "创建白模场景" }),
  ).toBeDisabled();
  await expect(draft.getByLabel("剧本文本", { exact: true })).toHaveValue(
    /马奎尔/,
  );
  await page.setViewportSize({ width: 1584, height: 994 });
  await page.getByRole("tab", { name: "剧本", exact: true }).click();
  await expect(page.locator(".previs-candidate .worldCanvas")).toHaveCount(0);
  await page.getByRole("tab", { name: "白模预演", exact: true }).click();
  await expect(page.locator(".previs-candidate .worldCanvas")).toBeVisible();
  await draft.getByRole("button", { name: "取消", exact: true }).click();
  await expect(viewport).toBeVisible();
  await expect(title).toHaveValue("测试·已修改");
  await expect(title).toBeEnabled();
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    await expect(host).toHaveAttribute("data-previs-theme", theme);
    await host.getByRole("button", { name: "世界设置", exact: true }).click();
    await page.screenshot({
      path: info.outputPath(`previs-world-${theme}.png`),
    });
    await host.getByRole("button", { name: "世界设置", exact: true }).click();
  }
  const captures = await page.evaluate(async (document) => {
    const moduleUrl = "/vendor/toonflow/truman-map/sceneViewport.ts";
    const { createSceneViewport } = await import(moduleUrl);
    const holder = window.document.createElement("div");
    holder.className = "truman-map-host";
    const canvas = window.document.createElement("canvas");
    canvas.style.cssText =
      "position:fixed;left:-9999px;width:320px;height:240px";
    holder.append(canvas);
    window.document.body.append(holder);
    const viewport = createSceneViewport(canvas, {
      document,
      autoRender: false,
      globalFilmFormat: false,
      showHelpers: false,
      pixelRatio: 1,
      loadModel: async () => {
        throw new Error("fixture uses primitives");
      },
      onSelect() {},
      onTransform() {},
      onViewChange() {},
      onError() {},
    });
    const original = window.document.documentElement.dataset.theme;
    try {
      const images = [];
      for (const theme of ["light", "dark"]) {
        window.document.documentElement.dataset.theme = theme;
        holder.dataset.previsTheme = theme;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        images.push([
          ...new Uint8Array(
            await (await viewport.capture(undefined, 320)).arrayBuffer(),
          ),
        ]);
      }
      return images;
    } finally {
      viewport.dispose();
      holder.remove();
      window.document.documentElement.dataset.theme = original;
    }
  }, document);
  expect(captures[0]).toEqual(captures[1]);
  const scenesAfter = await (
    await page.request.get(`${base}/previs-scenes`)
  ).json();
  expect(scenesAfter).toHaveLength(scenesBefore.length);
  await openScriptCreation(page);
  await draft
    .getByLabel("剧本文本", { exact: true })
    .fill("室内 · 咖啡馆 · 夜\n马奎尔：再见。\n女孩：再见。");
  await draft.getByRole("button", { name: "规则解析", exact: true }).click();
  await expect(draft.getByRole("button", { name: "创建白模场景" })).toBeEnabled(
    { timeout: 45_000 },
  );
  await page.route(`**${base}/previs-scenes`, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 503, json: { detail: "验收创建失败" } })
      : route.fallback(),
  );
  await draft.getByRole("button", { name: "创建白模场景" }).click();
  await expect(draft.getByRole("alert")).toContainText("验收创建失败");
  await expect(draft.getByLabel("剧本文本", { exact: true })).toHaveValue(
    /再见/,
  );
  await page.unroute(`**${base}/previs-scenes`);
  await draft.getByRole("button", { name: "创建白模场景" }).click();
  await expect(draft).toHaveCount(0);
  await expect(viewport).toBeVisible();
  expect(
    await (await page.request.get(`${base}/previs-scenes`)).json(),
  ).toHaveLength(scenesBefore.length + 1);
  expect(errors).toEqual([]);
});
