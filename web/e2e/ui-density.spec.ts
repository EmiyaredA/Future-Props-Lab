import { expect, test } from "@playwright/test";
import { setResponsiveTheme } from "./responsive-capture";

test("management pages remain readable at compact sizes", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  for (const [path, heading] of [
    ["/home", "今天想从哪里开始？"],
    ["/integrations/tool-apis", "集成中心"],
    ["/model-call-logs", "模型调用日志"],
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    for (const width of [390, 768, 1024, 1280, 1600, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"]) {
        await setResponsiveTheme(page, theme);
        const overflow = await page
          .locator(".studio-main")
          .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
        expect(overflow, `${path} ${width} ${theme}`).toBe(false);
        if (path === "/home") {
          expect(
            await page
              .locator(".home-feature-copy")
              .evaluateAll((nodes) =>
                nodes.every((el) => el.scrollWidth <= el.clientWidth + 1),
              ),
          ).toBe(true);
          if (width >= 1280) {
            const hero = await page.locator(".home-header").boundingBox();
            const card = await page
              .locator(".home-folder-stage")
              .first()
              .boundingBox();
            expect(hero!.height).toBeLessThanOrEqual(230);
            expect(card!.height).toBeLessThanOrEqual(240);
          }
        }
        await page.screenshot({
          path: info.outputPath(
            `${path.replaceAll("/", "_")}-${width}-${theme}.png`,
          ),
          animations: "disabled",
        });
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  for (const path of [
    "/apps",
    "/creative-workshop",
    "/files",
    "/tools",
    "/model-service",
    "/model-test-tools",
    "/apps/video-editor",
    "/apps/presentation-workshop",
    "/apps/motion-compositor",
  ]) {
    await page.goto(path);
    await expect(
      page.locator(".studio-main, .workshop-main").getByRole("heading").first(),
    ).toBeVisible();
    expect(
      await page
        .locator(".studio-main, .workshop-main")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      path,
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`${path.replaceAll("/", "_")}-1280.png`),
      animations: "disabled",
    });
  }
});

test.describe("touch density", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("main controls keep a 44px touch target", async ({ page }) => {
    for (const path of [
      "/home",
      "/apps",
      "/tools",
      "/integrations/tool-apis",
      "/model-call-logs",
    ]) {
      await page.goto(path);
      await expect(page.locator(".studio-main h1")).toBeVisible();
      const short = await page
        .locator(
          ".studio-main button, .studio-sidebar button, .studio-global-header button",
        )
        .evaluateAll((nodes) =>
          nodes
            .filter(
              (el) =>
                el.getClientRects().length &&
                el.getBoundingClientRect().height < 43.5,
            )
            .map((el) => el.getAttribute("aria-label") || el.textContent),
        );
      expect(short, path).toEqual([]);
    }
  });
});

test("editor and document typography retain their original density", async ({
  page,
}, info) => {
  await page.goto("/apps");
  await expect(page.locator(".applications-page")).toBeVisible();
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const response = await page.request.post("/v1/video-editor/projects", {
    headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
    data: { title: "界面密度隔离验收" },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const project = await response.json();
  await page.goto("/apps/video-editor");
  const card = page
    .locator(".workshop-project-card")
    .filter({ hasText: "界面密度隔离验收" });
  await expect(card).toBeVisible();
  expect(
    (await card.locator(".workshop-project-cover").boundingBox())!.height,
  ).toBe(128);
  expect((await card.boundingBox())!.height).toBeLessThan(300);
  await page.screenshot({
    path: info.outputPath("project-list-density.png"),
    animations: "disabled",
  });
  await page.goto(`/apps/video-editor/projects/${project.id}/editor`);
  const editor = page.locator(".ve-editor");
  await expect(editor).toBeVisible();
  expect(
    await editor.evaluate((el) =>
      getComputedStyle(el).getPropertyValue("--ui-control-height").trim(),
    ),
  ).toBe("32px");
  await page.screenshot({
    path: info.outputPath("editor-density.png"),
    animations: "disabled",
  });
  await page.goto("/docs.html?page=overview");
  await expect(page.locator(".guide-card-group a").first()).toBeVisible();
  expect(
    await page
      .locator("body")
      .evaluate((el) =>
        getComputedStyle(el).getPropertyValue("--ui-control-height").trim(),
      ),
  ).toBe("32px");
  await page.screenshot({
    path: info.outputPath("docs-density.png"),
    animations: "disabled",
  });
});
