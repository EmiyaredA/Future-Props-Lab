import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

for (const width of [390, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`provider branding and DeepSeek forms at ${width}px in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.route("**/v1/model-providers", async (route) => {
        await route.fulfill({
          json: {
            revision: 1,
            suppliers: [],
            default_model_ids: {},
            providers: [
              {
                id: "deepseek",
                name: "DeepSeek 官方",
                kind: "deepseek",
                base_url: "https://api.deepseek.com",
                enabled: true,
                has_api_key: true,
                api_key_hint: "1234",
                models: [
                  {
                    id: "flash",
                    provider_id: "deepseek",
                    slug: "deepseek-flash",
                    label: "DeepSeek Flash",
                    description: "官方对话模型",
                    capabilities: ["chat", "tools", "vision"],
                    categories: ["text_generation"],
                    enabled: true,
                  },
                ],
              },
              {
                id: "qwen",
                name: "本地 Qwen 语音",
                kind: "local_qwen_tts",
                base_url: "",
                enabled: true,
                has_api_key: false,
                api_key_hint: "",
                models: [],
              },
            ],
          },
        });
      });
      await page.goto("/model-service");
      await expect(
        page.getByRole("heading", { name: "模型服务", exact: true }),
      ).toBeVisible();
      if (theme === "dark")
        await page.getByRole("button", { name: "深色", exact: true }).click();
      else
        await page.getByRole("button", { name: "浅色", exact: true }).click();
      for (const brand of ["qwen", "deepseek"]) {
        const icon = page.locator(
          `.mc-provider-strip img[src="/providers/${brand}-logo.svg"]`,
        );
        await expect(icon).toBeVisible();
        expect(
          await icon.evaluate(
            (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
          ),
        ).toBe(true);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: resolve(
          "..",
          ".local/deepseek-integration",
          `catalog-${width}-${theme}.png`,
        ),
        fullPage: true,
      });
      await page.getByRole("button", { name: /^添加接入连接/ }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("combobox", { name: "接入协议" }).click();
      await page
        .getByRole("option", { name: "DeepSeek 官方", exact: true })
        .click();
      await expect(
        dialog.getByRole("textbox", { name: "服务地址" }),
      ).toHaveAttribute("placeholder", "https://api.deepseek.com");
      await expect(dialog.getByText(/当前接入使用非思考模式/)).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "添加模型", exact: true }).click();
      await page.getByRole("combobox", { name: "接入连接" }).click();
      await page
        .getByRole("option", { name: "DeepSeek 官方", exact: true })
        .click();
      await page.getByRole("combobox", { name: "DeepSeek 模型预设" }).click();
      await page
        .getByRole("option", {
          name: "DeepSeek Flash · 支持图像理解",
          exact: true,
        })
        .click();
      await expect(
        dialog.getByRole("textbox", { name: "模型标识" }),
      ).toHaveValue("deepseek-flash");
      await expect(
        dialog.getByRole("button", { name: "图像理解", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await page.screenshot({
        path: resolve(
          "..",
          ".local/deepseek-integration",
          `preset-${width}-${theme}.png`,
        ),
        fullPage: true,
      });
    });
  }
}
