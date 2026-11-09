import { expect, test } from "@playwright/test";
import { join } from "node:path";
import type { RunDetail } from "../src/features/amadeus/protocol";

test("approval refreshes the visual project in place; pasted attachments and draft survive reload", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1480, height: 920 });
  await page.goto("/apps/visual-workshop");
  const csrf = (await context.cookies()).find(
    ({ name }) => name === "fpl_csrf",
  )!;
  const headers = {
    Origin: new URL(page.url()).origin,
    "X-CSRF-Token": csrf.value,
  };
  const project = await page.request.post("/v1/visual-workshop/projects", {
    headers,
    data: { title: "Amadeus 审批刷新验收", kind: "canvas" },
  });
  expect(project.ok(), await project.text()).toBeTruthy();
  const { id: projectId } = await project.json();
  const projectPath = `/apps/visual-workshop/projects/${projectId}/canvas`;
  const canvasPath = `/v1/visual-workshop/projects/${projectId}/canvas`;
  const created = await page.request.post("/v1/amadeus/conversations", {
    headers,
  });
  expect(created.ok()).toBeTruthy();
  const conversation = await created.json();
  const conversationPath = `/v1/amadeus/conversations/${conversation.id}`;
  const at = "2026-11-09T00:00:00Z";
  let actionStatus = "pending";
  let decisions = 0;
  let executes = 0;
  let continuation: { source_run_id: string } | undefined;
  let continuationPolls = 0;
  const lead = "我先检查当前画布和可用操作。";
  const proposal = "画布中没有节点。我已准备新增一个视频生成节点。";
  const final = "新节点已添加到画布，可以在生成设置中编辑提示词。";
  const event = (
    sequence: number,
    kind: string,
    payload: Record<string, unknown>,
  ) => ({
    sequence,
    kind,
    payload,
    created_at: at,
  });
  const source: RunDetail = {
    run: {
      id: "source-run",
      conversation_id: conversation.id,
      model_id: "fixture",
      agent_id: "codex",
      status: "waiting_approval",
      partial_text: lead + proposal,
      created_at: at,
      finished_at: at,
    },
    events: [
      event(1, "reasoning_summary", {
        text: "先确认项目版本，再拟定写入操作。",
      }),
      event(2, "assistant_delta", { text: lead }),
      ...["operations", "fpl_read", "call", "fpl_operation_read"].flatMap(
        (tool_name, index) => [
          event(3 + index * 2, "tool_call", {
            tool_call_id: `read-${index}`,
            tool_name,
            arguments: { operation: "visual.get_canvas" },
          }),
          event(4 + index * 2, "tool_result", {
            tool_call_id: `read-${index}`,
            result: {},
          }),
        ],
      ),
      event(11, "assistant_delta", { text: proposal }),
      event(12, "tool_call", {
        tool_call_id: "write",
        tool_name: "call",
        arguments: { operation: "visual.apply_canvas_operations" },
      }),
      event(13, "assistant_message", { text: lead + proposal }),
    ],
  };
  function resumed(status: string, text: string): RunDetail {
    const later = "2026-11-09T00:00:01Z";
    return {
      run: {
        ...source.run,
        id: "resumed-run",
        source_run_id: source.run.id,
        status,
        partial_text: text,
        created_at: later,
        finished_at: status === "completed" ? later : null,
      },
      events: text
        ? [{ ...event(1, "assistant_delta", { text }), created_at: later }]
        : [],
    };
  }
  await page.route("**" + conversationPath + "/runs/resumed-run", (route) => {
    continuationPolls++;
    return route.fulfill({
      json:
        continuationPolls === 1
          ? resumed("running", "新节点已添加到画布")
          : resumed("completed", final),
    });
  });
  await page.route("**/v1/code-agents", (route) =>
    route.fulfill({
      json: {
        items: [{ id: "codex", name: "Codex", available: true, models: [] }],
      },
    }),
  );
  await page.route("**" + conversationPath, async (route) => {
    const response = await route.fetch();
    const detail = await response.json();
    await route.fulfill({
      response,
      json: {
        ...detail,
        messages: [
          {
            id: "saved-user",
            role: "user",
            content: "在画布添加一个视频生成节点",
            references: [],
            created_at: at,
          },
          {
            id: "saved-source",
            role: "assistant",
            run_id: source.run.id,
            content: lead + proposal,
            references: [],
            created_at: at,
          },
          ...(continuationPolls > 1
            ? [
                {
                  id: "saved-final",
                  role: "assistant",
                  run_id: "resumed-run",
                  content: final,
                  references: [],
                  created_at: "2026-11-09T00:00:01Z",
                },
              ]
            : []),
        ],
        actions: [
          {
            id: "approval",
            run_id: "source-run",
            status: actionStatus,
            tool_name: "fpl_operation:visual.apply_canvas_operations",
            arguments: { path_params: { project_id: projectId } },
            arguments_sha256: "fixture",
            result:
              actionStatus === "completed" ? { node_id: "new-node" } : null,
            created_at: at,
            updated_at: at,
          },
        ],
      },
    });
  });
  await page.route(
    "**" + conversationPath + "/actions/approval/decision",
    (route) => {
      decisions++;
      actionStatus = "approved";
      return route.fulfill({ json: {} });
    },
  );
  await page.route(
    "**" + conversationPath + "/actions/approval/execute",
    async (route) => {
      executes++;
      const result = await page.request.put(canvasPath, {
        headers,
        data: {
          expected_revision: 0,
          nodes: [
            {
              id: "new-node",
              title: "审批添加的节点",
              kind: "video",
              position: { x: 250, y: 170 },
            },
          ],
          edges: [],
        },
      });
      expect(result.ok(), await result.text()).toBeTruthy();
      actionStatus = "completed";
      await route.abort("connectionreset");
    },
  );
  await page.route("**" + conversationPath + "/runs", (route) => {
    if (route.request().method() === "POST") {
      continuation = route.request().postDataJSON();
      return route.fulfill({ json: resumed("running", "") });
    }
    return route.fulfill({
      json: [
        source,
        ...(continuationPolls > 1 ? [resumed("completed", final)] : []),
      ],
    });
  });

  await page.goto(projectPath);
  await page.getByRole("button", { name: "打开 Amadeus", exact: true }).click();
  const pane = page.getByRole("complementary", { name: "Amadeus 助手" });
  const composer = pane.getByRole("textbox", { name: "向 Amadeus 提问" });
  const divider = page.getByRole("separator", {
    name: "调整 Amadeus 分屏宽度",
  });
  await divider.focus();
  await divider.press("ArrowLeft");
  const width = await pane.evaluate((element) => element.clientWidth);
  await expect(pane.getByRole("button", { name: "批准并执行" })).toBeVisible();
  const tools = pane.getByRole("button", { name: "工具调用 · 4 · 已完成" });
  await expect(tools).toHaveAttribute("aria-expanded", "false");
  await expect(
    pane.locator(".amadeus-tool-activity").getByText("+1 更多…"),
  ).toBeVisible();
  await tools.click();
  const reasoning = pane.locator(".amadeus-reasoning-summary");
  await reasoning.locator("summary").click();
  await composer.fill("待发送草稿");
  await composer.evaluate((element) => {
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], "image.png", {
        type: "image/png",
      }),
    );
    data.items.add(
      new File(["fixture"], "fixture.txt", { type: "text/plain" }),
    );
    data.setData("text/plain", "不应覆盖现有草稿");
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(pane.locator(".amadeus-pending-refs .amadeus-ref")).toHaveCount(
    2,
  );
  await expect(composer).toHaveValue("待发送草稿");
  await page.evaluate(
    () => (document.body.dataset.testContinuity = "same-document"),
  );
  await pane.getByRole("button", { name: "批准并执行" }).click();
  await expect(page.locator('[data-node-id="new-node"]')).toBeVisible();
  await expect(pane.getByText("已执行 · 收到回执")).toBeVisible();
  await expect.poll(() => continuation?.source_run_id).toBe("source-run");
  await expect(
    pane.getByText("新节点已添加到画布", { exact: true }),
  ).toBeVisible();
  await expect(pane.getByText(final, { exact: true })).toBeVisible();
  expect([decisions, executes]).toEqual([1, 1]);
  await expect(page.locator("body")).toHaveAttribute(
    "data-test-continuity",
    "same-document",
  );
  await expect(composer).toHaveValue("待发送草稿");
  const transcript = pane.locator(".amadeus-messages");
  const completedText = await transcript.innerText();
  expect(completedText.indexOf(lead)).toBeLessThan(
    completedText.indexOf("工具调用"),
  );
  expect(completedText.indexOf("工具调用")).toBeLessThan(
    completedText.indexOf(proposal),
  );
  expect(completedText.indexOf(proposal)).toBeLessThan(
    completedText.indexOf("收到回执"),
  );
  expect(completedText.indexOf("收到回执")).toBeLessThan(
    completedText.indexOf(final),
  );
  const proofDir = process.env.FPL_AMADEUS_REPLAY_PROOF;
  if (proofDir)
    await page.screenshot({ path: join(proofDir, "live-completed.png") });

  await page.reload();
  await expect(pane).toBeVisible();
  await expect(composer).toHaveValue("待发送草稿");
  await expect(pane.locator(".amadeus-pending-refs .amadeus-ref")).toHaveCount(
    2,
  );
  await expect(pane.getByText("已执行 · 收到回执")).toBeVisible();
  await expect(transcript).toHaveText(
    completedText.replace(/\s+/g, " ").trim(),
    { useInnerText: true },
  );
  await expect(tools).toHaveAttribute("aria-expanded", "true");
  await expect(reasoning).toHaveAttribute("open", "");
  const receipt = pane.getByRole("region", { name: "写入操作" });
  await expect(receipt.getByText("查看完整参数与回执")).not.toBeVisible();
  if (proofDir) await page.screenshot({ path: join(proofDir, "reopened.png") });
  await receipt.locator("summary").first().click();
  await receipt.getByText("查看完整参数与回执").click();
  await expect(receipt.getByText(/"node_id": "new-node"/)).toBeVisible();
  expect(await pane.evaluate((element) => element.clientWidth)).toBe(width);
  expect([decisions, executes]).toEqual([1, 1]);
  await pane.getByRole("button", { name: "切换为右侧弹窗" }).click();
  await expect(divider).toHaveCount(0);
  await expect(pane.getByText(final, { exact: true })).toHaveCount(1);
  await expect(composer).toHaveValue("待发送草稿");
  await pane.getByRole("button", { name: "切换为分屏" }).click();
  await expect(divider).toBeVisible();
  const other = await context.newPage();
  await other.goto(projectPath);
  await expect(
    other.getByRole("complementary", { name: "Amadeus 助手" }),
  ).toHaveCount(0);
  await page.goto(`/amadeus?conversation=${conversation.id}`);
  await expect(pane).toHaveCount(0);
  await expect(
    page.locator(".amadeus-messages").getByText(final, { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.locator(".amadeus-messages").getByText(lead, { exact: true }),
  ).toHaveCount(1);
});

for (const scenario of ["video", "fallback", "dirty"] as const) {
  test(`approval leaves the assistant mounted: ${scenario}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1480, height: 920 });
    const workshop = scenario === "video" ? "video-editor" : "visual-workshop";
    await page.goto(`/apps/${workshop}`);
    const csrf = (await page.context().cookies()).find(
      ({ name }) => name === "fpl_csrf",
    )!;
    const headers = {
      Origin: new URL(page.url()).origin,
      "X-CSRF-Token": csrf.value,
    };
    const projectName = `隔离项目 ${scenario}`;
    const projectResponse = await page.request.post(
      `/v1/${workshop}/projects`,
      {
        headers,
        data: {
          title: projectName,
          ...(scenario === "video" ? {} : { kind: "canvas" }),
        },
      },
    );
    expect(projectResponse.ok(), await projectResponse.text()).toBeTruthy();
    const { id: projectId } = await projectResponse.json();
    const projectPath = `/apps/${workshop}/projects/${projectId}/${scenario === "video" ? "editor" : "canvas"}`;
    const base = `/v1/${workshop}/projects/${projectId}`;
    const created = await page.request.post("/v1/amadeus/conversations", {
      headers,
    });
    expect(created.ok()).toBeTruthy();
    const conversation = await created.json();
    const conversationPath = `/v1/amadeus/conversations/${conversation.id}`;
    const detailResponse = await page.request.get(conversationPath);
    expect(detailResponse.ok()).toBeTruthy();
    const detail = await detailResponse.json();
    await page.route("**/v1/code-agents", (route) =>
      route.fulfill({ json: { items: [] } }),
    );
    const at = "2026-11-09T00:00:00Z";
    let status = "pending";
    let finish: () => void;
    let started: () => void;
    const execution = new Promise<void>((resolve) => {
      started = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let refreshReads = 0;
    await page.route(`**${base}/timeline`, (route) => {
      if (status === "completed") refreshReads++;
      return route.continue();
    });
    await page.route("**" + conversationPath, (route) => {
      return route.fulfill({
        json: {
          ...detail,
          actions: [
            {
              id: "approval",
              run_id: "source-run",
              status,
              tool_name:
                scenario === "video"
                  ? "fpl_operation:video.apply_timeline_operations"
                  : "fpl_operation:visual.apply_canvas_operations",
              arguments: { path_params: { project_id: projectId } },
              arguments_sha256: "fixture",
              created_at: at,
              updated_at: at,
            },
          ],
        },
      });
    });
    await page.route(
      "**" + conversationPath + "/actions/approval/decision",
      (route) => {
        status = "approved";
        return route.fulfill({ json: {} });
      },
    );
    await page.route(
      "**" + conversationPath + "/actions/approval/execute",
      async (route) => {
        started();
        if (scenario === "dirty") await resume;
        if (scenario === "video") {
          const before = await (
            await page.request.get(`${base}/timeline`)
          ).json();
          const update = await page.request.post(
            `${base}/timeline/operations`,
            {
              headers,
              data: {
                expectedRevision: before.revision,
                requestId: crypto.randomUUID(),
                operations: [
                  {
                    type: "updateTrack",
                    trackId: before.document.tracks[0].id,
                    patch: { name: "审批更新的轨道" },
                  },
                ],
              },
            },
          );
          expect(update.ok(), await update.text()).toBeTruthy();
        }
        status = "completed";
        await route.fulfill({ json: { status } });
      },
    );
    await page.goto(
      scenario === "fallback" ? "/apps/visual-workshop/tasks" : projectPath,
    );
    await page
      .getByRole("button", { name: "打开 Amadeus", exact: true })
      .click();
    const pane = page.getByRole("complementary", { name: "Amadeus 助手" });
    await page.evaluate(() => {
      document.body.dataset.testContinuity = "same-document";
    });
    await pane.getByRole("button", { name: "批准并执行" }).click();
    await execution;
    if (scenario === "dirty") {
      await page
        .getByRole("button", { name: projectName, exact: true })
        .click();
      const title = page.getByRole("textbox", { name: "项目名称" });
      await title.fill("尚未保存的项目名称");
      finish!();
      await expect(title).toHaveValue("尚未保存的项目名称");
      await expect(
        page.getByText("Amadeus 已更新项目；当前页面有未保存的编辑。"),
      ).toBeVisible();
    }
    await expect(pane.getByText("已执行 · 收到回执")).toBeVisible();
    await expect(page.locator("body")).toHaveAttribute(
      "data-test-continuity",
      "same-document",
    );
    if (scenario === "video") {
      await expect.poll(() => refreshReads).toBeGreaterThan(0);
      await expect(
        page.getByText("审批更新的轨道", { exact: true }),
      ).toBeVisible();
    } else {
      const fallback = page.getByRole("link", {
        name: "在新标签页查看最新内容",
      });
      await expect(fallback).toBeVisible();
      await expect(fallback).toHaveAttribute("target", "_blank");
    }
  });
}
