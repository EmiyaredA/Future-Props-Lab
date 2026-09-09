import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`uploads and edits Skill tags at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/integrations/skills");
    const name = `skill-tags-${viewport.width}-${Date.now()}`;
    await page.getByRole("button", { name: "上传 Skill", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "skill.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(
        zipSync({
          "SKILL.md": strToU8(
            `---\nname: ${name}\ndescription: Browser tag test\n---\n# Fixture`,
          ),
        }),
      ),
    });
    await dialog.getByRole("textbox").fill("MiniMax H3，视频生成");
    await dialog.getByRole("switch", { name: "导入后启用" }).click();
    const imported = page.waitForResponse(
      (response) =>
        response.url().endsWith("/v1/integrations/skills") &&
        response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "上传并校验" }).click();
    const response = await imported;
    expect(response.status()).toBe(201);
    const skill = await response.json();
    expect(skill.tags).toEqual(["MiniMax H3", "视频生成"]);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("textbox", { name: "搜索 Skill" }).fill(name);
    const card = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    await expect(card.getByText("视频生成", { exact: true })).toBeVisible();
    const edit = card.getByRole("button", { name: `编辑 ${name} 标签` });
    await edit.click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill("MiniMax H3,产品广告,产品广告");
    const updated = page.waitForResponse(
      (reply) =>
        reply.url().endsWith(`/v1/integrations/skills/${skill.id}`) &&
        reply.request().method() === "PATCH",
    );
    await dialog.getByRole("button", { name: "保存标签" }).click();
    const changed = await (await updated).json();
    expect(changed.tags).toEqual(["MiniMax H3", "产品广告"]);
    expect(changed.version_count).toBe(1);
    await expect(card.getByText("产品广告", { exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Skill 标签筛选" }).click();
    await page.getByRole("option", { name: "产品广告", exact: true }).click();
    await expect(card).toBeVisible();
    await edit.click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(edit).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await edit.click();
    await page.getByRole("dialog").getByRole("textbox").fill("");
    await page.getByRole("button", { name: "保存标签", exact: true }).click();
    await expect(card.getByText("无标签", { exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Skill 标签筛选" }).click();
    await page.getByRole("option", { name: "无标签", exact: true }).click();
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: `删除 ${name}` }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "删除", exact: true })
      .click();
    await expect(card).toHaveCount(0);
  });
}
