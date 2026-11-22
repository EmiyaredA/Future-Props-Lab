import { expect, test } from "@playwright/test";
import { setResponsiveTheme } from "./responsive-capture";

const source = `subject_definitions:
<Subject 1>: The woman in <Picture 1>, using the motion of <Video 1>.
summary: [video editing + reference generation] Keep the source street.
retention_analysis:
<Video 1> ([Shot 1], [Shot 2]): fully_preserved.
detailed_description:
Hand-drawn 2D animation.
${"Rain falls across the street as the woman walks past the storefront.\n".repeat(24)}
[Shot 1] <Subject 1> walks through the street.
[Shot 2] At 00:03.000, she says <d>[Chinese] 你好！</d>
overall_soundscape: Footsteps and traffic.
non_diegetic_music: N/A`;

for (const width of [1440, 390]) {
  test(`H3 rendering, source editing and compact single-row controls (${width})`, async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    page.setDefaultTimeout(10_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.route("**/v1/visual-workshop/generation-options", (route) =>
      route.fulfill({
        json: {
          models: [
            {
              id: "render-test",
              provider_id: "test-provider",
              provider_name: "隔离验收",
              kind: "video",
              slug: "minimax_h3_lightx2v_no_pic",
              label: "H3渲染验收",
              description: "",
              sizes: [],
              supports_seed: false,
              max_reference_images: 0,
              max_prompt_length: 6000,
            },
          ],
        },
      }),
    );
    await page.goto("/apps/visual-workshop");
    const csrf = (await page.context().cookies()).find(
      ({ name }) => name === "fpl_csrf",
    )!.value;
    const headers = {
      "X-CSRF-Token": csrf,
      Origin: new URL(page.url()).origin,
    };
    const created = await page.request.post("/v1/visual-workshop/projects", {
      headers,
      data: { title: "H3 提示词渲染验收", kind: "canvas" },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const id = (await created.json()).id;
    const base = `/v1/visual-workshop/projects/${id}`;
    const saved = await page.request.put(`${base}/canvas`, {
      headers,
      data: {
        expected_revision: 0,
        edges: [],
        nodes: [
          {
            id: "target",
            title: "H3提示词方案",
            kind: "video",
            position: { x: 240, y: 120 },
            generation_draft: {
              model_id: "render-test",
              prompt: source,
              prompt_versions: [
                { id: "v1", name: "v1", prompt: source },
                { id: "v2", name: "v2", prompt: "普通文本" },
              ],
              active_prompt_version_id: "v1",
            },
          },
        ],
      },
    });
    expect(saved.ok(), await saved.text()).toBeTruthy();
    await page.goto(`/apps/visual-workshop/projects/${id}/canvas`);
    const openBoard = async () => {
      if (width < 1024) {
        await page.getByRole("button", { name: "项目更多操作" }).click();
        const board = page.getByRole("menuitem", { name: "切换到看板" });
        if (await board.isEnabled()) await board.click();
        else await page.keyboard.press("Escape");
      } else {
        await page.getByRole("button", { name: "看板", exact: true }).click();
      }
    };
    await openBoard();
    const preview = page.getByRole("region", { name: "视频提示词渲染预览" });
    await expect(preview).toBeVisible();
    await expect(
      preview.getByRole("heading", { name: /主体定义/ }),
    ).toBeVisible();
    const controls = page.getByRole("group", { name: "提示词显示" });
    const promptScroller = page.locator(
      ".video-composer-prompt > .generation-prompt-field > :is(.prompt-render-preview, .generation-prompt-editor-shell)",
    );
    async function checkPinnedToolbar(mode: string) {
      await promptScroller.evaluate((element) => {
        element.scrollTop = 0;
      });
      const before = (await controls.boundingBox())!;
      for (const position of [220, Number.MAX_SAFE_INTEGER]) {
        await promptScroller.evaluate((element, top) => {
          element.scrollTop = top;
        }, position);
        await expect
          .poll(() => promptScroller.evaluate((element) => element.scrollTop))
          .toBeGreaterThan(100);
        await expect
          .poll(async () =>
            Math.abs((await controls.boundingBox())!.y - before.y),
          )
          .toBeLessThanOrEqual(1);
        const contentBounds = (await promptScroller.boundingBox())!;
        expect(contentBounds.y).toBeGreaterThanOrEqual(
          before.y + before.height,
        );
        await controls
          .getByRole("button", { name: "复制原文" })
          .click({ trial: true });
      }
      await page.screenshot({ path: info.outputPath(`h3-pinned-${mode}.png`) });
      await promptScroller.evaluate((element) => {
        element.scrollTop = 0;
      });
    }
    for (const theme of ["light", "dark"]) {
      await setResponsiveTheme(page, theme);
      await controls.scrollIntoViewIfNeeded();
      await expect(controls).toHaveCSS("height", "32px");
      const bounds = await controls.locator("button").evaluateAll((buttons) =>
        buttons.map((button) => {
          const rect = button.getBoundingClientRect();
          return {
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            height: rect.height,
          };
        }),
      );
      expect(bounds).toHaveLength(9);
      for (let index = 1; index < bounds.length; index += 1)
        expect(bounds[index].left).toBeGreaterThanOrEqual(
          bounds[index - 1].right,
        );
      expect(
        Math.max(...bounds.map((rect) => rect.top)) -
          Math.min(...bounds.map((rect) => rect.top)),
      ).toBeLessThan(4);
      for (const rect of bounds) {
        expect(rect.height).toBeLessThanOrEqual(32);
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(width);
      }
      await page.screenshot({ path: info.outputPath(`h3-${theme}.png`) });
      await checkPinnedToolbar(theme);
    }
    const initial = await (await page.request.get(`${base}/canvas`)).json();
    await page.getByRole("combobox", { name: "提示词渲染模板" }).click();
    await expect(
      page.getByRole("option", { name: "普通文本", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("option", { name: "MiniMax H3", exact: true }).click();
    const displayToggle = page.getByRole("switch", { name: "渲染提示词" });
    await displayToggle.click();
    await expect(displayToggle).toHaveAttribute("aria-checked", "false");
    await expect(preview).toHaveCount(0);
    await checkPinnedToolbar("plain");
    await expect(
      page.getByRole("textbox", { name: "视频提示词" }),
    ).toContainText("subject_definitions:");
    await expect(
      page.getByRole("combobox", { name: "提示词渲染模板" }),
    ).toContainText("MiniMax H3");
    await displayToggle.press("Space");
    await expect(displayToggle).toHaveAttribute("aria-checked", "true");
    await expect(displayToggle).toBeFocused();
    await expect(preview).toBeVisible();
    const after = await (await page.request.get(`${base}/canvas`)).json();
    expect(after.nodes[0].generation_draft.prompt).toBe(source);
    expect(after.revision).toBe(initial.revision);
    const editor = page.getByRole("textbox", { name: "视频提示词" });
    await editor.focus();
    await expect(editor).toBeFocused();
    const edited = source.replace(
      "Footsteps and traffic.",
      "Rain and traffic.",
    );
    await editor.press("ControlOrMeta+A");
    // Paste through the editor's real multiline input path; contentEditable.fill
    // creates browser block nodes, unlike the editor's text/mention document.
    await editor.evaluate((element, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData,
        }),
      );
    }, edited);
    await expect(editor).toContainText("Rain and traffic.");
    await expect(preview).toContainText("Rain and traffic.");
    await page.getByRole("button", { name: "复制原文", exact: true }).focus();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`${base}/canvas`)).json()).nodes[0]
            .generation_draft.prompt,
      )
      .toBe(edited);
    const versions = page.getByRole("combobox", { name: "提示词版本" });
    await versions.click();
    await page.getByRole("option", { name: "v2", exact: true }).click();
    await expect(editor).toHaveText("普通文本");
    await versions.click();
    await page.getByRole("option", { name: "v1", exact: true }).click();
    await expect(preview).toContainText("Rain and traffic.");
    if (width === 1440) {
      await page.getByRole("button", { name: "画布", exact: true }).click();
      await page.locator('[data-node-id="target"] .canvas-node-media').click();
      await page.getByRole("button", { name: "替换素材" }).click();
      await expect(preview).toContainText("Rain and traffic.");
      await controls.scrollIntoViewIfNeeded();
      await checkPinnedToolbar("canvas");
      await page.screenshot({ path: info.outputPath("h3-canvas.png") });
    }
    await page.reload();
    await openBoard();
    await expect(
      page.getByRole("combobox", { name: "提示词渲染模板" }),
    ).toContainText("自动 · H3");
    await expect(preview).toContainText("Rain and traffic.");
  });
}
