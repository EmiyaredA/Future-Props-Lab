import { expect, test } from "@playwright/test";

function silentWav() {
  const bytes = 16_000 * 2 * 2;
  const buffer = Buffer.alloc(44 + bytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + bytes, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16_000, 24);
  buffer.writeUInt32LE(32_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(bytes, 40);
  return buffer;
}

test("保存确认保留后续输入，撤销和重做仍提交正确版本", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/apps/audio-annotation");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const upload = await page.request.post("/v1/files", {
    headers,
    multipart: {
      upload: {
        name: "annotation-state.wav",
        mimeType: "audio/wav",
        buffer: silentWav(),
      },
    },
  });
  expect(upload.ok(), await upload.text()).toBeTruthy();
  const created = await page.request.post("/v1/audio-annotation/projects", {
    headers,
    data: { title: "编辑状态验收", asset_id: (await upload.json()).id },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const project = await created.json();
  const documentUrl = `/v1/audio-annotation/projects/${project.id}/document`;
  let releaseFirst: (() => void) | undefined;
  let held = false;
  await page.route(`**${documentUrl}`, async (route) => {
    if (route.request().method() !== "PUT" || held) {
      await route.continue();
      return;
    }
    held = true;
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    await new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    await route.fulfill({ response });
  });
  try {
    await page.goto(`/apps/audio-annotation/projects/${project.id}`);
    const text = page.getByRole("textbox", {
      name: "原文说话内容",
      exact: true,
    });
    await text.fill("第一次编辑");
    await text.press("Tab");
    await expect.poll(() => Boolean(releaseFirst)).toBe(true);
    // The first write is committed, but its acknowledgement is still pending.
    await text.fill("保存期间继续编辑");
    await text.press("Tab");
    releaseFirst?.();
    const savedText = async () =>
      (await (await page.request.get(documentUrl)).json()).segments[0].text;
    await expect.poll(savedText).toBe("保存期间继续编辑");
    await expect(text).toHaveValue("保存期间继续编辑");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect.poll(savedText).toBe("第一次编辑");
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await expect.poll(savedText).toBe("保存期间继续编辑");
    await page.reload();
    await expect(text).toHaveValue("保存期间继续编辑");
    await page.screenshot({
      path: info.outputPath("annotation-edit-state.png"),
    });
  } finally {
    releaseFirst?.();
  }
});
