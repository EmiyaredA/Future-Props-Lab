import { mountIndependentPrograms } from "./studio-service-fixtures";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const catalog = {
  revision: 7,
  suppliers: [
    {
      id: "senseaudio",
      name: "SenseAudio",
      origin: "user",
      template_key: null,
      managed_fields: [],
    },
  ],
  providers: [
    {
      id: "gateway",
      supplier_id: "senseaudio",
      name: "通用模型网关",
      kind: "openai",
      base_url: "https://example.test/v1",
      enabled: true,
      has_api_key: true,
      api_key_hint: "1234",
      origin: "user",
      managed_fields: [],
      models: [
        {
          id: "s2",
          provider_id: "gateway",
          slug: "senseaudio-s2",
          label: "SenseAudio S2",
          description: "",
          capabilities: ["chat", "tools"],
          categories: ["text_generation"],
          enabled: true,
        },
        {
          id: "flash",
          provider_id: "gateway",
          slug: "senseaudio-s2-flash",
          label: "SenseAudio S2 Flash",
          description: "",
          capabilities: ["chat", "tools"],
          categories: ["text_generation"],
          enabled: true,
        },
        {
          id: "vl",
          provider_id: "gateway",
          slug: "senseaudio-vl-1.0",
          label: "SenseAudio VL 1.0",
          description: "",
          capabilities: ["chat", "vision", "tools"],
          categories: ["text_generation"],
          enabled: true,
        },
        {
          id: "lite",
          provider_id: "gateway",
          slug: "senseaudio-vl-lite",
          label: "SenseAudio VL Lite",
          description: "",
          capabilities: ["chat", "vision"],
          categories: ["text_generation"],
          enabled: false,
        },
      ],
    },
    {
      id: "images",
      supplier_id: "senseaudio",
      name: "图片生成接口",
      kind: "senseaudio_image",
      base_url: "",
      enabled: true,
      has_api_key: false,
      api_key_hint: "",
      origin: "user",
      managed_fields: [],
      models: [
        {
          id: "image",
          provider_id: "images",
          slug: "senseaudio-image",
          label: "SenseAudio Image",
          description: "",
          capabilities: ["image_generation"],
          categories: ["image_generation"],
          enabled: true,
        },
      ],
    },
  ],
};

test("model directory and supplier connections work in both themes and small screens", async ({
  page,
}) => {
  test.setTimeout(75_000);
  await page.route("**/v1/model-providers", (route) =>
    route.fulfill({ json: catalog }),
  );
  await page.goto("/model-service");
  await expect(
    page.getByRole("tab", { name: "模型目录", exact: true }),
  ).toHaveAttribute("aria-selected", "true", { timeout: 20_000 });
  const output = resolve("../.local/output/model-service");
  await mkdir(output, { recursive: true });
  for (const theme of ["dark", "light"]) {
    for (const width of [1600, 1100, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page
        .getByRole("button", {
          name: theme === "dark" ? "深色" : "浅色",
          exact: true,
        })
        .click();
      await page.getByRole("tab", { name: "模型目录", exact: true }).click();
      await page.getByRole("tab", { name: "文本生成", exact: true }).click();
      await expect(page.getByText("4 个模型")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: resolve(output, `directory-${theme}-${width}.png`),
      });
      await page.getByRole("tab", { name: "接入管理", exact: true }).click();
      await page
        .locator(".mc-connection-item-main", { hasText: "通用模型网关" })
        .click();
      await expect(page.getByRole("tab", { name: /已接入模型/ })).toBeVisible();
      await page.screenshot({
        path: resolve(output, `connections-${theme}-${width}.png`),
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.getByRole("tab", { name: "连接配置" }).click();
      await expect(page.getByText("已配置 ···· 1234")).toBeVisible();
      await page.getByRole("button", { name: "编辑连接", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "编辑接入连接" });
      await expect(
        dialog.getByRole("combobox", { name: "接入协议" }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("combobox", { name: "所属协议类型" }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(
        page.getByRole("button", { name: "编辑连接", exact: true }),
      ).toBeFocused();
    }
  }
});

test("test action creates a separate conversation with the selected model", async ({
  page,
  baseURL,
}) => {
  if (process.env.FPL_E2E_SERVICE_RELEASES)
    await mountIndependentPrograms(page, baseURL!);
  await page.route("**/v1/model-providers", (route) =>
    route.fulfill({ json: catalog }),
  );
  const existing = {
    id: "old",
    title: "原有会话",
    model_id: "s2",
    model_slug: "senseaudio-s2",
    revision: 0,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    system_prompt: "",
    temperature: 0.7,
    max_tokens: 1024,
    messages: [],
    tools: [],
    draft_attachments: [],
  };
  const created = {
    ...existing,
    id: "new",
    title: "新测试",
    model_id: "vl",
    model_slug: "senseaudio-vl-1.0",
  };
  let posts = 0;
  let patches = 0;
  await page.route("**/v1/model-test/conversations", async (route) => {
    if (route.request().method() === "POST") {
      posts += 1;
      expect(route.request().postDataJSON().model_id).toBe("vl");
      await route.fulfill({ json: created });
    } else
      await route.fulfill({
        json: { items: posts ? [created, existing] : [existing] },
      });
  });
  await page.route("**/v1/model-test/conversations/old", async (route) => {
    if (route.request().method() === "PATCH") patches += 1;
    await route.fulfill({ json: existing });
  });
  await page.route("**/v1/model-test/conversations/new", (route) =>
    route.fulfill({ json: created }),
  );
  await page.goto("/model-service");
  await page
    .getByRole("button", { name: "测试 SenseAudio VL 1.0", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "模型测试", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "测试模型" })).toContainText(
    "SenseAudio VL 1.0",
  );
  expect(posts).toBe(1);
  expect(patches).toBe(0);
});

test("connection and model changes persist through the workspace API", async ({
  page,
}) => {
  const name = `目录验收-${Date.now()}`;
  await page.goto("/model-service");
  await page.getByRole("tab", { name: "接入管理", exact: true }).click();
  await page
    .getByRole("button", { name: "添加连接", exact: true })
    .first()
    .click();
  await page.getByRole("textbox", { name: "连接名称" }).fill(`${name}-连接`);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .locator(".mc-connection-item-main", { hasText: `${name}-连接` })
    .click();
  await page.getByRole("button", { name: "添加模型", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "接入连接" })).toContainText(
    `${name}-连接`,
  );
  await page
    .getByRole("textbox", { name: "模型标识" })
    .fill("catalog-lifecycle-test");
  await page.getByRole("textbox", { name: "显示名称" }).fill(`${name}-模型`);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await page.getByRole("textbox", { name: "搜索模型" }).fill(`${name}-模型`);
  await expect(page.getByText("1 个模型", { exact: true })).toBeVisible();
  await expect(page.getByText(`${name}-连接`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "默认模型用途", exact: true }).click();
  await page
    .getByRole("combobox", { name: "对话默认模型", exact: true })
    .click();
  await page
    .getByRole("option", { name: `${name}-连接 / ${name}-模型`, exact: true })
    .click();
  await page.getByRole("button", { name: "保存更改", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "默认模型用途", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "对话默认模型", exact: true }),
  ).toContainText(`${name}-模型`);
});
