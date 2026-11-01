import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Maximize2,
  MessageCircle,
  Send,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { api, unwrap } from "@platform/api/client";
import { useTheme } from "@shared/ui/theme";
import {
  clearChat,
  getChat,
  getDocument,
  getProject,
  olderChatMessages,
  sendChat,
  updateChat,
  type PetChat,
  type PetChatMessage,
} from "./api";
import { bubblePreview } from "./chatPresentation";
import { useChatWindowLayout } from "./useChatWindowLayout";
import { useChatHistoryScroll } from "./useChatHistoryScroll";
import "@shared/ui/theme.css";
import "./chat.css";

type ModelOption = { id: string; label: string; modalities: string[] };

export function ChatWindow({ projectId }: { projectId: string }) {
  useTheme();
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
  const [name, setName] = useState("桌宠");
  const [expanded, setExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const olderRequest = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const controller = useRef<AbortController | null>(null);
  const mode = chat?.presentationMode ?? "bubble";
  const full = mode === "dialogue" || expanded || settingsOpen;
  const historyScroll = useChatHistoryScroll(
    messages,
    outgoing,
    streaming,
    full && !settingsOpen,
  );
  const side = useChatWindowLayout(full);
  const locked = !chat || busy || chat.active;

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
      getProject(projectId),
    ])
      .then(([current, options, document, project]) => {
        if (!alive) return;
        setChat(current);
        setMessages(current.messages);
        setOlder(current.nextBefore ?? null);
        setModels(
          options.items.filter((item) => item.modalities.includes("text")),
        );
        setGreeting(document.config.persona?.greeting ?? "");
        setName(project.title || "桌宠");
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
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void window.futurePropsDesktop?.closePetChat?.();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const changeSettings = async (
    modelId: string | null,
    proactive: boolean,
    presentation = mode,
  ) => {
    if (!chat || locked) return;
    setBusy(true);
    setError("");
    try {
      const next = await updateChat(
        projectId,
        chat.revision,
        modelId,
        proactive,
        presentation,
      );
      setChat(next);
      setMessages(next.messages);
      if (presentation !== mode) setExpanded(false);
    } catch (cause) {
      setError(
        `${cause instanceof Error ? cause.message : "设置失败"}；未覆盖设置，请核对当前值。`,
      );
      await reload().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    const content = draft.trim();
    if (!chat || locked || !content) return;
    if (!chat.modelId) {
      setError("先在聊天设置中选择文字模型");
      setSettingsOpen(true);
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setDraft("");
    historyScroll.scrollToLatest();
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
              (current) =>
                current && {
                  ...current,
                  revision: event.revision!,
                  active: true,
                },
            );
          if (event.type === "delta") {
            reply += event.text;
            setStreaming(reply);
            // The companion owns text; the pet only receives animation phases.
            void window.futurePropsDesktop?.sendPetChatState?.({
              phase: "speaking",
              text: "",
            });
          }
          if (event.type === "error")
            streamError = event.detail || "模型回复失败";
        },
      );
      if (streamError) throw new Error(streamError);
      void window.futurePropsDesktop?.sendPetChatState?.({
        phase: "done",
        text: "",
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
    if (older === null || olderRequest.current) return;
    olderRequest.current = true;
    setLoadingOlder(true);
    try {
      const page = await olderChatMessages(projectId, older);
      historyScroll.preservePrepend();
      setMessages((current) => [...page.items, ...current]);
      setOlder(page.nextBefore ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载历史失败");
    } finally {
      olderRequest.current = false;
      setLoadingOlder(false);
    }
  };
  const clear = async () => {
    if (!chat || locked) return;
    setBusy(true);
    try {
      const next = await clearChat(projectId, chat.revision);
      setChat(next);
      setMessages([]);
      setOlder(null);
      setConfirmClear(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "清空失败");
      await reload().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };
  const latest = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const reply = outgoing
    ? streaming || "正在思考…"
    : latest
      ? latest.status === "pending"
        ? "正在回复…"
        : latest.content || "回复中断"
      : greeting || "打声招呼吧。";
  const preview = bubblePreview(reply, 80);
  return (
    <section
      className={`dp-chat-window ${full ? "is-expanded" : "is-compact"} tail-${side}`}
      aria-label="桌宠聊天"
      data-chat-surface
    >
      <header className="dp-chat-header">
        <div className="dp-chat-name">
          <MessageCircle size={16} />
          <strong title={name}>{name}</strong>
        </div>
        <div className="dp-chat-tools">
          <button
            aria-label="聊天设置"
            title="聊天设置"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((value) => !value)}
          >
            <Settings2 size={16} />
          </button>
          {full && mode === "bubble" && (
            <button
              aria-label="收回气泡"
              title="收回气泡"
              onClick={() => {
                setExpanded(false);
                setSettingsOpen(false);
                setConfirmClear(false);
              }}
            >
              <ChevronDown size={16} />
            </button>
          )}
          <button
            aria-label="关闭聊天"
            title="关闭聊天"
            onClick={() => void window.futurePropsDesktop?.closePetChat?.()}
          >
            <X size={16} />
          </button>
        </div>
      </header>
      {full && (
        <div className="dp-chat-modes" role="group" aria-label="回复呈现方式">
          {(["bubble", "dialogue"] as const).map((value) => (
            <button
              key={value}
              disabled={locked}
              aria-pressed={mode === value}
              onClick={() =>
                void changeSettings(
                  chat!.modelId,
                  chat!.proactiveLinesEnabled,
                  value,
                )
              }
            >
              {value === "bubble" ? "角色气泡" : "完整对话"}
            </button>
          ))}
        </div>
      )}
      {settingsOpen ? (
        <div className="dp-chat-settings">
          <h2>聊天设置</h2>
          <span>文字模型</span>
          <div
            className="dp-chat-models"
            role="group"
            aria-label="选择文字模型"
          >
            {models.length ? (
              models.map((model) => (
                <button
                  key={model.id}
                  aria-pressed={chat?.modelId === model.id}
                  disabled={locked}
                  onClick={() =>
                    void changeSettings(
                      model.id,
                      chat?.proactiveLinesEnabled ?? false,
                    )
                  }
                >
                  {model.label}
                </button>
              ))
            ) : (
              <small>当前账号没有可用的文字模型</small>
            )}
          </div>
          <label className="dp-chat-proactive">
            <input
              type="checkbox"
              checked={chat?.proactiveLinesEnabled ?? false}
              disabled={locked}
              onChange={(event) =>
                void changeSettings(chat?.modelId ?? null, event.target.checked)
              }
            />
            <span>允许偶尔主动说话</span>
          </label>
          <p className="dp-chat-hint">
            展示偏好仅用于你在当前空间的这只桌宠。生成期间仍可展开和收回回复。
          </p>
          <button
            className="dp-chat-clear-entry"
            disabled={locked || !messages.length}
            onClick={() => setConfirmClear(true)}
          >
            <Trash2 size={14} /> 清空聊天记录
          </button>
          {confirmClear && (
            <div
              className="dp-chat-clear"
              role="group"
              aria-label="确认清空聊天"
            >
              <span>清空这只桌宠的全部聊天记录？</span>
              <button disabled={locked} onClick={() => void clear()}>
                确认清空
              </button>
              <button onClick={() => setConfirmClear(false)}>取消</button>
            </div>
          )}
          <button
            className="dp-chat-settings-done"
            onClick={() => {
              setSettingsOpen(false);
              setConfirmClear(false);
            }}
          >
            完成设置
          </button>
        </div>
      ) : full ? (
        <div
          className="dp-chat-history"
          ref={historyScroll.history}
          onScroll={historyScroll.trackScroll}
          role="log"
          aria-live="polite"
        >
          {older !== null && (
            <button
              className="dp-chat-older"
              disabled={loadingOlder}
              onClick={() => void loadOlder()}
            >
              <ArrowUp size={14} /> {loadingOlder ? "正在加载…" : "更早的消息"}
            </button>
          )}
          {messages.length === 0 && !outgoing && (
            <p className="dp-chat-empty">{greeting || "打声招呼吧。"}</p>
          )}
          {messages.map((message) => (
            <div key={message.id} className={`dp-chat-message ${message.role}`}>
              <small>
                {message.role === "user" ? "我" : name}
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
            <>
              <div className="dp-chat-message user">
                <small>我</small>
                <p>{outgoing}</p>
              </div>
              <div className="dp-chat-message assistant">
                <small>{name}</small>
                <p>{streaming || "正在思考…"}</p>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="dp-chat-bubble" role="log" aria-live="polite">
          <p>
            {preview.text}
            {preview.truncated ? "…" : ""}
          </p>
          <button className="dp-chat-expand" onClick={() => setExpanded(true)}>
            <Maximize2 size={13} />{" "}
            {preview.truncated ? "展开完整回复" : "展开对话"}
          </button>
        </div>
      )}
      {error && (
        <p className="dp-chat-error" role="alert">
          {error}
        </p>
      )}
      {full && !settingsOpen && historyScroll.awayFromLatest && (
        <button
          type="button"
          className="dp-chat-latest"
          onClick={historyScroll.scrollToLatest}
        >
          <ArrowDown size={14} /> 回到最新
        </button>
      )}
      {!settingsOpen && (
        <footer className="dp-chat-footer">
          <textarea
            ref={input}
            aria-label="输入消息"
            value={draft}
            maxLength={2000}
            rows={full ? 2 : 1}
            placeholder={
              chat?.modelId ? `和${name}说点什么…` : "先在设置中选择文字模型"
            }
            disabled={locked || !chat?.modelId}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={keyDown}
          />
          <button
            className="dp-chat-send"
            title="发送"
            aria-label="发送"
            disabled={locked || !draft.trim() || !chat?.modelId}
            onClick={() => void send()}
          >
            <Send size={17} />
          </button>
        </footer>
      )}
    </section>
  );
}
