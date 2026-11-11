import { clipboardAttachments } from "./attachmentImport";
import { LoadingState } from "@shared/ui/LoadingState";
import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { imageVariants } from "@shared/lib/imageVariants";
import { useRuntimeAccess } from "@features/accounts";
import "./window.css";
import "./window-theme.css";
import "./context-panel.css";
import "./side-rail.css";
import "./activity-feed.css";
import "./conversation-layout.css";
import "./capability-dialog.css";
import {
  History,
  Plus,
  Search,
  X,
  ChevronDown,
  ChevronUp,
  ScrollText,
  UserRound,
  ArrowLeft,
  PanelRight,
  AppWindow,
  ExternalLink,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { AccountSessionContext } from "@features/accounts";
import { fetchApiJson } from "@platform/api/client";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { ConversationHistoryRow } from "./ConversationHistoryRow";
import { avatarStateLabels, type Reference } from "./protocol";
import { AttachmentReference } from "./AttachmentReference";
import { AmadeusAvatar } from "./Avatar";
import {
  ActivityFeed,
  ExecutionInspector,
  FileInspector,
} from "./ActivityFeed";
import { buildDisplayTimeline } from "./displayTimeline";
import {
  mergeReferences,
  referenceKey,
  referenceLimit,
} from "./elementReferences";
import { CapabilityDialog } from "./CapabilityDialog";
import { ContextPanel } from "./ContextPanel";
import { useAppearance } from "./useAppearance";
import { useAmadeusController } from "./useAmadeusController";
import { ProjectPicker } from "./ProjectPicker";
import { TranscriptViewport } from "./TranscriptViewport";
import { ComposerAttachments } from "./ComposerAttachments";
import { ComposerTools } from "./ComposerTools";
import { ComposerModels } from "./ComposerModels";
import { UsageIndicators } from "./UsageIndicators";
import { MessageSelection } from "./MessageActions";
import { useMessageActions } from "./useMessageActions";
import "./transcript.css";
import "./message-controls.css";

type WindowProps = {
  session: AccountSessionContext;
  standalone?: boolean;
  splitLayout?: { active: boolean; toggle: () => void };
};

export function AmadeusWindow(props: WindowProps) {
  return (
    <Tooltip.Provider delayDuration={260} disableHoverableContent>
      <AmadeusWindowContent {...props} />
    </Tooltip.Provider>
  );
}

function AmadeusWindowContent({
  session,
  standalone = false,
  splitLayout,
}: WindowProps) {
  const localBrowser = useRuntimeAccess();
  const [stageOpen, setStageOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(() => window.innerWidth >= 700);
  const [inspectorConversation, setInspectorConversation] = useState<string>();
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const historyListRef = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const railFits = useRef(window.innerWidth >= 700);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const onResize = () => {
      const width = element.clientWidth || window.innerWidth;
      const nextRail = width >= 700;
      if (railFits.current !== nextRail) {
        railFits.current = nextRail;
        setRailOpen(nextRail);
      }
    };
    onResize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }
    const observer = new ResizeObserver(onResize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const historyRegionId = useId();
  const appearance = useAppearance(session);
  const [initialConversation] = useState(() =>
    standalone
      ? new URLSearchParams(location.search).get("conversation") || undefined
      : undefined,
  );
  const controller = useAmadeusController(
    session,
    initialConversation,
    standalone,
  );
  const {
    bridge,
    detail,
    historyOpen,
    setHistoryOpen,
    search,
    setSearch,
    references,
    setReferences,
    draft,
    setDraft,
    mode,
    setMode,
    runs,
    busy,
    saving,
    activeRun,
    error,
    setError,
    capabilitiesOpen,
    setCapabilitiesOpen,
    toolApis,
    mcpServers,
    skills,
    loaded,
    setLoaded,
    renameItem,
    setRenameItem,
    renameTitle,
    setRenameTitle,
    deleteItem,
    setDeleteItem,
    importing,
    filesOpen,
    setFilesOpen,
    workFiles,
    filePreview,
    closeFilePreview,
    scriptAvailable,
    registeredOperations,
    previewReference,
    setPreviewReference,
    avatarState,
    fileInputRef,
    showAvatarState,
    open,
    openCapabilities,
    decideApproval,
    reviseApproval,
    reviseArtifact,
    answerQuestion,
    continueRun,
    create,
    rename,
    remove,
    importAttachments,
    showFiles,
    previewFile,
    downloadFile,
    send,
    startFromHistory,
    scopedContexts,
    groups,
    projects,
    setProjects,
  } = controller;
  const messageActions = useMessageActions({
    detail,
    busy,
    writable: session.me.permission_keys?.includes("content.write") ?? false,
    frame,
    onPin: controller.pinMessage,
    onFork: async (source, message, request) => {
      const branch = await controller.forkMessage(source, message, request);
      if (standalone && branch) {
        const url = new URL(window.location.href);
        url.searchParams.set("conversation", branch);
        window.history.replaceState(window.history.state, "", url);
      }
    },
  });
  const display = useMemo(
    () => (detail ? buildDisplayTimeline(detail, runs) : null),
    [detail, runs],
  );
  const hasExecution = !!display?.tools.length;
  const attachSelection = () => {
    const selected = bridge.selectedAmadeusElements();
    if (!selected.length) {
      setError("请先在工坊中选中要引用的元素");
      return false;
    }
    const next = mergeReferences(references, selected);
    setReferences(next);
    setError(
      next.length < new Set([...references, ...selected].map(referenceKey)).size
        ? `本轮最多引用 ${referenceLimit} 个元素`
        : "",
    );
    return true;
  };
  const locateReference = async (reference: Reference) => {
    const result = await bridge
      .locateAmadeusReference(reference)
      .catch(() => "failed" as const);
    setError(
      result === "found"
        ? ""
        : result === "wrong-project"
          ? "请先打开引用的来源项目"
          : result === "missing"
            ? "找不到这个元素，可能已经删除或移动"
            : "暂时无法定位这个元素，请检查来源项目后重试",
    );
  };
  const openReference = (reference: Reference) => {
    if (reference.target) void locateReference(reference);
    else setPreviewReference(reference);
  };
  const conversationId = detail?.conversation.id;
  const activeSnapshot =
    activeRun && runs.find((entry) => entry.run.id === activeRun.id);
  const activeStatus = activeSnapshot?.run.status ?? activeRun?.status;
  let composerStatus = "";
  let thinking = false;
  if (busy && (!activeRun || activeRun.conversation_id === conversationId)) {
    if (activeStatus === "cancelling") composerStatus = "正在停止…";
    else if (!activeStatus || activeStatus === "running") {
      if (
        activeRun &&
        display?.entries.some(
          (entry) =>
            entry.kind === "message" &&
            entry.streaming &&
            entry.message.run_id === activeRun.id,
        )
      )
        composerStatus = "正在输出…";
      else if (
        activeRun &&
        display?.tools.some(
          (tool) =>
            tool.runId === activeRun.id && tool.displayStatus === "running",
        )
      )
        composerStatus = "正在执行工具…";
      else {
        const answered = activeSnapshot?.events.reduce((hasReply, event) => {
          if (
            event.kind === "assistant_message" &&
            typeof event.payload.text === "string" &&
            event.payload.text.trim()
          )
            return true;
          if (event.kind === "tool_call" || event.kind === "reasoning_summary")
            return false;
          return hasReply;
        }, false);
        thinking = !answered;
      }
    }
  }
  const inspectorOpen =
    !!conversationId &&
    inspectorConversation === conversationId &&
    !filePreview;
  const renameId = renameItem?.id;
  useEffect(() => {
    if (!renameId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renameId]);
  const focusHistoryTitle = (id: string) => {
    const row = Array.from(
      historyListRef.current?.querySelectorAll<HTMLElement>(
        ".amadeus-history-row",
      ) ?? [],
    ).find((item) => item.dataset.conversationId === id);
    const target =
      row?.querySelector<HTMLButtonElement>(".amadeus-history-title") ??
      historyListRef.current?.parentElement?.querySelector<HTMLInputElement>(
        ".amadeus-search input",
      );
    target?.focus();
  };
  const cancelRename = () => {
    if (!renameItem || renaming) return;
    const id = renameItem.id;
    setRenameItem(null);
    requestAnimationFrame(() => focusHistoryTitle(id));
  };
  const saveRename = async () => {
    if (!renameItem || renaming || !renameTitle.trim()) return;
    const id = renameItem.id;
    setRenaming(true);
    setError("");
    try {
      await rename(renameItem, renameTitle.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRenaming(false);
      requestAnimationFrame(() => {
        if (renameInputRef.current) renameInputRef.current.focus();
        else focusHistoryTitle(id);
      });
    }
  };
  return (
    <div ref={frame} className="amadeus-window">
      <header className="amadeus-header">
        <div className="amadeus-brand">
          <AmadeusAvatar
            state={avatarState}
            sourceUrl={appearance.url}
            camera="avatar"
          />
          <div>
            <strong title={standalone ? detail?.conversation.title : undefined}>
              {(standalone && detail?.conversation.title) || "Amadeus"}
            </strong>
            <small>
              <span
                className={`amadeus-status-dot amadeus-status-${avatarState}`}
              />
              {standalone && detail && "Amadeus · "}
              {busy ? "运行中" : avatarStateLabels[avatarState]}
              {saving ? (
                <>
                  {" "}
                  · <LoadingState variant="inline" label="正在保存" />
                </>
              ) : (
                !busy && " · 已保存到本机"
              )}
            </small>
          </div>
        </div>
        <div className="amadeus-header-actions">
          {standalone && (
            <a className="amadeus-header-link" href="/">
              <ArrowLeft size={16} aria-hidden />
              返回 Studio
            </a>
          )}
          {hasExecution && (
            <button
              title={inspectorOpen ? "收起执行详情" : "查看执行详情"}
              aria-label={inspectorOpen ? "收起执行详情" : "查看执行详情"}
              aria-pressed={inspectorOpen}
              onClick={() => {
                setInspectorConversation(
                  inspectorOpen ? undefined : conversationId,
                );
                if (!inspectorOpen) {
                  setStageOpen(false);
                  closeFilePreview();
                }
              }}
            >
              <ScrollText size={17} />
            </button>
          )}
          <button
            title={stageOpen ? "折叠数字人" : "展开数字人"}
            aria-label={stageOpen ? "折叠数字人" : "展开数字人"}
            aria-pressed={stageOpen}
            onClick={() => {
              const next = !stageOpen;
              setStageOpen(next);
              if (next) {
                setInspectorConversation(undefined);
                closeFilePreview();
              }
            }}
          >
            <UserRound size={17} />
          </button>
          <button
            title="历史对话"
            aria-label="历史对话"
            aria-pressed={railOpen}
            onClick={() => {
              setRailOpen(!railOpen);
              if (!railOpen) setHistoryOpen(true);
            }}
          >
            <History size={17} />
          </button>
          <button
            title="新建对话"
            aria-label="新建对话"
            onClick={() => void create()}
          >
            <Plus size={18} />
          </button>
          {!standalone && (
            <div
              className="amadeus-window-actions"
              role="group"
              aria-label="窗口显示"
            >
              {splitLayout && (
                <button
                  type="button"
                  className="amadeus-header-link amadeus-layout-switch"
                  title={splitLayout.active ? "切换为右侧弹窗" : "切换为分屏"}
                  aria-label={
                    splitLayout.active ? "切换为右侧弹窗" : "切换为分屏"
                  }
                  onClick={splitLayout.toggle}
                >
                  {splitLayout.active ? (
                    <AppWindow size={16} aria-hidden />
                  ) : (
                    <PanelRight size={16} aria-hidden />
                  )}
                  {splitLayout.active ? "弹窗" : "分屏"}
                </button>
              )}
              <a
                className="amadeus-header-link"
                href={
                  detail
                    ? `/amadeus?conversation=${encodeURIComponent(detail.conversation.id)}`
                    : "/amadeus"
                }
                title="在新标签页打开 Amadeus"
                aria-label="在新标签页打开 Amadeus"
                target="_blank"
                rel="noopener"
              >
                <ExternalLink size={16} aria-hidden />
                新标签页
              </a>
              <button
                title="关闭 Amadeus"
                aria-label="关闭 Amadeus"
                onClick={() => void bridge.hideAmadeus()}
              >
                <X size={18} />
              </button>
            </div>
          )}
        </div>
      </header>
      {appearance.notice && (
        <div className="amadeus-running-banner" role="status">
          {appearance.notice}
        </div>
      )}
      {activeRun && detail?.conversation.id !== activeRun.conversation_id && (
        <div className="amadeus-running-banner">
          <span>Amadeus 正在另一个对话中处理任务</span>
          <button onClick={() => void open(activeRun.conversation_id)}>
            返回运行中的对话
          </button>
        </div>
      )}
      <div className="amadeus-body">
        <aside
          className={`amadeus-side-rail${railOpen ? " is-open" : ""}`}
          aria-label="对话侧栏"
        >
          <button
            className="amadeus-rail-close"
            type="button"
            aria-label="收起对话侧栏"
            onClick={() => setRailOpen(false)}
          >
            ×
          </button>
          <ContextPanel items={scopedContexts} />
          <section
            className={`amadeus-history${historyOpen ? " is-open" : ""}`}
            aria-label="对话历史"
          >
            <div className="amadeus-history-head">
              <button
                type="button"
                className="amadeus-history-toggle"
                aria-label={historyOpen ? "收起对话历史" : "展开对话历史"}
                aria-expanded={historyOpen}
                aria-controls={historyRegionId}
                onClick={() => setHistoryOpen(!historyOpen)}
              >
                <strong>对话历史</strong>
                {historyOpen ? (
                  <ChevronUp size={15} />
                ) : (
                  <ChevronDown size={15} />
                )}
              </button>
              <button onClick={() => void create()}>
                <Plus size={15} />
                新建
              </button>
            </div>
            <div
              id={historyRegionId}
              className="amadeus-history-content"
              hidden={!historyOpen}
            >
              <label className="amadeus-search">
                <Search size={15} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索对话或项目"
                />
              </label>
              <div className="amadeus-history-list" ref={historyListRef}>
                {groups.map((group) => (
                  <section key={group.id}>
                    <h3
                      title={
                        group.workshop
                          ? `${group.workshop.name} · ${group.name}`
                          : group.name
                      }
                    >
                      {group.workshop && (
                        <ResponsiveImage
                          className="amadeus-history-workshop-avatar"
                          src={imageVariants[group.workshop.brandImage]?.["64"]}
                          alt=""
                          width={18}
                          height={18}
                          loading="lazy"
                        />
                      )}
                      <span>
                        {group.name}
                        {group.workshop && <small>{group.workshop.name}</small>}
                      </span>
                    </h3>
                    {group.items.map((item) => (
                      <ConversationHistoryRow
                        key={item.id}
                        item={item}
                        current={detail?.conversation.id === item.id}
                        status={
                          activeRun?.conversation_id === item.id
                            ? activeRun.status
                            : item.latest_run_status
                        }
                        busy={busy}
                        saving={renaming}
                        onOpen={() => void open(item.id)}
                        onRename={() => {
                          setError("");
                          setRenameItem(item);
                          setRenameTitle(item.title);
                        }}
                        onDelete={() => {
                          setError("");
                          setDeleteItem(item);
                        }}
                        rename={
                          renameItem?.id === item.id
                            ? {
                                input: renameInputRef,
                                title: renameTitle,
                                error,
                                setTitle: setRenameTitle,
                                save: () => void saveRename(),
                                cancel: cancelRename,
                              }
                            : undefined
                        }
                      />
                    ))}
                  </section>
                ))}
              </div>
            </div>
          </section>
        </aside>
        <main className="amadeus-chat" data-popover-boundary>
          {detail?.conversation.executor_kind === "legacy-pi" && (
            <div className="amadeus-running-banner">
              旧内核历史只读。新对话使用 Code Agent。
              <button className="btn" onClick={() => void startFromHistory()}>
                带入历史，新建对话
              </button>
            </div>
          )}

          <Dialog.Root open={filesOpen} onOpenChange={setFilesOpen}>
            <Dialog.Portal>
              <Dialog.Overlay className="amadeus-files-overlay" />
              <Dialog.Content className="amadeus-files" aria-label="会话文件">
                <div className="amadeus-capabilities-head">
                  <Dialog.Title>会话文件</Dialog.Title>
                  <button
                    aria-label="收起会话文件"
                    onClick={() => setFilesOpen(false)}
                  >
                    <X size={15} />
                  </button>
                </div>
                {!detail && <p>新建对话后可导入文件。</p>}
                {detail && localBrowser && (
                  <button
                    onClick={() =>
                      void fetchApiJson(
                        `/v1/amadeus/conversations/${detail.conversation.id}/files/open-folder`,
                        { method: "POST" },
                      ).catch((cause) =>
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : String(cause),
                        ),
                      )
                    }
                  >
                    在访达中打开目录
                  </button>
                )}
                {!workFiles.length && <p>暂无文件</p>}
                {workFiles.map((item) => (
                  <div
                    className="amadeus-file-row"
                    key={`${item.kind}/${item.name}`}
                  >
                    <span>
                      {item.kind} / {item.name} · {Math.ceil(item.bytes / 1024)}{" "}
                      KiB
                    </span>
                    <button
                      onClick={() => {
                        setFilesOpen(false);
                        void previewFile(item);
                      }}
                    >
                      预览
                    </button>
                    <button onClick={() => void downloadFile(item)}>
                      下载
                    </button>
                  </div>
                ))}
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <TranscriptViewport key={detail?.conversation.id}>
            {!detail?.messages.length && (
              <div className="amadeus-welcome">
                <div className="amadeus-welcome-avatar">
                  <AmadeusAvatar
                    state={avatarState}
                    sourceUrl={appearance.url}
                    camera="avatar"
                  />
                </div>
                <h1>你好，我是 Amadeus</h1>
                <p>
                  可以读取当前应用、解释选中的控件，或帮助你完成跨应用工作。
                </p>
                <div className="amadeus-suggestions">
                  <button onClick={() => setDraft("帮我看看当前窗口里的项目")}>
                    看看当前窗口里的项目
                  </button>
                  <button
                    onClick={() => {
                      if (attachSelection()) setDraft("解释一下我选中的对象");
                    }}
                  >
                    解释选中的对象
                  </button>
                  <button onClick={() => setDraft("列出当前可用的工具能力")}>
                    列出可用能力
                  </button>
                </div>
              </div>
            )}
            {detail && (
              <ActivityFeed
                detail={detail}
                owner={session.me.user.id}
                runs={runs}
                display={display || undefined}
                messageActions={messageActions}
                onReference={openReference}
                onApproval={decideApproval}
                onReviseApproval={reviseApproval}
                onReviseArtifact={reviseArtifact}
                onAnswer={answerQuestion}
                onContinue={continueRun}
                selectedTool={inspectorOpen ? selectedTool : null}
                onInspect={(key) => {
                  setSelectedTool(key);
                  closeFilePreview();
                  setStageOpen(false);
                  setInspectorConversation(conversationId);
                }}
              />
            )}
            <div className="amadeus-thinking-status" role="status">
              {thinking ? "正在思考…" : null}
            </div>
          </TranscriptViewport>
          <div className="amadeus-bottom">
            {error && (
              <div className="amadeus-error" role="alert">
                {error}
              </div>
            )}
            <div className="amadeus-composer-meta">
              <div className="amadeus-composer-status" role="status">
                {composerStatus}
              </div>
              <MessageSelection actions={messageActions} />
              <UsageIndicators
                key={conversationId}
                conversationId={conversationId}
                runs={runs}
                active={activeRun}
              />
            </div>
            <div className="amadeus-composer">
              <div className="amadeus-project-controls">
                <ProjectPicker
                  owner={session.me.user.id}
                  selected={projects}
                  onChange={setProjects}
                  disabled={busy}
                />
              </div>
              <ComposerAttachments
                input={fileInputRef}
                importing={importing}
                importFiles={importAttachments}
              />
              {references.length > 0 && (
                <div className="amadeus-pending-refs">
                  {references.map((item, index) => (
                    <AttachmentReference
                      key={referenceKey(item)}
                      reference={item}
                      conversationId={conversationId}
                      onOpen={openReference}
                      onRemove={() =>
                        setReferences((previous) =>
                          previous.filter((_, at) => at !== index),
                        )
                      }
                    />
                  ))}
                </div>
              )}
              <textarea
                aria-label="向 Amadeus 提问"
                placeholder={
                  standalone
                    ? "描述你想在工坊项目里完成的工作…"
                    : "描述你的想法，或引用工坊里的项目元素…"
                }
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onPaste={(event) => {
                  const files = clipboardAttachments(event.clipboardData);
                  if (!files.length) return;
                  event.preventDefault();
                  if (busy || importing) {
                    setError("请等当前任务或附件导入完成后再粘贴。");
                    return;
                  }
                  void importAttachments(files);
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="amadeus-toolbar">
                <ComposerTools
                  busy={busy || importing}
                  standalone={standalone}
                  atReferenceLimit={references.length >= referenceLimit}
                  mode={mode}
                  setMode={setMode}
                  loaded={loaded.length}
                  attachFile={() => fileInputRef.current?.click()}
                  showFiles={() => void showFiles()}
                  attachSelection={attachSelection}
                  pick={() => {
                    showAvatarState("listening");
                    void bridge
                      .setAmadeusPickMode(true, references.length + 1)
                      .then((started) => {
                        if (!started) showAvatarState("idle");
                      })
                      .catch(() => showAvatarState("idle"));
                  }}
                  openCapabilities={() => void openCapabilities()}
                />
                <ComposerModels controls={controller} />
              </div>
            </div>
          </div>
        </main>
        {filePreview && (
          <FileInspector file={filePreview} onClose={closeFilePreview} />
        )}
        {hasExecution && inspectorOpen && (
          <ExecutionInspector
            tools={display!.tools}
            selected={selectedTool}
            onSelect={setSelectedTool}
            onClose={() => setInspectorConversation(undefined)}
          />
        )}
        {stageOpen && !filePreview && (
          <aside className="amadeus-stage" aria-label="红莉栖数字人舞台">
            <div className="amadeus-stage-head">
              <strong>{appearance.name}</strong>
              <small>{avatarStateLabels[avatarState]}</small>
            </div>
            <div className="amadeus-stage-art">
              <AmadeusAvatar
                state={avatarState}
                sourceUrl={appearance.url}
                camera="stage"
              />
            </div>
          </aside>
        )}
      </div>
      <ConfirmDialog
        open={deleteItem !== null}
        title={`删除「${deleteItem?.title ?? ""}」？`}
        description={
          <>
            <p>这会同时删除本地消息与会话文件，删除后无法恢复。</p>
            {error && <p role="alert">{error}</p>}
          </>
        }
        confirmLabel="删除"
        pending={deleting}
        confirmDisabled={busy}
        onCancel={() => setDeleteItem(null)}
        onConfirm={async () => {
          if (!deleteItem || deleting || busy) return;
          setDeleting(true);
          setError("");
          try {
            await remove(deleteItem);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          } finally {
            setDeleting(false);
          }
        }}
      />
      {previewReference && (
        <div
          className="amadeus-reference-backdrop"
          role="presentation"
          onClick={() => setPreviewReference(null)}
        >
          <section
            className="amadeus-reference-detail"
            role="dialog"
            aria-label="引用详情"
            onClick={(event) => event.stopPropagation()}
          >
            <div>
              <strong>{previewReference.name}</strong>
              <button
                aria-label="关闭引用详情"
                onClick={() => setPreviewReference(null)}
              >
                <X size={16} />
              </button>
            </div>
            {previewReference.thumbnail && (
              <ResponsiveImage
                src={previewReference.thumbnail}
                alt={previewReference.name}
              />
            )}
            <p>
              {previewReference.application}
              {previewReference.value ? ` · ${previewReference.value}` : ""}
            </p>
            {(previewReference.windowId || previewReference.window_id) && (
              <button
                onClick={() => {
                  setPreviewReference(null);
                  void locateReference(previewReference);
                }}
              >
                定位来源
              </button>
            )}
          </section>
        </div>
      )}
      {capabilitiesOpen && (
        <CapabilityDialog
          selected={loaded}
          toolApis={toolApis}
          mcpServers={mcpServers}
          skills={skills}
          scriptAvailable={scriptAvailable}
          registeredOperations={registeredOperations}
          onClose={() => setCapabilitiesOpen(false)}
          onApply={(next) => {
            setLoaded(next);
            setCapabilitiesOpen(false);
          }}
        />
      )}
    </div>
  );
}
