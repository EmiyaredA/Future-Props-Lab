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
    messages: [] as {
      id: string;
      position: number;
      role: "user" | "assistant";
      content: string;
      status: "completed";
      createdAt: string;
    }[],
    nextBefore: null,
  },
  close: vi.fn(),
  phases: [] as string[],
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
  getDocument: async () => ({
    config: { persona: { greeting: "你好，来聊聊吧" } },
  }),
  updateChat: async (
    _id: string,
    revision: number,
    modelId: string | null,
    proactive: boolean,
  ) => {
    state.chat = {
      ...state.chat,
      revision: revision + 1,
      modelId,
      proactiveLinesEnabled: proactive,
    };
    return structuredClone(state.chat);
  },
  olderChatMessages: async () => ({ items: [], nextBefore: null }),
  clearChat: async () => ({ ...state.chat, messages: [] }),
  sendChat: async (
    _id: string,
    revision: number,
    content: string,
    _signal: AbortSignal,
    onEvent: (event: unknown) => void,
  ) => {
    onEvent({ type: "start", revision: revision + 1 });
    onEvent({ type: "delta", text: "你" });
    onEvent({ type: "delta", text: "好" });
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
    messages: [],
    nextBefore: null,
  };
  state.close.mockReset();
  state.phases = [];
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
  await user.click(screen.getByRole("button", { name: "测试文字模型" }));
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
