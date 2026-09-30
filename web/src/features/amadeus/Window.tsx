import {
  History,
  Pin,
  PinOff,
  Plus,
  Search,
  X,
  Paperclip,
  FolderOpen,
  MousePointer2,
  Boxes,
  Send,
  Square,
  ChevronDown,
  ChevronUp,
  PanelRightOpen,
  PanelRightClose,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useRef, useState } from "react";
import type { AccountSessionContext } from "@features/accounts";
import { fetchApiJson } from "@platform/api/client";
import { avatarStateLabels } from "./protocol";
import { AmadeusAvatar } from "./Avatar";
import { ActivityFeed, ExecutionInspector } from "./ActivityFeed";
import { buildDisplayTimeline } from "./displayTimeline";
import { CapabilityDialog } from "./CapabilityDialog";
import { ContextPanel } from "./ContextPanel";
import { useAppearance } from "./useAppearance";
import { useAmadeusController } from "./useAmadeusController";

export function AmadeusWindow({ session }: { session: AccountSessionContext }) {
  const [stageOpen, setStageOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(() => window.innerWidth >= 700);
  const [inspectorOpen, setInspectorOpen] = useState(
    () => window.innerWidth >= 1120,
  );
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const wasWide = useRef(window.innerWidth >= 700);
  useEffect(() => {
    const onResize = () => {
      const wide = window.innerWidth >= 700;
      if (wide !== wasWide.current) {
        wasWide.current = wide;
        setRailOpen(wide);
      }
      if (window.innerWidth < 1120) setInspectorOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const historyRegionId = useId();
  const appearance = useAppearance(session);
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
    models,
    modelId,
    setModelId,
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
    modelPickerOpen,
    setModelPickerOpen,
    attachments,
    filesOpen,
    setFilesOpen,
    workFiles,
    filePreview,
    setFilePreview,
    scriptAvailable,
    registeredOperations,
    previewReference,
    setPreviewReference,
    avatarState,
    alwaysOnTop,
    setAlwaysOnTop,
    fileInputRef,
    showAvatarState,
    open,
    openCapabilities,
    decideApproval,
    reviseApproval,
    reviseArtifact,
    answerQuestion,
    continueRun,
    stop,
    create,
    rename,
    remove,
    importAttachment,
    showFiles,
    previewFile,
    downloadFile,
    send,
    scopedContexts,
    groups,
  } = useAmadeusController(session);
  const display = detail ? buildDisplayTimeline(detail, runs) : null;
  const hasExecution = !!display?.tools.length;
  return (
    <div className="amadeus-window">
      <header className="amadeus-header">
        <div className="amadeus-brand">
          <AmadeusAvatar
            state={avatarState}
            sourceUrl={appearance.url}
            camera="avatar"
          />
          <div>
            <strong>Amadeus</strong>
            <small>
              <span
                className={`amadeus-status-dot amadeus-status-${avatarState}`}
              />
              {avatarStateLabels[avatarState]} ·{" "}
              {saving ? "正在保存" : busy ? "正在生成" : "已保存到本机"}
            </small>
          </div>
        </div>
        <div className="amadeus-header-actions">
          {hasExecution && (
            <button
              title={inspectorOpen ? "收起执行详情" : "查看执行详情"}
              aria-label={inspectorOpen ? "收起执行详情" : "查看执行详情"}
              aria-pressed={inspectorOpen}
              onClick={() => {
                setInspectorOpen(!inspectorOpen);
                if (!inspectorOpen) setStageOpen(false);
              }}
            >
              {inspectorOpen ? (
                <PanelRightClose size={17} />
              ) : (
                <PanelRightOpen size={17} />
              )}
            </button>
          )}
          <button
            title={stageOpen ? "折叠数字人" : "展开数字人"}
            aria-label={stageOpen ? "折叠数字人" : "展开数字人"}
            aria-pressed={stageOpen}
            onClick={() => {
              const next = !stageOpen;
              setStageOpen(next);
              if (next) setInspectorOpen(false);
              void bridge
                .setAmadeusStageOpen?.(next)
                .catch(() => setStageOpen(!next));
            }}
          >
            {stageOpen ? (
              <PanelRightClose size={17} />
            ) : (
              <PanelRightOpen size={17} />
            )}
          </button>
          <button
            title={alwaysOnTop ? "取消悬浮置顶" : "保持悬浮在应用上方"}
            aria-label={alwaysOnTop ? "取消悬浮置顶" : "保持悬浮在应用上方"}
            aria-pressed={alwaysOnTop}
            onClick={() => {
              void bridge
                .setAmadeusAlwaysOnTop(!alwaysOnTop)
                .then((value) => setAlwaysOnTop(value));
            }}
          >
            {alwaysOnTop ? <Pin size={17} /> : <PinOff size={17} />}
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
          <button
            title="关闭窗口"
            aria-label="关闭窗口"
            onClick={() => void bridge.hideAmadeus()}
          >
            <X size={18} />
          </button>
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
                  placeholder="搜索本地对话"
                />
              </label>
              <div className="amadeus-history-list">
                {groups.map((group) => (
                  <section key={group.name}>
                    <h3>{group.name}</h3>
                    {group.items.map((item) => (
                      <div
                        className={`amadeus-history-row ${detail?.conversation.id === item.id ? "active" : ""}`}
                        key={item.id}
                      >
                        <button
                          className="amadeus-history-title"
                          onClick={() => void open(item.id)}
                        >
                          {item.title}
                        </button>
                        <button
                          title="重命名"
                          onClick={() => {
                            setRenameItem(item);
                            setRenameTitle(item.title);
                          }}
                        >
                          ⋯
                        </button>
                        <button
                          title={busy ? "请先停止当前任务" : "删除"}
                          disabled={busy}
                          onClick={() => setDeleteItem(item)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </section>
                ))}
                {renameItem && (
                  <form
                    className="amadeus-history-dialog"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void rename(renameItem, renameTitle);
                    }}
                  >
                    <strong>重命名对话</strong>
                    <input
                      autoFocus
                      value={renameTitle}
                      onChange={(event) => setRenameTitle(event.target.value)}
                    />
                    <div>
                      <button type="button" onClick={() => setRenameItem(null)}>
                        取消
                      </button>
                      <button type="submit">保存</button>
                    </div>
                  </form>
                )}
                {deleteItem && (
                  <div className="amadeus-history-dialog">
                    <strong>删除「{deleteItem.title}」？</strong>
                    <p>这会同时删除本地消息与会话文件。</p>
                    <div>
                      <button onClick={() => setDeleteItem(null)}>取消</button>
                      <button onClick={() => void remove(deleteItem)}>
                        删除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </aside>
        <main className="amadeus-chat">
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
                {detail && (
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
          <div className="amadeus-messages">
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
                  <button onClick={() => setDraft("解释一下我选中的对象")}>
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
                runs={runs}
                display={display || undefined}
                onReference={setPreviewReference}
                onApproval={decideApproval}
                onReviseApproval={reviseApproval}
                onReviseArtifact={reviseArtifact}
                onAnswer={answerQuestion}
                onContinue={continueRun}
                onInspect={(runId) => {
                  const selected = display?.tools.find(
                    (item) => item.runId === runId,
                  );
                  setSelectedTool(
                    selected ? `${selected.runId}:${selected.callId}` : null,
                  );
                  setStageOpen(false);
                  setInspectorOpen(true);
                }}
              />
            )}
          </div>
          <div className="amadeus-bottom">
            {error && (
              <div className="amadeus-error" role="alert">
                {error}
              </div>
            )}
            <div className="amadeus-composer">
              <input
                ref={fileInputRef}
                type="file"
                hidden
                multiple
                onChange={(event) => {
                  void Promise.all(
                    [...(event.target.files || [])].map(importAttachment),
                  );
                  event.target.value = "";
                }}
              />
              {attachments.length > 0 && (
                <div className="amadeus-attachments">
                  已导入：{attachments.map((item) => item.name).join("、")}
                </div>
              )}
              {references.length > 0 && (
                <div className="amadeus-pending-refs">
                  {references.map((item, index) => (
                    <div className="amadeus-ref" key={`${item.id}-${index}`}>
                      <button
                        className="amadeus-ref-content"
                        onClick={() => setPreviewReference(item)}
                      >
                        <span className="amadeus-ref-thumb">
                          {item.thumbnail ? (
                            <img src={item.thumbnail} alt="" />
                          ) : (
                            "▧"
                          )}
                        </span>
                        <span>
                          <strong>
                            {index + 1}. {item.name}
                          </strong>
                          <small>
                            {item.application}
                            {item.value ? ` · ${item.value}` : ""}
                          </small>
                        </span>
                      </button>
                      <button
                        title="移除引用"
                        onClick={() =>
                          setReferences(
                            references.filter((_, at) => at !== index),
                          )
                        }
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                aria-label="向 Amadeus 提问"
                placeholder="描述你的想法，或选取应用中的控件…"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="amadeus-toolbar">
                <button
                  title="导入会话文件"
                  aria-label="导入会话文件"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip size={17} />
                </button>
                <button
                  title="会话文件"
                  aria-label="会话文件"
                  onClick={() => void showFiles()}
                >
                  <FolderOpen size={17} />
                </button>
                <button
                  title="选取控件"
                  aria-label="选取控件"
                  onClick={() => {
                    showAvatarState("listening");
                    void bridge
                      .setAmadeusPickMode(true, references.length + 1)
                      .then((started) => {
                        if (!started) showAvatarState("idle");
                      })
                      .catch(() => showAvatarState("idle"));
                  }}
                >
                  <MousePointer2 size={17} />
                  <span>选取控件</span>
                </button>
                <button
                  title="能力"
                  aria-label="能力"
                  onClick={() => void openCapabilities()}
                >
                  <Boxes size={17} />
                  <span>能力 {loaded.length || ""}</span>
                </button>
                <div
                  className="amadeus-mode-switch"
                  role="group"
                  aria-label="运行模式"
                >
                  <button
                    type="button"
                    aria-pressed={mode === "agent"}
                    onClick={() => setMode("agent")}
                  >
                    Agent
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === "plan"}
                    onClick={() => setMode("plan")}
                  >
                    Plan
                  </button>
                </div>
                <div className="amadeus-spacer" />
                <div className="amadeus-model-control">
                  <button
                    aria-label="选择模型"
                    aria-expanded={modelPickerOpen}
                    onClick={() => setModelPickerOpen(!modelPickerOpen)}
                  >
                    {models.find((item) => item.id === modelId)?.label ||
                      "没有可用模型"}
                    <ChevronDown size={13} />
                  </button>
                  {modelPickerOpen && (
                    <div role="listbox" className="amadeus-model-list">
                      {models.map((item) => (
                        <button
                          role="option"
                          aria-selected={modelId === item.id}
                          key={item.id}
                          onClick={() => {
                            setModelId(item.id);
                            setModelPickerOpen(false);
                          }}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  className="amadeus-send"
                  title={busy ? "停止" : "发送"}
                  aria-label={busy ? "停止" : "发送"}
                  onClick={() => (busy ? stop() : void send())}
                >
                  {busy ? <Square size={16} /> : <Send size={16} />}
                </button>
              </div>
            </div>
          </div>
        </main>
        {hasExecution && inspectorOpen && (
          <ExecutionInspector
            tools={display!.tools}
            runs={runs}
            selected={selectedTool}
            onSelect={setSelectedTool}
            onClose={() => setInspectorOpen(false)}
          />
        )}
        {stageOpen && (
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
              <img
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
                onClick={() =>
                  void bridge
                    .locateAmadeusReference({
                      windowId:
                        previewReference.windowId || previewReference.window_id,
                      id: previewReference.id,
                    })
                    .then((found) => {
                      if (!found) setError("来源窗口已关闭");
                      else setPreviewReference(null);
                    })
                }
              >
                定位来源
              </button>
            )}
          </section>
        </div>
      )}
      {filePreview && (
        <div
          className="amadeus-reference-backdrop"
          role="presentation"
          onClick={() => setFilePreview(null)}
        >
          <section
            className="amadeus-reference-detail"
            role="dialog"
            aria-label="文件预览"
            onClick={(event) => event.stopPropagation()}
          >
            <div>
              <strong>{filePreview.name}</strong>
              <button
                aria-label="关闭文件预览"
                onClick={() => setFilePreview(null)}
              >
                <X size={16} />
              </button>
            </div>
            <pre>{filePreview.text}</pre>
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
