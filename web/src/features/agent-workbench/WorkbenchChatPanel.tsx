import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  FolderOpen,
  History,
  Plus,
  Send,
  Settings2,
  Square,
  Terminal,
} from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { AgentLogo } from "@features/code-agents";
import { agentName, getSessions } from "./api";
import { ChatTranscript } from "./ChatTranscript";
import { ConversationView } from "./ConversationView";
import { ProjectPicker } from "./ProjectPicker";
import { WorkbenchSourcePane, type SourceTarget } from "./WorkbenchSourcePane";
import { useWorkbench } from "./useWorkbench";
import {
  createChat,
  decideApproval,
  getChat,
  getChats,
  getExecutionCatalog,
  insertInstruction,
  removeQueuedTurn,
  resumeQueue,
  sendTurn,
  stopTurn,
  type ChatCreate,
  type ProjectChoice,
  type TurnCreate,
} from "./executionApi";
import { workbenchKeys as keys } from "./queryKeys";
import "./agent-select.css";

type Props = {
  paneId?: string;
  hidden?: boolean;
  owner: string;
  host: string;
  enabled: boolean;
  unlocked: boolean;
  onUnlock: () => void;
  onSetup?: () => void;
  onSources: () => void;
  onHistory: (id?: string) => void;
  readerHost?: HTMLElement | null;
  onOpenReader?: () => void;
  onCloseReader?: () => void;
};

function NativeHistory({
  owner,
  id,
  readerHost,
  onOpenReader,
  onCloseReader,
  unlocked,
  onUnlock,
}: { owner: string; id: string } & Pick<
  Props,
  "readerHost" | "onOpenReader" | "onCloseReader" | "unlocked" | "onUnlock"
>) {
  const { detail, paused } = useWorkbench(owner, {}, id);
  if (detail.data)
    return (
      <ConversationView
        key={id}
        item={detail.data}
        owner={owner}
        paused={paused}
        readerHost={readerHost}
        onOpenReader={onOpenReader}
        onCloseReader={onCloseReader}
        fileAccess={{ allowed: unlocked, unlock: onUnlock }}
      />
    );
  return (
    <div className="cloud-chat-empty" role={detail.error ? "alert" : "status"}>
      {detail.error?.message ?? "正在读取原端会话…"}
    </div>
  );
}

const activeStatuses = ["running", "waiting_approval", "cancelling"];

export function WorkbenchChatPanel({
  paneId,
  hidden,
  owner,
  host,
  enabled,
  unlocked,
  onUnlock,
  onSetup,
  onSources,
  onHistory,
  readerHost,
  onOpenReader,
  onCloseReader,
}: Props) {
  const cache = useQueryClient();
  const selectionKey = `fpl.cloud-control.chat.${owner}`;
  const [id, setId] = useState<string | undefined>(() => {
    try {
      return sessionStorage.getItem(selectionKey) ?? undefined;
    } catch {
      return undefined;
    }
  });
  const [history, setHistory] = useState(false);
  const [sourceTarget, setSourceTarget] = useState<SourceTarget>();
  const sourceTrigger = useRef<HTMLElement | null>(null);
  const visibleSource = enabled && unlocked ? sourceTarget : undefined;
  function closeSource() {
    setSourceTarget(undefined);
    onCloseReader?.();
    requestAnimationFrame(() =>
      sourceTrigger.current?.focus({ preventScroll: true }),
    );
  }
  const [nativeId, setNativeId] = useState<string>();
  const [project, setProject] = useState<ProjectChoice>();
  const [agent, setAgent] = useState<ChatCreate["agent_id"]>();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const actionPending = useRef(false);
  const receipt = useRef<Pick<TurnCreate, "request_id" | "text"> | undefined>(
    undefined,
  );
  const steerReceipt = useRef<
    { request_id: string; text: string; turnId: string } | undefined
  >(undefined);
  const catalog = useQuery({
    queryKey: keys.executionCatalog(owner),
    queryFn: ({ signal }) => getExecutionCatalog(signal),
    enabled,
    staleTime: 30_000,
  });
  const chats = useQuery({
    queryKey: keys.chats(owner),
    queryFn: ({ signal }) => getChats(signal),
    enabled: history,
  });
  const recent = useQuery({
    queryKey: [...keys.lists(owner), "cloud-preview"],
    queryFn: ({ signal }) => getSessions({}, undefined, signal),
    enabled: history,
  });
  const detail = useQuery({
    queryKey: keys.chat(owner, id ?? ""),
    queryFn: ({ signal }) => getChat(id!, signal),
    enabled: !!id,
  });
  const chat = detail.data;
  useEffect(() => {
    try {
      if (id) sessionStorage.setItem(selectionKey, id);
      else sessionStorage.removeItem(selectionKey);
    } catch {
      // A browser that disables storage can still use live sessions.
    }
  }, [id, selectionKey]);
  const active = chat?.turns.find((turn) =>
    activeStatuses.includes(turn.status),
  );
  useEffect(() => {
    if (!id) return;
    const events = new EventSource(
      `/v1/agent-workbench/chats/${encodeURIComponent(id)}/events`,
      { withCredentials: true },
    );
    const refresh = () =>
      void cache.invalidateQueries({ queryKey: keys.chat(owner, id) });
    const close = () => events.close();
    events.addEventListener("change", refresh);
    events.addEventListener("auth_expired", close);
    window.addEventListener("future-props:auth-required", close);
    return () => {
      close();
      window.removeEventListener("future-props:auth-required", close);
    };
  }, [cache, id, owner]);

  async function action(work: () => Promise<void>) {
    if (actionPending.current) return;
    actionPending.current = true;
    setPending(true);
    setError("");
    try {
      await work();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "操作失败，请刷新后重试",
      );
    } finally {
      actionPending.current = false;
      setPending(false);
    }
  }

  function selectChat(chatId?: string) {
    setId(chatId);
    setNativeId(undefined);
    setHistory(false);
    setSourceTarget(undefined);
    setDraft("");
    receipt.current = undefined;
    steerReceipt.current = undefined;
    setError("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSend || !draft.trim()) return;
    if (!unlocked) return onUnlock();
    void action(async () => {
      let target = id;
      if (!target) {
        if (!project || !agent) return;
        target = (await createChat({ project_id: project.id, agent_id: agent }))
          .id;
        setId(target);
        void cache.invalidateQueries({ queryKey: keys.chats(owner) });
      }
      const text = draft.trim();
      const submission =
        receipt.current?.text === text
          ? receipt.current
          : { request_id: crypto.randomUUID(), text };
      receipt.current = submission;
      await sendTurn(target, {
        ...submission,
        mode: queueMode ? "queue" : "immediate",
      });
      setDraft("");
      receipt.current = undefined;
      await cache.invalidateQueries({ queryKey: keys.chat(owner, target) });
    });
  }

  function steer() {
    if (!id || !active || !canSteer || !draft.trim()) return;
    if (!unlocked) return onUnlock();
    const text = draft.trim();
    const previous = steerReceipt.current;
    const requestId =
      previous?.text === text && previous.turnId === active.id
        ? previous.request_id
        : crypto.randomUUID();
    steerReceipt.current = { request_id: requestId, text, turnId: active.id };
    void action(async () => {
      const reply = await insertInstruction(id, active.id, {
        request_id: requestId,
        text,
      });
      await cache.invalidateQueries({ queryKey: keys.chat(owner, id) });
      if (reply.status === "accepted") {
        setDraft("");
        steerReceipt.current = undefined;
      } else if (reply.status === "rejected") {
        steerReceipt.current = undefined;
        throw new Error("当前轮未接收这条指令，可以加入队列。");
      } else if (reply.status === "unknown") {
        throw new Error("插入结果未知，草稿已保留。");
      }
    });
  }

  function updateQueue(change: (chatId: string) => Promise<unknown>) {
    if (!id) return;
    if (!unlocked) return onUnlock();
    void action(async () => {
      await change(id);
      await cache.invalidateQueries({ queryKey: keys.chat(owner, id) });
    });
  }

  const projects = catalog.data?.projects ?? [];
  const agents = catalog.data?.agents ?? [];
  const canSelectDirectory = !!catalog.data?.can_select_directory;
  const projectChoice = canSelectDirectory
    ? project
    : projects.find((item) => item.id === project?.id);
  const agentChoice = agents.find(
    (item) => item.id === agent && item.available,
  );
  const hasProjects = canSelectDirectory || projects.length > 0;
  const hasAgents = agents.some((item) => item.available);
  const ready = enabled && !catalog.error && hasProjects && hasAgents;
  const selectedAgent = chat?.agent_id ?? agentChoice?.id;
  const selectedProject = chat?.project_id ?? projectChoice?.id;
  const canSend =
    enabled &&
    (id ? !!chat : ready && !!projectChoice && !!agentChoice) &&
    !pending;
  const queue = chat?.queue ?? [];
  const queueMode = !!active || queue.length > 0;
  const canSteer =
    enabled &&
    !pending &&
    active?.status === "running" &&
    chat?.steerable_turn_id === active.id;

  return (
    <section
      id={paneId}
      className="cloud-pane cloud-chat"
      aria-label="Agent 工作台"
      hidden={hidden}
    >
      <header className="cloud-pane-bar">
        <h2>
          <Terminal size={17} aria-hidden="true" /> Agent 工作台
        </h2>
        <span className="cloud-host">{host}</span>
        <div className="cloud-pane-actions">
          <button
            className="btn"
            aria-label="会话历史"
            aria-expanded={history}
            disabled={pending}
            onClick={() => setHistory(!history)}
          >
            <History size={16} />
          </button>
          <button
            className="btn cloud-new-chat"
            onClick={() => selectChat()}
            disabled={pending}
          >
            <Plus size={16} />
            新会话
          </button>
        </div>
      </header>

      {history ? (
        <div className="cloud-history">
          <div className="cloud-pane-actions">
            <button className="btn" onClick={() => onHistory()}>
              查看完整工作台
            </button>
            <button className="btn" onClick={onSources}>
              管理来源
            </button>
          </div>
          <h3>FPL 发起的会话</h3>
          {chats.isPending ? (
            <p>正在读取…</p>
          ) : chats.error ? (
            <p role="alert">{chats.error.message}</p>
          ) : (
            !chats.data?.length && <p>暂无会话。</p>
          )}
          {chats.data?.map((entry) => (
            <button
              key={entry.id}
              onClick={() => selectChat(entry.id)}
              className="cloud-history-row"
            >
              <AgentLogo id={entry.agent_id} size={17} />
              {agentName(entry.agent_id)} ·{" "}
              {entry.project_label ??
                projects.find((item) => item.id === entry.project_id)?.label ??
                entry.project_id}
              <time>{new Date(entry.created_at * 1000).toLocaleString()}</time>
            </button>
          ))}
          <h3>已有 CLI / APP 会话</h3>
          {recent.error && <p role="alert">{recent.error.message}</p>}
          {recent.data?.items.slice(0, 8).map((entry) => (
            <button
              className="cloud-history-row"
              key={entry.id}
              onClick={() => {
                selectChat();
                setNativeId(entry.id);
              }}
            >
              <AgentLogo id={entry.agent_id} size={17} />
              {entry.title || "未命名会话"}
            </button>
          ))}
        </div>
      ) : nativeId ? (
        <NativeHistory
          key={nativeId}
          owner={owner}
          id={nativeId}
          readerHost={readerHost}
          onOpenReader={onOpenReader}
          onCloseReader={onCloseReader}
          unlocked={enabled && unlocked}
          onUnlock={onUnlock}
        />
      ) : (
        <>
          {id ? (
            <div className="cloud-chat-context">
              <span className="cloud-chat-selection">
                {selectedAgent && <AgentLogo id={selectedAgent} size={17} />}
                {selectedAgent ? agentName(selectedAgent) : "读取会话…"}
              </span>
              <span className="cloud-chat-selection">
                <FolderOpen size={15} aria-hidden="true" />
                {chat?.project_label ??
                  projects.find((item) => item.id === selectedProject)?.label ??
                  selectedProject ??
                  "读取项目…"}
              </span>
            </div>
          ) : enabled && catalog.data?.enabled ? (
            <div className="cloud-chat-context cloud-chat-choices">
              {canSelectDirectory ? (
                <ProjectPicker
                  owner={owner}
                  catalog={catalog.data}
                  selected={projectChoice}
                  disabled={pending}
                  onSelect={(choice) => {
                    setProject(choice);
                    setError("");
                    void cache.invalidateQueries({
                      queryKey: keys.executionCatalog(owner),
                    });
                  }}
                />
              ) : (
                <CustomSelect
                  value={projectChoice?.id ?? ""}
                  options={[
                    { value: "", label: "选择项目", disabled: true },
                    ...projects.map((item) => ({
                      value: item.id,
                      label: item.label,
                    })),
                  ]}
                  ariaLabel="选择项目"
                  leadingIcon={<FolderOpen size={15} aria-hidden="true" />}
                  disabled={pending || !hasProjects}
                  onChange={(value) =>
                    setProject(projects.find((item) => item.id === value))
                  }
                />
              )}
              <CustomSelect
                value={agentChoice?.id ?? ""}
                className="workbench-agent-select"
                options={agents.map((item) => ({
                  value: item.id,
                  label: item.id === "codex" ? "Codex CLI" : item.label,
                  disabled: !item.available,
                  description: item.available ? undefined : item.status,
                  icon: <AgentLogo id={item.id} size={18} />,
                }))}
                onChange={(value) =>
                  setAgent(
                    agents.find((item) => item.id === value && item.available)
                      ?.id,
                  )
                }
                ariaLabel="选择 Agent"
                placeholder="选择 Agent"
                menuMinWidth={244}
                leadingIcon={<Terminal size={15} aria-hidden="true" />}
                disabled={pending}
              />
            </div>
          ) : null}
          {id ? (
            <div
              className={`aw-execution-content${visibleSource && !readerHost ? " has-source" : ""}`}
            >
              <ChatTranscript
                key={id}
                chat={chat}
                busy={pending}
                unlocked={unlocked}
                openSource={(target) => {
                  sourceTrigger.current =
                    document.activeElement instanceof HTMLElement
                      ? document.activeElement
                      : null;
                  setSourceTarget(target);
                  onOpenReader?.();
                }}
                decide={(turn, approval, approved) => {
                  void action(async () => {
                    await decideApproval(id, turn, approval, approved);
                    await cache.invalidateQueries({
                      queryKey: keys.chat(owner, id),
                    });
                  });
                }}
              />
              {visibleSource &&
                (readerHost ? (
                  createPortal(
                    <WorkbenchSourcePane
                      key={`${id}:${visibleSource.turnId}:${visibleSource.callId}`}
                      owner={owner}
                      chatId={id}
                      target={visibleSource}
                      close={closeSource}
                    />,
                    readerHost,
                  )
                ) : (
                  <WorkbenchSourcePane
                    key={`${id}:${visibleSource.turnId}:${visibleSource.callId}`}
                    owner={owner}
                    chatId={id}
                    target={visibleSource}
                    close={closeSource}
                  />
                ))}
            </div>
          ) : (
            <div className="cloud-chat-empty cloud-chat-start">
              <div className="cloud-chat-start-card">
                <span className="cloud-chat-start-icon">
                  <Terminal size={21} aria-hidden="true" />
                </span>
                <strong>{ready ? "开始新会话" : "准备 Agent 工作台"}</strong>
                {!enabled ? (
                  <p>请从 Mac 本机配置并启用 Agent。已有会话可从历史查看。</p>
                ) : catalog.error ? (
                  <p role="alert">{catalog.error.message}</p>
                ) : catalog.isPending ? (
                  <p role="status">正在读取项目和 CLI…</p>
                ) : ready ? (
                  <p>选择项目和 CLI，就可以在 {host} 上开始工作。</p>
                ) : (
                  <ul className="cloud-chat-checklist">
                    <li data-ready={hasProjects}>
                      {hasProjects ? (
                        <Check size={15} aria-hidden="true" />
                      ) : (
                        <FolderOpen size={15} aria-hidden="true" />
                      )}
                      {projectChoice
                        ? "已选择项目"
                        : hasProjects
                          ? "可在上方选择项目目录"
                          : "此入口暂无可用项目"}
                    </li>
                    <li data-ready={hasAgents}>
                      {hasAgents ? (
                        <Check size={15} aria-hidden="true" />
                      ) : (
                        <Terminal size={15} aria-hidden="true" />
                      )}
                      {hasAgents ? (
                        "CLI 已就绪"
                      ) : onSetup ? (
                        <a href="/code-agents" target="_blank" rel="noopener">
                          在编程智能体中启用 CLI
                        </a>
                      ) : (
                        "请在本机启用 CLI"
                      )}
                    </li>
                  </ul>
                )}
                {enabled && catalog.error ? (
                  <button
                    className="btn"
                    type="button"
                    onClick={() => void catalog.refetch()}
                  >
                    重试加载
                  </button>
                ) : !enabled && onSetup ? (
                  <button
                    className="btn cloud-chat-setup"
                    type="button"
                    onClick={onSetup}
                  >
                    <Settings2 size={15} aria-hidden="true" /> 打开云控设置
                  </button>
                ) : null}
              </div>
            </div>
          )}
          {(error || detail.error) && (
            <p className="cloud-chat-error" role="alert">
              {error || detail.error?.message}
            </p>
          )}
          {queue.length > 0 && (
            <section className="aw-queue" aria-label="待执行队列">
              <div className="aw-queue-heading">
                <strong>待执行 {queue.length}</strong>
                {chat?.queue_paused && (
                  <button
                    className="btn"
                    type="button"
                    disabled={pending || !enabled || !!active}
                    onClick={() => updateQueue(resumeQueue)}
                  >
                    继续队列
                  </button>
                )}
              </div>
              {chat?.queue_paused && (
                <p role="status">队列已暂停，待执行消息已保留。</p>
              )}
              <ol>
                {queue.map((item, index) => (
                  <li key={item.id}>
                    <span title={item.prompt}>{item.prompt}</span>
                    <button
                      type="button"
                      className="aw-link"
                      disabled={pending || !enabled}
                      aria-label={`移除第 ${index + 1} 条待执行消息`}
                      onClick={() =>
                        updateQueue((chatId) =>
                          removeQueuedTurn(chatId, item.id),
                        )
                      }
                    >
                      移除
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {(id || ready) && (
            <form className="aw-composer cloud-composer" onSubmit={submit}>
              <textarea
                aria-label="给 Agent 发消息"
                placeholder={
                  selectedAgent
                    ? `给 ${agentName(selectedAgent)} 发消息…`
                    : "给 Agent 发消息…"
                }
                rows={2}
                maxLength={16000}
                value={draft}
                disabled={!enabled || pending}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.metaKey || event.ctrlKey) &&
                    !event.nativeEvent.isComposing &&
                    event.keyCode !== 229
                  ) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <div>
                {canSend && !unlocked && (
                  <button className="btn" type="button" onClick={onUnlock}>
                    验证并解锁
                  </button>
                )}
                {queueMode && unlocked && (
                  <span className="aw-subtle">
                    {chat?.queue_paused
                      ? "继续队列后执行"
                      : "当前轮正常完成后执行"}
                  </span>
                )}
                <div className="cloud-pane-actions">
                  {canSteer && unlocked && (
                    <button
                      className="btn"
                      type="button"
                      disabled={!draft.trim()}
                      onClick={steer}
                    >
                      插入本轮
                    </button>
                  )}
                  {id && active && (
                    <button
                      type="button"
                      className="btn"
                      disabled={pending || active.status === "cancelling"}
                      onClick={() => {
                        void action(async () => {
                          await stopTurn(id, active.id);
                          await cache.invalidateQueries({
                            queryKey: keys.chat(owner, id),
                          });
                        });
                      }}
                    >
                      <Square size={14} />
                      停止
                    </button>
                  )}
                  <button
                    type="submit"
                    className={queueMode ? "btn aw-queue-submit" : "aw-send"}
                    aria-label={queueMode ? "加入队列" : "发送"}
                    disabled={!canSend || !draft.trim()}
                  >
                    {queueMode ? "加入队列" : <Send size={17} />}
                  </button>
                </div>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
