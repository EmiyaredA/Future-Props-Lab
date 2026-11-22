import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("点击集名按块串联分镜、排序和保存恢复", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/apps/visual-workshop");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const created = await page.request.post("/v1/visual-workshop/projects", {
    headers,
    data: { title: "整集分镜验收", kind: "canvas" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const project = (await created.json()).id;
  const base = `/v1/visual-workshop/projects/${project}`;
  const scenes = [
    {
      id: randomUUID(),
      title: "镜01｜欢迎来到方块世界｜8秒",
      heading: "外景 · 草原 · 白天",
      text: "全景缓慢推进。三位角色跃出像素粒子。\n声音：轻快木琴。",
    },
    {
      id: randomUUID(),
      title: "镜02｜宏伟计划｜9秒",
      heading: "外景 · 草原 · 白天",
      text: "中景横移。角色在泥地上画出实验室。",
    },
    {
      id: randomUUID(),
      title: "镜03｜盖起屋顶｜8秒",
      heading: "外景 · 木屋 · 白天",
      text: "固定机位。红莉栖为木屋补上屋顶。",
    },
  ];
  const episode = { id: randomUUID(), title: "第一集｜方块日常", scenes };
  const saved = await page.request.put(`${base}/script`, {
    headers,
    data: { expected_revision: 0, episodes: [episode] },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.goto(`/apps/visual-workshop/projects/${project}/canvas`);
  await page.getByRole("tab", { name: "剧本", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "按镜头标题整理" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "编辑第一集｜方块日常", exact: true })
    .click();
  const sequence = page.getByRole("list", { name: "本集分镜顺序" });
  const titles = () => sequence.getByRole("heading").allTextContents();
  expect(await titles()).toEqual(scenes.map((scene) => scene.title));
  await page.screenshot({ path: info.outputPath("episode-blocks-light.png") });
  await page
    .getByRole("button", { name: "上移分镜 镜03｜盖起屋顶｜8秒" })
    .click();
  expect(await titles()).toEqual([
    scenes[0].title,
    scenes[2].title,
    scenes[1].title,
  ]);
  await page
    .getByRole("button", { name: "拖动排序 镜02｜宏伟计划｜9秒" })
    .dragTo(sequence.getByRole("listitem").first());
  expect(await titles()).toEqual([
    scenes[1].title,
    scenes[0].title,
    scenes[2].title,
  ]);
  await page.route(
    `**${base}/script`,
    async (route) => {
      if (route.request().method() === "PUT")
        await route.fulfill({
          status: 409,
          json: { detail: "保存冲突，请重试" },
        });
      else await route.fallback();
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "保存剧本", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(await titles()).toEqual([
    scenes[1].title,
    scenes[0].title,
    scenes[2].title,
  ]);
  await page.getByRole("button", { name: "保存剧本", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存剧本", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await page.getByRole("tab", { name: "剧本", exact: true }).click();
  await page
    .getByRole("button", { name: "编辑第一集｜方块日常", exact: true })
    .click();
  expect(await titles()).toEqual([
    scenes[1].title,
    scenes[0].title,
    scenes[2].title,
  ]);
  await page.getByRole("button", { name: "切换深色", exact: true }).click();
  await page.screenshot({ path: info.outputPath("episode-blocks-dark.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sequence.getByRole("heading").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: info.outputPath("episode-blocks-mobile.png") });
  await sequence
    .getByRole("button", { name: "编辑分镜", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("分镜名称", { exact: true })).toHaveValue(
    scenes[1].title,
  );
  await expect(page.getByLabel("剧本文本", { exact: true })).toHaveValue(
    scenes[1].text,
  );
});
