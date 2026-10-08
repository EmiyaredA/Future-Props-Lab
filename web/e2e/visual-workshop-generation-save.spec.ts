import { expect, test } from "@playwright/test";

for (const view of ["board", "canvas"] as const) {
  test(`生成先完成当前草稿保存 (${view})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/apps/visual-workshop");
    const csrf = (await page.context().cookies()).find(
      (cookie) => cookie.name === "fpl_csrf",
    )!.value;
    const headers = {
      "X-CSRF-Token": csrf,
      Origin: new URL(page.url()).origin,
    };
    const created = await page.request.post("/v1/visual-workshop/projects", {
      headers,
      data: { title: "生成保存顺序验收", kind: "canvas" },
    });
    expect(created.ok()).toBeTruthy();
    const id = (await created.json()).id as string;
    const base = `/v1/visual-workshop/projects/${id}`;
    const saved = await page.request.put(`${base}/canvas`, {
      headers,
      data: {
        expected_revision: 0,
        nodes: [
          {
            id: "target",
            kind: "video",
            title: "视频输出",
            position: { x: 240, y: 120 },
            generation_draft: {
              model_id: "fixture-video",
              prompt: "旧提示词",
              mode: "text",
              duration: 5,
              resolution: "720p",
              ratio: "16:9",
              watermark: false,
              generate_audio: false,
              first_frame_asset_id: null,
              last_frame_asset_id: null,
              reference_asset_ids: [],
              audio_asset_ids: [],
              video_asset_ids: [],
            },
          },
        ],
        edges: [],
      },
    });
    expect(saved.ok(), await saved.text()).toBeTruthy();
    await page.route(
      "**/v1/visual-workshop/generation-options",
      async (route) => {
        await route.fulfill({
          json: {
            models: [
              {
                id: "fixture-video",
                provider_id: "fixture-provider",
                provider_name: "本地测试",
                kind: "video",
                slug: "fixture-video",
                label: "测试视频模型",
                description: "不调用供应商",
              },
            ],
          },
        });
      },
    );
    let pendingSaves = 0;
    await page.route(`**${base}/canvas`, async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }
      pendingSaves += 1;
      // Delay the real isolated API write so submitting before it settles is observable.
      await new Promise((resolve) => setTimeout(resolve, 80));
      const response = await route.fetch();
      pendingSaves -= 1;
      await route.fulfill({ response });
    });
    let submissions = 0;
    let submittedRevision = -1;
    const task = {
      id: "fixture-task",
      project_id: id,
      canvas_node_id: "target",
      provider_id: "fixture-provider",
      model_id: "fixture-video",
      provider_kind: "fixture",
      kind: "video",
      provider_name: "本地测试",
      model_slug: "fixture-video",
      request_payload: {},
      provider_task_id: null,
      status: "queued",
      progress: 0,
      error_message: null,
      result_asset_id: null,
      can_retry_materialization: false,
      revision: 0,
      created_at: "2026-10-08T00:00:00Z",
      updated_at: "2026-10-08T00:00:00Z",
      completed_at: null,
    };
    await page.route(
      "**/v1/visual-workshop/generation-tasks/fixture-task",
      async (route) => {
        await route.fulfill({ json: task });
      },
    );
    await page.route(`**${base}/generation-tasks`, async (route) => {
      submissions += 1;
      const body = route.request().postDataJSON();
      const current = await (await page.request.get(`${base}/canvas`)).json();
      submittedRevision = body.expected_canvas_revision;
      expect(pendingSaves).toBe(0);
      expect(submittedRevision).toBe(current.revision);
      expect(current.nodes[0].generation_draft.prompt).toBe(
        "新提示词：保留舞蹈节奏",
      );
      expect(body.prompt).toBe(current.nodes[0].generation_draft.prompt);
      // Only model submission is synthetic; canvas reads and writes use the real isolated API.
      await route.fulfill({ json: task });
    });
    await page.goto(`/apps/visual-workshop/projects/${id}/canvas`);
    if (view === "board") {
      await page.getByRole("button", { name: "看板", exact: true }).click();
    } else {
      await page.locator('[data-node-id="target"] .canvas-node-media').click();
      await page.getByRole("button", { name: "替换素材" }).click();
      await page.getByRole("tab", { name: "AI 生成" }).click();
    }
    const prompt = page.getByRole("textbox", { name: "视频提示词" });
    await prompt.fill("新提示词：保留舞蹈节奏");
    await page.getByRole("button", { name: "生成视频", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "任务已提交" }),
    ).toBeVisible();
    expect(submissions).toBe(1);
    expect(submittedRevision).toBeGreaterThan(1);
    await expect(
      page.getByText("画布已变化，请刷新后重试", { exact: true }),
    ).toHaveCount(0);
  });
}
