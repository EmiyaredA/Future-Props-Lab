import { expect, test } from "@playwright/test";
import type {
  Detail,
  RunDetail,
  RunInstruction,
} from "../src/features/amadeus/protocol";

test("composer keeps actions visible and inserts an attachment during output", async ({
  page,
}) => {
  const at = "2026-11-20T00:00:00Z";
  const detail: Detail = {
    conversation: {
      id: "insertion-chat",
      title: "插入验收",
      revision: 0,
      model_id: null,
      agent_id: "codex",
      executor_kind: "code-agent",
      created_at: at,
      updated_at: at,
    },
    messages: [
      {
        id: "initial",
        role: "user",
        content: "开始工作",
        references: [],
        created_at: at,
      },
    ],
    actions: [],
    questions: [],
  };
  const run: RunDetail = {
    run: {
      id: "insertion-run",
      conversation_id: detail.conversation.id,
      model_id: "code-agent",
      agent_id: "codex",
      agent_model: "long-model",
      status: "running",
      partial_text: "正在处理原要求。",
      created_at: at,
    },
    events: [
      {
        sequence: 1,
        kind: "assistant_delta",
        payload: { text: "正在处理原要求。" },
        created_at: at,
      },
    ],
    instructions: [],
    can_receive: true,
  };
  let sends = 0;
  let posted!: () => void;
  let release!: () => void;
  const instructionPosted = new Promise<void>((resolve) => {
    posted = resolve;
  });
  const responseReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/v1/code-agents**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "codex",
            name: "Codex",
            available: true,
            message: "测试连接",
            models_status: "available",
            models: [
              {
                id: "long-model",
                label: "这是一个很长的模型名称，用来检查窄屏中的按钮布局",
                reasoning_efforts: ["low", "high"],
                fast_available: true,
              },
            ],
          },
        ],
      },
    }),
  );
  await page.route("**/v1/amadeus/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/imports"))
      return route.fulfill({ json: { name: "evidence.txt", bytes: 12 } });
    if (path.endsWith("/instructions")) {
      sends++;
      const body = route.request().postDataJSON();
      const item: RunInstruction = {
        ...body,
        message_id: "inserted",
        status: "accepted",
        sequence: 2,
        created_at: at,
      };
      detail.messages.push({
        id: item.message_id,
        role: "user",
        content: item.text,
        references: item.references,
        run_id: run.run.id,
        created_at: at,
      });
      detail.conversation.revision++;
      run.instructions = [item];
      run.events.push(
        {
          sequence: 2,
          kind: "user_instruction",
          payload: { message_id: item.message_id },
          created_at: at,
        },
        {
          sequence: 3,
          kind: "assistant_delta",
          payload: { text: "已经结合新附件调整。" },
          created_at: at,
        },
      );
      run.run.partial_text += "已经结合新附件调整。";
      posted();
      await responseReady;
      return route.fulfill({ json: item });
    }
    if (path.endsWith("/cancel")) {
      run.run.status = "cancelled";
      run.can_receive = false;
      return route.fulfill({ json: run });
    }
    if (path.endsWith("/runs/active") || path.endsWith("/runs/insertion-run"))
      return route.fulfill({ json: run });
    if (path.endsWith("/runs")) return route.fulfill({ json: [run] });
    if (path.endsWith("/conversations/insertion-chat"))
      return route.fulfill({ json: detail });
    if (path.endsWith("/conversations"))
      return route.fulfill({ json: { items: [detail.conversation] } });
    if (path.endsWith("/operations"))
      return route.fulfill({ json: { items: [] } });
    return route.continue();
  });
  await page.setViewportSize({ width: 768, height: 920 });
  await page.goto("/amadeus?conversation=insertion-chat");
  const input = page.getByRole("textbox", { name: "向 Amadeus 提问" });
  await input.fill("请结合附件调整方向");
  await page.locator(".amadeus-composer input[type=file]").setInputFiles({
    name: "evidence.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("new evidence"),
  });
  const insert = page.getByRole("button", { name: "插入", exact: true });
  await expect(insert).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "停止", exact: true }),
  ).toBeVisible();
  for (const width of [320, 480, 768]) {
    await page.setViewportSize({ width, height: 920 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (value) => (document.documentElement.dataset.theme = value),
        theme,
      );
      const bounds = await page
        .locator(".amadeus-composer-footer")
        .boundingBox();
      const actions = await page
        .locator(".amadeus-composer-actions")
        .boundingBox();
      const choices = await page
        .locator(".amadeus-composer-models")
        .boundingBox();
      expect(bounds && actions && choices).toBeTruthy();
      expect(actions!.x).toBeGreaterThanOrEqual(choices!.x + choices!.width);
      expect(actions!.x + actions!.width).toBeLessThanOrEqual(
        bounds!.x + bounds!.width + 1,
      );
      await page.screenshot({
        path: test.info().outputPath(`composer-${width}-${theme}.png`),
      });
    }
  }
  await page.getByRole("button", { name: "运行设置", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "运行设置" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "推理强度" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await input.focus();
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  expect(sends).toBe(0);
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("请结合附件调整方向\n");
  await input.fill("请结合附件调整方向");
  await input.press("Enter");
  await instructionPosted;
  await input.fill("下一条还在编辑");
  release();
  await expect(input).toHaveValue("下一条还在编辑");
  await expect(page.getByText("补充消息 · 已送达")).toBeVisible();
  await expect(
    page.getByText("已经结合新附件调整。", { exact: true }),
  ).toBeVisible();
  expect(sends).toBe(1);
  await page.reload();
  await expect(page.getByText("补充消息 · 已送达")).toBeVisible();
  await expect(
    page.getByText("请结合附件调整方向", { exact: true }),
  ).toHaveCount(1);
  expect(sends).toBe(1);
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
});
