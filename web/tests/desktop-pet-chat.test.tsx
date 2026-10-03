import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { ChatWindow } from "../src/features/desktop-pet/ChatWindow";

const state = vi.hoisted(() => ({
  chat: {
    revision: 0,
    modelId: null as string | null,
    proactiveLinesEnabled: true,
    active: false,
    presentationMode: "bubble" as "bubble" | "dialogue",
    messages: [] as {
      id: string;
      position: number;
      role: "user" | "assistant";
      content: string;
      status: "completed";
      createdAt: string;
    }[],
    nextBefore: null as number | null,
  },
  close: vi.fn(),
  phases: [] as string[],
  hold: null as Promise<void> | null,
  sends: 0,
  signal: null as AbortSignal | null,
  conflict: false,
  broken: false,
  older: vi.fn(),
}));

vi.mock("../src/platform/api/client", () => ({
  api: {
    GET: async () => ({
      data: {
        items: [
          { id: "text-model", label: "测试文字模型", modalities: ["text"] },
        ],
      },
    }),
  },
  unwrap: (result: { data: unknown }) => result.data,
}));
vi.mock("../src/features/desktop-pet/api", () => ({
  getChat: async () => structuredClone(state.chat),
  getProject: async () => ({ title: "牧濑红莉栖" }),
  getDocument: async () => ({
    title: "牧濑红莉栖",
    config: { persona: { greeting: "你好，来聊聊吧" } },
  }),
  updateChat: async (
    _id: string,
    revision: number,
    modelId: string | null,
    proactive: boolean,
    presentationMode: "bubble" | "dialogue",
  ) => {
    if (state.conflict) {
      state.chat.presentationMode = "dialogue";
      state.chat.revision++;
      throw new Error("版本冲突");
    }
    state.chat = {
      ...state.chat,
      revision: revision + 1,
      modelId,
      proactiveLinesEnabled: proactive,
      presentationMode,
    };
    return structuredClone(state.chat);
  },
  olderChatMessages: (...args: unknown[]) => state.older(...args),
  clearChat: async () => ({ ...state.chat, messages: [] }),
  sendChat: async (
    _id: string,
    revision: number,
    content: string,
    _signal: AbortSignal,
    onEvent: (event: unknown) => void,
  ) => {
    state.sends++;
    state.signal = _signal;
    onEvent({ type: "start", revision: revision + 1 });
    onEvent({ type: "delta", text: "你" });
    onEvent({ type: "delta", text: "好" });
    if (state.hold) await state.hold;
    if (state.broken) throw new Error("连接中断");
    onEvent({ type: "done", revision: revision + 2 });
    state.chat = {
      ...state.chat,
      revision: revision + 2,
      messages: [
        {
          id: "u",
          position: 1,
          role: "user",
          content,
          status: "completed",
          createdAt: "2026-10-02T00:00:00Z",
        },
        {
          id: "a",
          position: 2,
          role: "assistant",
          content: "你好",
          status: "completed",
          createdAt: "2026-10-02T00:00:01Z",
        },
      ],
    };
  },
}));

beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
  state.chat = {
    revision: 0,
    modelId: null,
    proactiveLinesEnabled: true,
    active: false,
    presentationMode: "bubble",
    messages: [],
    nextBefore: null,
  };
  state.close.mockReset();
  state.phases = [];
  state.hold = null;
  state.sends = 0;
  state.signal = null;
  state.conflict = false;
  state.broken = false;
  state.older.mockReset().mockResolvedValue({ items: [], nextBefore: null });
  Object.defineProperty(window, "futurePropsDesktop", {
    configurable: true,
    value: {
      closePetChat: state.close,
      sendPetChatState: async (value: { phase: string }) => {
        state.phases.push(value.phase);
      },
    },
  });
});

test("model selection, streamed reply, reopen history and Escape", async () => {
  const user = userEvent.setup();
  const first = render(<ChatWindow projectId="pet-1" />);
  expect(
    await screen.findByText("你好，来聊聊吧", { exact: false }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "聊天设置" }));
  await user.click(screen.getByRole("button", { name: "测试文字模型" }));
  await user.click(screen.getByRole("button", { name: "完成设置" }));
  const input = screen.getByRole("textbox", { name: "输入消息" });
  await user.type(input, "嗨{Enter}");
  await waitFor(() =>
    expect(screen.getByText("你好", { exact: true })).toBeVisible(),
  );
  expect(state.phases).toContain("thinking");
  expect(state.phases).toContain("speaking");
  first.unmount();
  render(<ChatWindow projectId="pet-1" />);
  await waitFor(() =>
    expect(screen.getByText("你好", { exact: true })).toBeVisible(),
  );
  await user.keyboard("{Escape}");
  expect(state.close).toHaveBeenCalled();
});

test("long bubble expands to complete history, persists mode and restores it", async () => {
  const user = userEvent.setup();
  const content = "先给一个结论。" + "接下来是完整说明。".repeat(25);
  state.chat.modelId = "text-model";
  state.chat.messages = [
    {
      id: "long",
      position: 1,
      role: "assistant",
      content,
      status: "completed",
      createdAt: "now",
    },
  ];
  const first = render(<ChatWindow projectId="pet-1" />);
  await screen.findByText("牧濑红莉栖");
  expect(screen.queryByText(content)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "展开完整回复" }));
  expect(screen.getByText(content)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "完整对话" }));
  await waitFor(() => expect(state.chat.presentationMode).toBe("dialogue"));
  expect(state.sends).toBe(0);
  first.unmount();
  render(<ChatWindow projectId="pet-1" />);
  expect(await screen.findByText(content)).toBeVisible();
  expect(screen.getByRole("button", { name: "完整对话" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("expanding and collapsing during generation keeps one live stream", async () => {
  const user = userEvent.setup();
  state.chat.modelId = "text-model";
  let finish!: () => void;
  state.hold = new Promise<void>((resolve) => {
    finish = resolve;
  });
  render(<ChatWindow projectId="pet-1" />);
  await screen.findByText("牧濑红莉栖");
  await user.type(
    screen.getByRole("textbox", { name: "输入消息" }),
    "你好{Enter}",
  );
  await screen.findByText("你好", { exact: true });
  await user.click(screen.getByRole("button", { name: "展开对话" }));
  expect(screen.getByRole("button", { name: "完整对话" })).toBeDisabled();
  expect(screen.getAllByText("你好", { exact: true })).toHaveLength(2); // User + assistant.
  await user.click(screen.getByRole("button", { name: "收回气泡" }));
  expect(screen.getAllByText("你好", { exact: true })).toHaveLength(1);
  expect(state.signal?.aborted).toBe(false);
  expect(state.sends).toBe(1);
  finish();
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "输入消息" })).toBeEnabled(),
  );
  expect(state.sends).toBe(1);
});

test("settings conflict restores server preference without retrying or hiding the error", async () => {
  const user = userEvent.setup();
  render(<ChatWindow projectId="pet-1" />);
  await screen.findByText("牧濑红莉栖");
  await user.click(screen.getByRole("button", { name: "展开对话" }));
  state.conflict = true;
  await user.click(screen.getByRole("button", { name: "完整对话" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("版本冲突");
  expect(screen.getByRole("button", { name: "完整对话" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(state.sends).toBe(0);
});

test("stream failure is visible and never resubmits automatically", async () => {
  const user = userEvent.setup();
  state.chat.modelId = "text-model";
  state.broken = true;
  render(<ChatWindow projectId="pet-1" />);
  await screen.findByText("牧濑红莉栖");
  await user.type(
    screen.getByRole("textbox", { name: "输入消息" }),
    "嗨{Enter}",
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("连接中断");
  expect(state.sends).toBe(1);
  expect(state.phases).toContain("error");
});

test("older history only has one request in flight and failures allow deliberate retry", async () => {
  state.chat.presentationMode = "dialogue";
  state.chat.nextBefore = 50;
  let reject!: (error: Error) => void;
  state.older.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  render(<ChatWindow projectId="pet-1" />);
  const button = await screen.findByRole("button", { name: "更早的消息" });
  await userEvent.click(button);
  expect(screen.getByRole("button", { name: "正在加载…" })).toBeDisabled();
  await userEvent.click(button);
  expect(state.older).toHaveBeenCalledTimes(1);
  reject(new Error("历史加载失败"));
  expect(await screen.findByRole("alert")).toHaveTextContent("历史加载失败");
  await userEvent.click(screen.getByRole("button", { name: "更早的消息" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "更早的消息" }),
    ).not.toBeInTheDocument(),
  );
  expect(state.older).toHaveBeenCalledTimes(2);
});
