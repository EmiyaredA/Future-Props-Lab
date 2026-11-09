import { useState, type RefObject } from "react";
import type { DisplayItem } from "./displayTimeline";
import type { ChatMessage, Detail } from "./protocol";

const isSavedText = (message: ChatMessage) =>
  message.role === "user" || message.role === "assistant";

export function messageAnchors(
  messages: ChatMessage[],
  entries: DisplayItem[],
) {
  const saved = new Map(
    messages.filter(isSavedText).map((item) => [item.id, item]),
  );
  const exact = new Set(
    entries.flatMap((item) =>
      item.kind === "message" ? [item.message.id] : [],
    ),
  );
  const byRun = new Map<string, ChatMessage[]>();
  for (const message of saved.values()) {
    if (
      message.role !== "assistant" ||
      !message.run_id ||
      exact.has(message.id)
    )
      continue;
    const siblings = byRun.get(message.run_id) ?? [];
    siblings.push(message);
    byRun.set(message.run_id, siblings);
  }
  const anchors = new Map<string, ChatMessage>();
  for (const item of [...entries].reverse()) {
    if (item.kind !== "message" || item.streaming) continue;
    const { message } = item;
    const stored = saved.get(message.id);
    if (stored) anchors.set(message.id, stored);
    else if (message.role === "assistant" && message.run_id) {
      const candidates = byRun.get(message.run_id);
      if (candidates?.length === 1) {
        anchors.set(message.id, candidates[0]);
        byRun.delete(message.run_id);
      }
    }
  }
  return anchors;
}

type ForkTarget = { messageId: string; requestId: string };
type Interaction = {
  conversationId?: string;
  ids: string[];
  fork?: ForkTarget;
};

export function useMessageActions({
  detail,
  busy,
  writable,
  frame,
  onPin,
  onFork,
}: {
  detail: Detail | null;
  busy: boolean;
  writable: boolean;
  frame: RefObject<HTMLElement | null>;
  onPin: (
    conversationId: string,
    messageId: string,
    pinned: boolean,
  ) => Promise<void>;
  onFork: (
    conversationId: string,
    messageId: string,
    requestId: string,
  ) => Promise<void>;
}) {
  const conversationId = detail?.conversation.id;
  const [interaction, setInteraction] = useState<Interaction>({ ids: [] });
  const [pendingPin, setPendingPin] = useState<string>();
  const [pendingFork, setPendingFork] = useState(false);
  const [feedback, setFeedback] = useState<{
    conversationId?: string;
    text: string;
    error?: boolean;
  }>();
  if (interaction.conversationId !== conversationId)
    setInteraction({ conversationId, ids: [] });
  const current =
    interaction.conversationId === conversationId ? interaction : { ids: [] };
  const messages = detail?.messages.filter(isSavedText) ?? [];
  const selected = messages.filter((message) =>
    current.ids.includes(message.id),
  );
  const report = (text: string, error = false) =>
    setFeedback({ conversationId, text, error });
  const select = (ids: string[]) => setInteraction({ conversationId, ids });
  const copy = async (items: ChatMessage[]) => {
    try {
      await navigator.clipboard.writeText(
        items.map(({ content }) => content).join("\n\n"),
      );
      report(
        items.length === 1 ? "已复制消息" : `已复制 ${items.length} 条消息`,
      );
    } catch {
      report("无法访问剪贴板，请手动复制消息正文。", true);
    }
  };
  return {
    canPin: writable && detail?.conversation.executor_kind !== "legacy-pi",
    canFork: writable,
    busy,
    pendingPin,
    pendingFork,
    selected,
    messages,
    feedback:
      feedback?.conversationId === conversationId ? feedback : undefined,
    fork: current.fork,
    select,
    copy,
    toggle: (messageId: string) => {
      const ids = current.ids;
      select(
        ids.includes(messageId)
          ? ids.filter((id) => id !== messageId)
          : [...ids, messageId],
      );
    },
    jump: (messageId: string) => {
      requestAnimationFrame(() => {
        const row = frame.current?.querySelector<HTMLElement>(
          `[data-amadeus-message-id="${CSS.escape(messageId)}"]`,
        );
        row?.scrollIntoView({ block: "center" });
        row?.focus({ preventScroll: true });
      });
    },
    pin: async (message: ChatMessage) => {
      if (!conversationId || pendingPin) return;
      setPendingPin(message.id);
      try {
        await onPin(conversationId, message.id, !message.pinned);
        report(message.pinned ? "已取消置顶" : "已置顶消息");
      } catch (cause) {
        report(cause instanceof Error ? cause.message : String(cause), true);
      } finally {
        setPendingPin(undefined);
      }
    },
    askFork: (messageId: string) => {
      setFeedback(undefined);
      setInteraction({
        ...current,
        conversationId,
        fork: { messageId, requestId: crypto.randomUUID() },
      });
    },
    cancelFork: () =>
      setInteraction({ ...current, conversationId, fork: undefined }),
    confirmFork: async () => {
      if (!conversationId || !current.fork || busy || pendingFork) return;
      setPendingFork(true);
      try {
        await onFork(
          conversationId,
          current.fork.messageId,
          current.fork.requestId,
        );
        setInteraction({ ids: [] });
      } catch (cause) {
        report(cause instanceof Error ? cause.message : String(cause), true);
      } finally {
        setPendingFork(false);
      }
    },
  };
}

export type MessageActions = ReturnType<typeof useMessageActions>;
