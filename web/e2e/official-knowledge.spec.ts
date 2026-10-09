import { newDocument, saveNote } from "./thought-helpers";
import { expect, test } from "@playwright/test";
import {
  importAndPublish,
  legacyTarget,
  root,
  community,
} from "./official-import-helpers";
import { setResponsiveTheme } from "./responsive-capture";

test("administrators explicitly import private notes then publish through the ordinary dialog", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await page.goto("/apps/thought-workshop/community");
  await page
    .getByRole("button", { name: "导入现有官方文档", exact: true })
    .click();
  const dialog = page.getByRole("alertdialog", { name: "导入现有官方文档" });
  await expect(dialog).toContainText("12 个私人知识库");
  await expect(dialog).toContainText("93 篇文章");
  await expect(dialog).toContainText("不会自动发布");
  await dialog.getByRole("button", { name: "导入到当前 Workspace" }).click();
  await expect(page.getByLabel("笔记标题", { exact: true })).toBeVisible({
    timeout: 20000,
  });
  const library = page.url().match(/knowledge-bases\/([^/?#]+)/)![1];
  const directory = await (
    await page.request.get(root + `/knowledge-bases/${library}/directory`)
  ).json();
  expect(
    (
      await (
        await page.request.get(community + `/libraries/${library}/publication`)
      ).json()
    ).publication,
  ).toBeNull();
  await page
    .getByRole("button", { name: "知识库更多操作", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "发布到知识社区", exact: true })
    .click();
  const publish = page.getByRole("alertdialog", { name: "发布到知识社区" });
  await expect(publish.getByLabel("只读发布", { exact: true })).toBeChecked();
  await publish.getByLabel("官方发布", { exact: true }).check();
  await expect(publish.getByLabel("超级管理员可编辑")).toBeChecked();
  await expect(
    publish.getByLabel("管理员可编辑", { exact: true }),
  ).toBeChecked();
  await publish.getByRole("button", { name: "全选", exact: true }).click();
  await publish.getByRole("button", { name: "发布选定文章" }).click();
  await expect(publish).not.toBeVisible();
  const pub = (
    await (
      await page.request.get(community + `/libraries/${library}/publication`)
    ).json()
  ).publication;
  expect(pub.is_official && pub.read_only).toBe(true);
  await page.goto(
    `/apps/thought-workshop/community/${pub.id}/documents/${directory.documents[0].id}`,
  );
  await expect(
    page.getByRole("heading", {
      name: directory.documents[0].title,
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".official-badge")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "编辑文档", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: directory.documents[0].title,
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("official-standard-note.png"),
  });
});

test("old links resolve visible database notes and the common reader adapts to both themes", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const { publication } = await importAndPublish(page, "technical");
  const target = await legacyTarget(page, "technical", "scope", publication.id);
  await page.goto(
    "/apps/thought-workshop/official-knowledge-bases/technical/documents/scope",
  );
  await expect(page.locator("main")).toBeVisible();
  await expect
    .poll(
      async () =>
        page.url().includes("/community/") ||
        (await page
          .getByRole("link", { name: /Future Props Lab 技术文档/ })
          .count()) > 0,
    )
    .toBe(true);
  if (!page.url().includes("/community/"))
    await page
      .locator(
        `a[href="/apps/thought-workshop/community/${publication.id}/documents/${target.note_id}"]`,
      )
      .click();
  await expect(page).toHaveURL(
    `/apps/thought-workshop/community/${publication.id}/documents/${target.note_id}`,
  );
  await expect(
    page.getByRole("heading", { name: "项目定位与系统边界", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".thought-mermaid-preview svg")).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator(".diagram-viewer svg[role=img]")).toBeVisible();
  for (const width of [1600, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await setResponsiveTheme(page, theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`official-reader-${width}-${theme}.png`),
      });
    }
  }
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "项目定位与系统边界", exact: true }),
  ).toBeVisible();
  await page.goto(
    "/apps/thought-workshop/official-knowledge-bases/missing/documents/private",
  );
  await expect(page.getByRole("status")).toContainText("尚未导入并发布");
});

test("unsaved personal notes keep their guard before navigating to published official notes", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { publication, home } = await importAndPublish(page, "general");
  await page.goto("/apps/thought-workshop");
  await newDocument(page);
  const url = page.url();
  const id = url.split("/").pop();
  await page.route(`**/v1/thought-workshop/notes/${id}`, (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 503, json: { detail: "隔离测试保存失败" } })
      : route.continue(),
  );
  await page
    .getByRole("textbox", { name: "笔记正文", exact: true })
    .fill("保留个人草稿，阅读官方指南前先保存。");
  await page.getByRole("button", { name: "我的知识库", exact: true }).click();
  const guard = page.getByRole("alertdialog", { name: "仍有未保存的内容" });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page).toHaveURL(url);
  await page.unroute(`**/v1/thought-workshop/notes/${id}`);
  await saveNote(page);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.goto(
    `/apps/thought-workshop/community/${publication.id}/documents/${home}`,
  );
  await expect(
    page.getByRole("heading", { name: publication.title, exact: true }),
  ).toBeVisible();
  await page.goto(url);
  await expect(
    page.getByRole("textbox", { name: "笔记正文", exact: true }),
  ).toContainText("保留个人草稿");
});
