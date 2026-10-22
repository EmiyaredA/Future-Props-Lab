import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const directory = resolve("../.local/acceptance/screenshots");
test("模板配置、版本验收、返修复验与最终采用形成闭环", async ({ page }) => {
  test.setTimeout(120000);
  mkdirSync(directory, { recursive: true });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/visual-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const created = await page.request.post("/v1/visual-workshop/projects", {
    headers,
    data: { title: "通用验收测试项目", kind: "canvas" },
  });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).id,
    base = `/v1/visual-workshop/projects/${id}`;
  const uploaded = await page.request.post(`${base}/node-uploads`, {
    headers,
    multipart: {
      expected_revision: "0",
      file: { name: "合成验收素材.png", mimeType: "image/png", buffer: PNG },
    },
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  const node = (await uploaded.json()).nodes[0];
  await page.goto(`/apps/visual-workshop/projects/${id}/canvas`);
  await page.getByRole("button", { name: "项目验收", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "选择参考模板" }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(directory, "template-library.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "使用模板并配置" }).click();
  for (const title of ["角色外观一致", "动作与道具"]) {
    await page.getByRole("button", { name: new RegExp(title) }).click();
    await page
      .getByRole("radiogroup", { name: "检查方式", exact: true })
      .getByRole("radio", { name: "人工确认", exact: true })
      .click();
  }
  await page.getByLabel("强制验收后才能采用输出").check();
  await page.screenshot({
    path: resolve(directory, "standard-editor.png"),
    fullPage: true,
    animations: "disabled",
  });
  const policyControl = page.getByLabel("强制验收后才能采用输出");
  const controlSize = await policyControl.boundingBox();
  expect(controlSize?.width).toBe(17);
  expect(controlSize?.height).toBe(17);
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.screenshot({
    path: resolve(directory, "standard-editor-dark.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "验收清单", exact: true }).click();
  await expect(page.getByLabel("标准名称")).toBeVisible();
  await expect(page.getByLabel("验收项名称")).not.toBeVisible();
  await page.getByRole("button", { name: "条目详情", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByLabel("验收项名称")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBeTruthy();
  await page.screenshot({
    path: resolve(directory, "standard-editor-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole("button", { name: "发布并选择验收版本" }).click();
  await expect(
    page.getByRole("heading", { name: "选择输出版本开始验收" }),
  ).toBeVisible();
  let canvas = await (await page.request.get(`${base}/canvas`)).json();
  const candidate = await page.request.post(
    `${base}/nodes/${node.id}/output-uploads`,
    {
      headers,
      multipart: {
        expected_revision: String(canvas.revision),
        file: { name: "返修候选-v2.png", mimeType: "image/png", buffer: PNG },
      },
    },
  );
  expect(candidate.ok(), await candidate.text()).toBeTruthy();
  await page.getByRole("button", { name: "刷新版本列表" }).click();
  await page.getByLabel(/v2 · 候选版本/).check();
  await page.getByRole("button", { name: /开始验收/ }).click();
  await expect(
    page.getByRole("heading", { name: "逐项验收结果" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "动作与道具 人工确认 待确认",
      exact: true,
    }),
  ).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: /动作与道具/ }).click();
  await page.getByLabel("判断说明").fill("道具接触不自然，需要返修");
  await page.getByRole("button", { name: "需修改", exact: true }).click();
  await page.getByRole("button", { name: "返修草稿", exact: true }).click();
  await expect(page.getByLabel("返修提示词")).toContainText("道具接触不自然");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.screenshot({
    path: resolve(directory, "version-result.png"),
    fullPage: true,
    animations: "disabled",
  });
  canvas = await (await page.request.get(`${base}/canvas`)).json();
  await page.request.post(`${base}/nodes/${node.id}/output-uploads`, {
    headers,
    multipart: {
      expected_revision: String(canvas.revision),
      file: { name: "返修-v3.png", mimeType: "image/png", buffer: PNG },
    },
  });
  await page
    .getByRole("button", { name: "选择返修版本复验", exact: true })
    .click();
  await page.getByRole("button", { name: "刷新版本列表" }).click();
  await page.getByLabel(/v3 · 候选版本/).check();
  await page.getByRole("button", { name: /开始复验/ }).click();
  await expect(
    page.getByText("输出 v3 · 标准 v1 · 检查完成", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  for (const title of ["角色外观一致", "动作与道具", "表演与情绪"]) {
    await page.getByRole("button", { name: new RegExp(title) }).click();
    await page.getByRole("button", { name: "确认通过", exact: true }).click();
  }
  await page.getByRole("button", { name: "确认整体验收结论" }).click();
  await expect(
    page.getByRole("button", { name: "设为最终输出" }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(directory, "recheck.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "设为最终输出" }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`${base}/canvas`)).json()).nodes[0]
          .final_version,
    )
    .toBe(3);
  for (const width of [390, 768, 1366, 1600]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBeTruthy();
  }
});
