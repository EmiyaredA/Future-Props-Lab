import { expect, test } from "@playwright/test";
import { setResponsiveTheme } from "./responsive-capture";

test("native storage handoff, directory selection and capacity fit both themes", async ({
  page,
}, info) => {
  const opened: { directory: string; action: string }[] = [];
  let reads = 0;
  await page.addInitScript(() => {
    window.futurePropsDesktop = {
      pickStorageDirectory: async () =>
        "/Volumes/外接磁盘/很长的素材目录/项目素材与缓存",
      onQuitRequested: () => () => {},
    } as unknown as NonNullable<Window["futurePropsDesktop"]>;
  });
  await page.route("**/v1/desktop/setup", (route) =>
    route.fulfill({ json: { setup_required: false } }),
  );
  await page.route("**/v1/tool-navigation/state", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/v1/tool-navigation/tools/storage-usage/use", (route) =>
    route.fulfill({
      json: {
        tool_id: "storage-usage",
        is_favorite: false,
        favorite_updated_at: null,
        last_used_at: "2026-10-20T08:00:00Z",
        use_count: 1,
      },
    }),
  );
  await page.route("**/v1/tool-navigation/storage-usage**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST") {
      const { directory } = route.request().postDataJSON();
      opened.push({ directory, action: url.pathname.split("/").at(-1)! });
      return route.fulfill({ json: { directory, submitted: true } });
    }
    reads++;
    return route.fulfill({
      json: {
        analyzer: { installed: true, version: "3.8.1" },
        directory: url.searchParams.get("directory") ?? "/Users/example",
        capacity: { total_bytes: 1000e9, used_bytes: 338e9, free_bytes: 662e9 },
        shortcuts: [
          {
            id: "home",
            label: "主目录",
            directory: "/Users/example",
            available: true,
          },
          {
            id: "downloads",
            label: "下载",
            directory: "/Users/example/Downloads",
            available: true,
          },
          {
            id: "applications",
            label: "应用程序",
            directory: "/Applications",
            available: true,
          },
          { id: "startup", label: "启动磁盘", directory: "/", available: true },
        ],
      },
    });
  });
  await page.goto("/tools");
  await page.getByRole("button", { name: "打开空间占用" }).click();
  await expect(page).toHaveURL(/\/tools\/storage-usage$/);
  await expect(page.getByText("已安装 · 3.8.1")).toBeVisible();
  await page.getByRole("button", { name: "选择其他目录" }).click();
  await expect(page.locator(".storage-path")).toContainText(
    "/Volumes/外接磁盘/",
  );
  await page.getByRole("button", { name: /可视化分析/ }).click();
  await expect(
    page.getByText(/已发送 GrandPerspective 打开请求/),
  ).toBeVisible();
  await page.getByRole("button", { name: "在 Finder 中打开" }).click();
  await expect(page.getByText(/已发送 Finder 打开请求/)).toBeVisible();
  expect(opened.map((item) => item.action)).toEqual([
    "analyze",
    "open-directory",
  ]);
  expect(opened[0].directory).toContain("/Volumes/外接磁盘/");
  expect(reads).toBe(2);
  for (const width of [390, 768, 1600]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await setResponsiveTheme(page, theme);
      await page.locator(".studio-main").evaluate((element) => {
        element.scrollTop = 0;
      });
      const clipped = await page
        .locator(".storage-usage-page")
        .evaluate((element) => {
          const main = element.closest(".studio-main")!.getBoundingClientRect();
          return [...element.querySelectorAll("button, a, p, dl, ol")]
            .filter((item) => {
              const bounds = item.getBoundingClientRect();
              return (
                bounds.right > main.right + 1 || bounds.left < main.left - 1
              );
            })
            .map((item) => item.className || item.tagName);
        });
      expect(clipped).toEqual([]);
      await expect(
        page.getByRole("button", { name: /可视化分析/ }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`storage-${width}-${theme}.png`),
        fullPage: true,
      });
    }
  }
});

test("browser route explains desktop requirement without exposing machine state", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/v1/tool-navigation/storage-usage**", async (route) => {
    calls++;
    await route.abort();
  });
  await page.goto("/tools/storage-usage");
  await expect(page.getByText(/此工具仅供 macOS/)).toBeVisible();
  expect(calls).toBe(0);
});
