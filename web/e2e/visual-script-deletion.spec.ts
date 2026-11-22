import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createSceneDocument } from "../vendor/toonflow/truman-map/sceneDocument";

test("剧本目录删除和预演删除使用项目弹窗并保留取消与保存恢复", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  const nativeDialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    nativeDialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/apps/visual-workshop");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const created = await page.request.post("/v1/visual-workshop/projects", {
    headers,
    data: { title: "剧本删除验收", kind: "canvas" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const base = `/v1/visual-workshop/projects/${(await created.json()).id}`;
  const episodes = [1, 2].map((number) => ({
    id: randomUUID(),
    title: `第 ${number} 集`,
    scenes: [1, 2].map((scene) => ({
      id: randomUUID(),
      title: `第 ${number}-${scene} 场`,
      heading: "室内 · 夜",
      text: `场次 ${number}-${scene} 正文`,
    })),
  }));
  const saved = await page.request.put(`${base}/script`, {
    headers,
    data: { expected_revision: 0, episodes },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  const stage = await page.request.post(`${base}/previs-scenes`, {
    headers,
    data: {
      title: "待删除场景",
      format_version: 1,
      document: createSceneDocument(),
    },
  });
  expect(stage.ok(), await stage.text()).toBeTruthy();
  await page.goto(
    `/apps/visual-workshop/projects/${base.split("/").at(-1)}/canvas`,
  );
  await page.getByRole("tab", { name: "剧本", exact: true }).click();
  for (const theme of ["dark", "light"] as const) {
    await page.setViewportSize({ width: 1440, height: 900 });
    if ((await page.locator("html").getAttribute("data-theme")) !== theme)
      await page
        .getByRole("button", {
          name: theme === "dark" ? "切换深色" : "切换浅色",
          exact: true,
        })
        .click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole("tab", { name: "剧本", exact: true }).click();
      const sidebar = page.getByRole("button", { name: "展开剧本侧栏" });
      await expect(sidebar).toHaveAttribute(
        "aria-expanded",
        width < 1024 ? "false" : "true",
      );
      if (width < 1024) await sidebar.click();
      const remove = page.getByRole("button", {
        name: "删除场次 第 1-1 场",
        exact: true,
      });
      await expect(remove).toBeVisible();
      const row = remove.locator("..");
      const select = row.getByRole("button", {
        name: "第 1-1 场",
        exact: true,
      });
      const removeBox = (await remove.boundingBox())!;
      const selectBox = (await select.boundingBox())!;
      expect(removeBox.x).toBeGreaterThanOrEqual(
        selectBox.x + selectBox.width - 1,
      );
      expect(removeBox.width).toBe(32);
      await remove.click();
      const dialog = page.getByRole("alertdialog", {
        name: "删除场次“第 1-1 场”？",
      });
      await expect(dialog).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`script-delete-${theme}-${width}.png`),
      });
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await expect(remove).toBeFocused();
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel("剧本文本", { exact: true }).fill("保留当前未保存编辑");
  await page
    .getByRole("button", { name: "删除场次 第 1-2 场", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await expect(page.getByLabel("剧本文本", { exact: true })).toHaveValue(
    "保留当前未保存编辑",
  );
  await page.route(`**${base}/script`, (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 503, json: { detail: "验收保存失败" } })
      : route.fallback(),
  );
  await page.getByRole("button", { name: "保存剧本", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("验收保存失败");
  await expect(
    page.getByRole("button", { name: "删除场次 第 1-2 场", exact: true }),
  ).toHaveCount(0);
  await page.unroute(`**${base}/script`);
  await page.getByRole("button", { name: "保存剧本", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存剧本", exact: true }),
  ).toBeDisabled();
  const document = await (await page.request.get(`${base}/script`)).json();
  expect(document.episodes[0].scenes).toHaveLength(1);
  expect(document.episodes[0].scenes[0].text).toBe("保留当前未保存编辑");
  await page
    .getByRole("button", { name: "删除整集 第 2 集", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toContainText("全部 2 个场次");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await page.getByRole("button", { name: "保存剧本", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存剧本", exact: true }),
  ).toBeDisabled();
  expect(
    (await (await page.request.get(`${base}/script`)).json()).episodes,
  ).toHaveLength(1);
  await page.getByRole("tab", { name: "白模预演", exact: true }).click();
  const removeStage = page.getByRole("button", {
    name: "删除场景 待删除场景",
    exact: true,
  });
  await removeStage.click();
  const dialog = page.getByRole("alertdialog", {
    name: "删除预演场景“待删除场景”？",
  });
  await expect(dialog).toContainText("已发送的画布素材会保留");
  await page.screenshot({ path: info.outputPath("previs-delete.png") });
  await page.keyboard.press("Escape");
  await expect(removeStage).toBeFocused();
  await removeStage.click();
  await page.route(`**${base}/previs-scenes/*`, (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({ status: 503, json: { detail: "验收删除失败" } })
      : route.fallback(),
  );
  await dialog.getByRole("button", { name: "删除", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("验收删除失败");
  await page.unroute(`**${base}/previs-scenes/*`);
  await dialog.getByRole("button", { name: "删除", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(removeStage).toHaveCount(0);
  expect(
    await (await page.request.get(`${base}/previs-scenes`)).json(),
  ).toEqual([]);
  expect(nativeDialogs).toEqual([]);
});
