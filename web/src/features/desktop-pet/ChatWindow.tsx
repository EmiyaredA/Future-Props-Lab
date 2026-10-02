import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, MessageCircle, Send, Trash2, X } from "lucide-react";
import { api, unwrap } from "@platform/api/client";
import {
  clearChat,
  getChat,
  getDocument,
  olderChatMessages,
  sendChat,
  updateChat,
  type PetChat,
  type PetChatMessage,
} from "./api";
import "./chat.css";

type ModelOption = { id: string; label: string; modalities: string[] };

export function ChatWindow({ projectId }: { projectId: string }) {
  const [chat, setChat] = useState<PetChat | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [messages, setMessages] = useState<PetChatMessage[]>([]);
  const [older, setOlder] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [outgoing, setOutgoing] = useState("");
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [greeting, setGreeting] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);

  const reload = async () => {
    const current = await getChat(projectId);
    setChat(current);
    setMessages(current.messages);
    setOlder(current.nextBefore ?? null);
  };
  useEffect(() => {
    let alive = true;
    void Promise.all([
      getChat(projectId),
      api.GET("/v1/model-inference/options").then((result) => unwrap(result)),
      getDocument(projectId),
    ])
      .then(([current, options, document]) => {
        if (!alive) return;
        setChat(current);
        setMessages(current.messages);
        setOlder(current.nextBefore ?? null);
        setModels(
          options.items.filter((item) => item.modalities.includes("text")),
        );
        setGreeting(document.config.persona?.greeting ?? "");
        input.current?.focus();
      })
      .catch((cause) => {
        if (alive)
          setError(cause instanceof Error ? cause.message : "无法加载聊天");
      });
    return () => {
      alive = false;
      controller.current?.abort();
    };
  }, [projectId]);
  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [messages, outgoing, streaming]);
  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void window.futurePropsDesktop?.closePetChat?.();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const changeSettings = async (modelId: string | null, proactive: boolean) => {
    if (!chat || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await updateChat(
        projectId,
        chat.revision,
        modelId,
        proactive,
      );
      setChat(next);
      setMessages(next.messages);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "设置失败");
      await reload();
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    const content = draft.trim();
    if (!chat || busy || !content) return;
    if (!chat.modelId) {
      setError("先选择聊天模型");
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setDraft("");
    setOutgoing(content);
    setStreaming("");
    void window.futurePropsDesktop?.sendPetChatState?.({
      phase: "thinking",
      text: "",
    });
    let reply = "";
    let streamError = "";
    try {
      await sendChat(
        projectId,
        chat.revision,
        content,
        abort.signal,
        (event) => {
          if (event.type === "start" && event.revision !== null)
            setChat(
              (current) => current && { ...current, revision: event.revision! },
            );
          if (event.type === "delta") {
            reply += event.text;
            setStreaming(reply);
            void window.futurePropsDesktop?.sendPetChatState?.({
              phase: "speaking",
              text: reply.slice(-140),
            });
          }
          if (event.type === "error")
            streamError = event.detail || "模型回复失败";
        },
      );
      if (streamError) throw new Error(streamError);
      void window.futurePropsDesktop?.sendPetChatState?.({
        phase: "done",
        text: reply.slice(-140),
      });
      await reload();
    } catch (cause) {
      void window.futurePropsDesktop?.sendPetChatState?.({
        phase: "error",
        text: "",
      });
      if (!abort.signal.aborted)
        setError(cause instanceof Error ? cause.message : "聊天失败");
      await reload().catch(() => undefined);
    } finally {
      controller.current = null;
      setOutgoing("");
      setStreaming("");
      setBusy(false);
      input.current?.focus();
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void send();
    }
  };
  const loadOlder = async () => {
    if (older === null) return;
    try {
      const page = await olderChatMessages(projectId, older);
      setMessages((current) => [...page.items, ...current]);
      setOlder(page.nextBefore ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载历史失败");
    }
  };
  const clear = async () => {
    if (!chat || busy) return;
    setBusy(true);
    try {
      const next = await clearChat(projectId, chat.revision);
      setChat(next);
      setMessages([]);
      setOlder(null);
      setConfirmClear(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "清空失败");
      await reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="dp-chat-window" aria-label="桌宠聊天">
      <header className="dp-chat-header">
        <div>
          <MessageCircle size={18} />
          <strong>和桌宠聊天</strong>
        </div>
        <button
          type="button"
          title="关闭聊天"
          aria-label="关闭聊天"
          onClick={() => void window.futurePropsDesktop?.closePetChat?.()}
        >
          <X size={17} />
        </button>
      </header>
      <div className="dp-chat-settings">
        <span>文字模型</span>
        <div className="dp-chat-models" role="group" aria-label="选择文字模型">
          {models.length ? (
            models.map((model) => (
              <button
                type="button"
                key={model.id}
                aria-pressed={chat?.modelId === model.id}
                disabled={busy}
                onClick={() =>
                  void changeSettings(
                    model.id,
                    chat?.proactiveLinesEnabled ?? true,
                  )
                }
              >
                {model.label}
              </button>
            ))
          ) : (
            <small>当前 Workspace 没有可用的文字模型</small>
          )}
        </div>
        <label className="dp-chat-proactive">
          <input
            type="checkbox"
            checked={chat?.proactiveLinesEnabled ?? true}
            disabled={!chat || busy}
            onChange={(event) =>
              void changeSettings(chat?.modelId ?? null, event.target.checked)
            }
          />
          <span>允许偶尔主动说话</span>
        </label>
      </div>
      <div
        className="dp-chat-history"
        ref={scroll}
        role="log"
        aria-live="polite"
      >
        {older !== null && (
          <button className="dp-chat-older" onClick={() => void loadOlder()}>
            <ArrowDown size={14} /> 更早的消息
          </button>
        )}
        {messages.length === 0 && !outgoing && (
          <p className="dp-chat-empty">
            {greeting || "打声招呼吧。"} 聊天需要先选文字模型。
          </p>
        )}
        {messages.map((message) => (
          <div key={message.id} className={`dp-chat-message ${message.role}`}>
            <small>
              {message.role === "user" ? "我" : "桌宠"}
              {message.status === "interrupted" ? " · 已中断" : ""}
            </small>
            <p>
              {message.status === "pending"
                ? "正在回复…"
                : message.content || "回复中断"}
            </p>
          </div>
        ))}
        {outgoing && (
          <div className="dp-chat-message user">
            <small>我</small>
            <p>{outgoing}</p>
          </div>
        )}
        {outgoing && (
          <div className="dp-chat-message assistant">
            <small>桌宠</small>
            <p>{streaming || "正在思考…"}</p>
          </div>
        )}
      </div>
      {error && (
        <p className="dp-chat-error" role="alert">
          {error}
        </p>
      )}
      {confirmClear && (
        <div className="dp-chat-clear">
          <span>清空这只桌宠的全部聊天记录？</span>
          <button onClick={() => void clear()}>确认清空</button>
          <button onClick={() => setConfirmClear(false)}>取消</button>
        </div>
      )}
      <footer className="dp-chat-footer">
        <textarea
          ref={input}
          aria-label="输入消息"
          value={draft}
          maxLength={2000}
          rows={2}
          placeholder={chat?.modelId ? "和桌宠说点什么…" : "先选择文字模型"}
          disabled={!chat || busy || !chat.modelId}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={keyDown}
        />
        <button
          className="dp-chat-send"
          title="发送"
          aria-label="发送"
          disabled={busy || !draft.trim() || !chat?.modelId}
          onClick={() => void send()}
        >
          <Send size={17} />
        </button>
        <button
          className="dp-chat-delete"
          title="清空记录"
          aria-label="清空记录"
          disabled={busy || !messages.length}
          onClick={() => setConfirmClear(true)}
        >
          <Trash2 size={16} />
        </button>
      </footer>
    </section>
  );
}
