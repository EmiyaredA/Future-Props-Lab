import { expect, test, type Locator } from "@playwright/test";
import { newDocument, saveNote } from "./thought-helpers";

test("Backspace at the body start moves the caret to the title end", async ({
  page,
}) => {
  await page.goto("/apps/thought-workshop");
  await newDocument(page);
  const title = page.getByRole("textbox", { name: "笔记标题", exact: true });
  const prose = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await title.fill("文档标题");
  await prose.click();
  const emptyBody = await prose.innerHTML();
  await prose.press("Backspace");
  await expect(title).toBeFocused();
  expect(await prose.innerHTML()).toBe(emptyBody);
  await page.keyboard.type("末尾");
  await expect(title).toHaveValue("文档标题末尾");

  // The screenshot's empty first paragraph must keep the following content.
  await prose.click();
  await prose.press("Enter");
  await page.keyboard.type("正文内容");
  await focusBodyStart(prose);
  const bodyWithBlankLine = await prose.innerHTML();
  await prose.press("Backspace");
  await expect(title).toBeFocused();
  expect(await prose.innerHTML()).toBe(bodyWithBlankLine);

  await focusBodyStart(prose);
  await page.keyboard.type("首段");
  await focusBodyStart(prose);
  const populatedBody = await prose.innerHTML();
  await prose.press("Backspace");
  await expect(title).toBeFocused();
  expect(await prose.innerHTML()).toBe(populatedBody);
  expect(
    await title.evaluate((input: HTMLInputElement) => [
      input.selectionStart,
      input.selectionEnd,
    ]),
  ).toEqual([6, 6]);
});

test("Backspace preserves body deletion, selection and list behavior", async ({
  page,
}) => {
  await page.goto("/apps/thought-workshop");
  await newDocument(page);
  const prose = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await prose.click();
  await page.keyboard.type("abc");
  await prose.press("Backspace");
  await expect(prose).toHaveText("ab");
  await expect(prose).toBeFocused();
  await prose.press("Enter");
  await prose.press("Backspace");
  await expect(prose.locator(":scope > p")).toHaveCount(1);
  await expect(prose).toBeFocused();

  await focusBodyStart(prose);
  await prose.press("Shift+ArrowRight");
  await expect
    .poll(() => prose.evaluate(() => window.getSelection()?.toString()))
    .toBe("a");
  await expect
    .poll(() =>
      prose.evaluate((root) => {
        const editor = (
          root as HTMLElement & { editor: import("@tiptap/core").Editor }
        ).editor;
        return editor.state.doc.textBetween(
          editor.state.selection.from,
          editor.state.selection.to,
        );
      }),
    )
    .toBe("a");
  await prose.press("Backspace");
  await expect(prose).toHaveText("b");
  await expect(prose).toBeFocused();
  await prose.dispatchEvent("keydown", {
    key: "Backspace",
    isComposing: true,
  });
  await expect(prose).toBeFocused();
  await expect(prose).toHaveText("b");

  await prose.press("ControlOrMeta+a");
  await prose.press("Backspace");
  await prose.pressSequentially("* ");
  await page.keyboard.type("列表内容");
  await expect(prose.locator("ul li")).toHaveCount(1);
  await focusBodyStart(prose);
  await prose.press("Backspace");
  await expect(prose.locator("ul")).toHaveCount(0);
  await expect(prose).toHaveText("列表内容");
  await expect(prose).toBeFocused();
});

async function focusBodyStart(prose: Locator) {
  await prose.evaluate((root) => {
    (root as HTMLElement).focus();
    const paragraph = root.querySelector("p")!;
    window.getSelection()!.setPosition(paragraph.firstChild ?? paragraph, 0);
  });
}

async function expectMenuFits(menu: Locator) {
  await expect(menu).toBeVisible();
  const issues = await menu.evaluate((root) => {
    const bounds = root.getBoundingClientRect();
    const buttons = [...root.querySelectorAll("button")].filter(
      (button) => button.getBoundingClientRect().height > 0,
    );
    const errors: string[] = [];
    for (const [index, button] of buttons.entries()) {
      const rect = button.getBoundingClientRect();
      if (
        rect.left < bounds.left ||
        rect.right > bounds.right ||
        button.scrollWidth > button.clientWidth + 1
      )
        errors.push(`Overflow: ${button.ariaLabel || button.textContent}`);
      for (const other of buttons.slice(index + 1)) {
        const next = other.getBoundingClientRect();
        if (
          rect.left < next.right &&
          rect.right > next.left &&
          rect.top < next.bottom &&
          rect.bottom > next.top
        )
          errors.push(`Overlap: ${button.textContent} / ${other.textContent}`);
      }
    }
    return errors;
  });
  expect(issues).toEqual([]);
}

test("block menu layout keeps text controls separate and image actions relevant", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto("/apps/thought-workshop");
  await newDocument(page);
  const prose = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await prose.fill("菜单排版检查");
  const menu = page.getByRole("dialog", { name: "块操作", exact: true });
  const handle = page.locator(".thought-drag-handle");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await prose
      .locator("p")
      .first()
      .hover({ position: { x: 5, y: 5 } });
    await handle.getByRole("button", { name: /打开正文菜单/ }).click();
    await expectMenuFits(menu);
    const type = menu.getByRole("combobox", { name: "转换块类型" });
    await type.focus();
    await type.press("ArrowDown");
    await expect(
      page.getByRole("listbox", { name: "转换块类型" }),
    ).toBeVisible();
    await page.getByRole("option", { name: "正文", exact: true }).click();
    await prose
      .locator("p")
      .first()
      .hover({ position: { x: 5, y: 5 } });
    await handle.getByRole("button", { name: /打开正文菜单/ }).click();
    await menu.screenshot({
      path: testInfo.outputPath(`text-menu-${theme}.png`),
    });
    await page.keyboard.press("Escape");
  }
  await prose.click();
  await prose.press("End");
  await prose.press("Enter");
  await page
    .locator('.thought-rich-editor input[accept^="image/"]')
    .setInputFiles({
      name: "menu-fixture.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAI0lEQVR4nGN8Wh3JQApgIkk1w6gG4gATkergYFQDMYDkUAIAeAUB2WkfhqEAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  const image = prose.locator(".thought-image img");
  await expect(image).toBeVisible();
  await image.click();
  await expect(page.getByRole("dialog", { name: "图片设置" })).toHaveCount(0);
  await page.getByRole("button", { name: "图片设置", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "图片设置" })).toBeVisible();
  const imageBox = await image.boundingBox();
  const proseBox = await prose.boundingBox();
  expect(imageBox && proseBox).toBeTruthy();
  await page.mouse.click(
    proseBox!.x + proseBox!.width - 4,
    imageBox!.y + imageBox!.height / 2,
  );
  await expect(page.getByRole("dialog", { name: "图片设置" })).toHaveCount(0);
  await image.click();
  await page.getByLabel("笔记标题", { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "图片设置" })).toHaveCount(0);
  for (const width of [1600, 1280, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      if (width <= 700) {
        await prose.locator("p").first().click();
        await image.click();
        await page
          .getByRole("button", { name: "打开图片菜单", exact: true })
          .click();
      } else {
        await image.hover({ position: { x: 5, y: 5 } });
        await handle.getByRole("button", { name: /打开图片菜单/ }).click();
      }
      await expectMenuFits(menu);
      await expect(menu.getByRole("combobox")).toHaveCount(0);
      await expect(menu.getByRole("button", { name: "清除格式" })).toHaveCount(
        0,
      );
      await expect(
        menu.getByRole("button", { name: "在下方添加" }),
      ).toBeVisible();
      await menu.screenshot({
        path: testInfo.outputPath(`image-menu-${width}-${theme}.png`),
      });
      await page.keyboard.press("Escape");
    }
  }
});

test("block selection, menus, deletion, persistence and mobile fallback", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/apps/thought-workshop");
  await newDocument(page);
  const prose = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await prose.click();
  await page.keyboard.type("第一块");
  await page.keyboard.press("Enter");
  await page.keyboard.type("第二块");
  await page.keyboard.press("Enter");
  await page.keyboard.type("第三块");
  const blocks = prose.locator(":scope > p");
  await expect(blocks).toHaveCount(3);

  const initialProseBox = await prose.boundingBox();
  const initialSecondBox = await blocks.nth(1).boundingBox();
  expect(initialProseBox && initialSecondBox).toBeTruthy();
  await page.mouse.move(initialProseBox!.x + 5, initialSecondBox!.y + 5);
  const handle = page.locator(".thought-drag-handle");
  await expect(handle).toBeVisible();
  await handle.getByRole("button", { name: /打开正文菜单/ }).click();
  const blockMenu = page.getByRole("dialog", { name: "块操作" });
  await expect(blockMenu).toBeVisible();
  const handleBox = await handle.boundingBox();
  const blockMenuBox = await blockMenu.boundingBox();
  expect(handleBox && blockMenuBox).toBeTruthy();
  expect(handleBox!.x + handleBox!.width).toBeLessThanOrEqual(
    initialSecondBox!.x + 1,
  );
  expect(blockMenuBox!.x + blockMenuBox!.width).toBeLessThanOrEqual(
    initialSecondBox!.x + 1,
  );
  expect(blockMenuBox!.y).toBeGreaterThanOrEqual(
    handleBox!.y + handleBox!.height,
  );
  await blockMenu.getByRole("button", { name: "复制", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("第二块");

  const canvasBox = await page.locator(".thought-editor-canvas").boundingBox();
  const proseBox = await prose.boundingBox();
  const firstBox = await blocks.nth(0).boundingBox();
  const secondBox = await blocks.nth(1).boundingBox();
  expect(canvasBox && proseBox && firstBox && secondBox).toBeTruthy();
  await page.mouse.move(proseBox!.x - 12, firstBox!.y + 2);
  await page.mouse.down();
  await page.mouse.move(
    proseBox!.x + proseBox!.width + 4,
    secondBox!.y + secondBox!.height - 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(prose.locator(".ProseMirror-selectednoderange")).toHaveCount(2);
  const rangeMenu = page.getByRole("toolbar", { name: "多块操作" });
  await expect(rangeMenu).toContainText("2 个块");
  await rangeMenu.getByRole("button", { name: "删除", exact: true }).click();
  await expect(prose).not.toContainText("第一块");
  await expect(prose).not.toContainText("第二块");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(prose).toContainText("第一块");
  await expect(prose).toContainText("第二块");

  await prose.press("ControlOrMeta+End");
  await prose.press("Enter");
  await prose.pressSequentially("/");
  await page
    .locator(".thought-insert-menu")
    .getByRole("option", { name: /引用/ })
    .click();
  await expect(prose.locator("blockquote")).toBeVisible();
  await saveNote(page);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.reload();
  await expect(prose).toContainText("第一块");
  await expect(prose.locator("blockquote")).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath("block-editor-light.png"),
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({
    path: testInfo.outputPath("block-editor-dark.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await prose.locator("p").first().click();
  const mobileHandle = page.locator(".thought-mobile-block-trigger");
  await expect(mobileHandle).toBeVisible();
  await mobileHandle.click();
  await expect(
    blockMenu.getByRole("button", { name: "上移", exact: true }),
  ).toBeVisible();
  await expect(
    blockMenu.getByRole("button", { name: "下移", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("block-editor-mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
