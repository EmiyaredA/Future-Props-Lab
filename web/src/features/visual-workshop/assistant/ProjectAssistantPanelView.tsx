import { LoadingScene } from "@shared/ui/LoadingScene";
import { LoadingState } from "@shared/ui/LoadingState";
import type { CSSProperties } from "react";
import {
  Check,
  History,
  MessageSquareText,
  Paperclip,
  PanelRightClose,
  Pencil,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import {
  AssistantAssetPreview,
  AssistantComposer,
} from "@features/visual-workshop/assistant/AssistantComposer";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS,
  attachmentSize,
  attachmentTypeLabel,
  normalizeComposerParts,
  textPart,
  toSelected,
} from "@features/visual-workshop/assistant/AssistantComposerModel";
import { AssistantMessageView } from "@features/visual-workshop/assistant/AssistantMessageView";
import { AssistantModelPicker } from "@features/visual-workshop/assistant/AssistantModelPicker";
import { useProjectAssistantController } from "@features/visual-workshop/assistant/useProjectAssistantController";

export function ProjectAssistantPanelView({
  controller,
}: {
  controller: ReturnType<typeof useProjectAssistantController>;
}) {
  const {
    projectId,
    open,
    onClose,
    fileInput,
    composerRef,
    scrollRef,
    abortRef,
    activeId,
    setActiveId,
    composerParts,
    setComposerParts,
    attachmentSearch,
    setAttachmentSearch,
    historyOpen,
    setHistoryOpen,
    modelPickerOpen,
    setModelPickerOpen,
    pickerOpen,
    setPickerOpen,
    editingTitle,
    setEditingTitle,
    streamingId,
    streamedContent,
    streamedActions,
    pendingApproval,
    approvalBusy,
    notice,
    setNotice,
    conversationToDelete,
    setConversationToDelete,
    deletingConversation,
    uploading,
    modelSaving,
    modelConfigError,
    setModelConfigError,
    width,
    listQuery,
    detailQuery,
    attachmentsQuery,
    modelsQuery,
    generationOptionsQuery,
    conversation,
    selectedAttachments,
    input,
    createMutation,
    run,
    resolveApproval,
    patchTitle,
    selectModel,
    removeConversation,
    insertAttachment,
    uploadAttachments,
    retry,
    startResize,
    messages,
  } = controller;
  return (
    <aside
      className={`project-assistant-panel${open ? " is-open" : ""}`}
      style={{ "--assistant-width": `${width}px` } as CSSProperties}
      aria-label="项目对话助手"
      aria-hidden={!open}
    >
      <div className="project-assistant-resize" onPointerDown={startResize} />
      <header className="project-assistant-header">
        {editingTitle && conversation ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void patchTitle(
                new FormData(event.currentTarget).get("title") as string,
              );
            }}
          >
            <input
              autoFocus
              name="title"
              maxLength={120}
              defaultValue={conversation.title}
              disabled={Boolean(streamingId)}
              onBlur={(event) => void patchTitle(event.currentTarget.value)}
            />
          </form>
        ) : (
          <button
            type="button"
            className="project-assistant-title"
            disabled={!conversation || Boolean(streamingId)}
            onClick={() => setEditingTitle(true)}
          >
            {conversation?.title || "AI 助手对话"}
            <Pencil aria-hidden />
          </button>
        )}
        <div>
          <button
            type="button"
            aria-label="选择模型"
            title={`选择模型 · ${conversation?.model_slug || "自动选择"}`}
            disabled={!conversation || Boolean(streamingId)}
            className={`project-assistant-model-trigger${
              modelPickerOpen ? " active" : ""
            }`}
            onClick={() => {
              setModelConfigError("");
              setModelPickerOpen(true);
            }}
          >
            <SlidersHorizontal aria-hidden />
          </button>
          <button
            type="button"
            aria-label="新建对话"
            title="新建对话"
            disabled={Boolean(streamingId) || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            <Plus aria-hidden />
          </button>
          <button
            type="button"
            aria-label="历史对话"
            title="历史对话"
            disabled={Boolean(streamingId)}
            className={historyOpen ? "active" : ""}
            onClick={() => setHistoryOpen((value) => !value)}
          >
            <History aria-hidden />
          </button>
          <button
            type="button"
            aria-label="收起对话"
            title="收起对话"
            onClick={() => {
              setModelPickerOpen(false);
              onClose();
            }}
          >
            <PanelRightClose aria-hidden />
          </button>
        </div>
      </header>

      {historyOpen ? (
        <div
          className="project-assistant-history"
          role="dialog"
          aria-label="历史对话"
        >
          <header>
            <strong>历史对话</strong>
            <span>{listQuery.data?.items.length ?? 0} 个</span>
          </header>
          <div>
            {listQuery.data?.items.map((item) => (
              <div
                className={item.id === activeId ? "active" : ""}
                key={item.id}
              >
                <button
                  type="button"
                  disabled={Boolean(streamingId)}
                  onClick={() => {
                    setActiveId(item.id);
                    setHistoryOpen(false);
                  }}
                >
                  <MessageSquareText aria-hidden />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.model_slug || "自动选择模型"}</small>
                  </span>
                  {item.id === activeId ? <Check aria-hidden /> : null}
                </button>
                <button
                  type="button"
                  aria-label={`删除对话 ${item.title}`}
                  disabled={Boolean(streamingId)}
                  onClick={() => setConversationToDelete(item)}
                >
                  <Trash2 aria-hidden />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="project-assistant-scroll" ref={scrollRef}>
        {detailQuery.isLoading || createMutation.isPending ? (
          <div className="project-assistant-loading">
            <LoadingState label="正在打开对话…" />
          </div>
        ) : messages.length ? (
          messages.map((message) => (
            <AssistantMessageView
              key={message.id}
              message={message}
              content={
                message.id === streamingId ? streamedContent : message.content
              }
              streaming={message.id === streamingId}
              actions={
                message.id === streamingId
                  ? streamedActions
                  : (message.actions ?? [])
              }
              pendingApproval={
                message.id === streamingId ? pendingApproval : undefined
              }
              approvalBusy={approvalBusy}
              onResolveApproval={(decision) => void resolveApproval(decision)}
              onRetry={() => retry(message)}
            />
          ))
        ) : (
          <div className="project-assistant-empty">
            <span className="project-assistant-orb">
              <Sparkles aria-hidden />
            </span>
            <h2>Hi，我是创作助手</h2>
            <p>我可以理解当前画布，帮你梳理创意、检查素材并给出下一步建议。</p>
            <div>
              {[
                "总结当前画布内容",
                "检查现有素材是否齐全",
                "为这个项目规划下一步",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() =>
                    setComposerParts((current) =>
                      normalizeComposerParts([
                        textPart(suggestion),
                        ...current.filter((part) => part.type === "asset"),
                      ]),
                    )
                  }
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {notice ? (
        <div className="project-assistant-notice" role="status">
          <span>{notice}</span>
          <button
            type="button"
            aria-label="关闭提示"
            onClick={() => setNotice("")}
          >
            <X aria-hidden />
          </button>
        </div>
      ) : null}

      <div className="project-assistant-composer">
        <AssistantComposer
          ref={composerRef}
          projectId={projectId}
          value={composerParts}
          disabled={!conversation || Boolean(streamingId)}
          maxAttachments={MAX_ATTACHMENTS}
          onChange={setComposerParts}
          onSubmit={() => void run()}
          onLimit={() => setNotice("每条消息最多添加 5 个附件")}
        />
        <div className="project-assistant-composer-actions">
          <div>
            <button
              type="button"
              aria-label="添加附件"
              title="添加附件"
              disabled={!conversation || Boolean(streamingId)}
              onClick={() => setPickerOpen((value) => !value)}
            >
              <Paperclip aria-hidden />
            </button>
            <input
              ref={fileInput}
              hidden
              multiple
              type="file"
              accept={ATTACHMENT_ACCEPT}
              onChange={(event) => void uploadAttachments(event.target.files)}
            />
          </div>
          <span>Enter 发送</span>
          {streamingId ? (
            <button
              type="button"
              className="project-assistant-send stop"
              aria-label="停止生成"
              onClick={() => abortRef.current?.abort()}
            >
              <Square aria-hidden fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              className="project-assistant-send"
              aria-label="发送"
              disabled={
                !conversation || (!input.trim() && !selectedAttachments.length)
              }
              onClick={() => void run()}
            >
              <Send aria-hidden />
            </button>
          )}
        </div>

        {pickerOpen ? (
          <div
            className="project-assistant-picker"
            role="dialog"
            aria-label="添加附件"
          >
            <header>
              <span>
                <strong>添加附件</strong>
                <small>
                  {selectedAttachments.length}/{MAX_ATTACHMENTS}
                </small>
              </span>
              <button
                type="button"
                className="project-assistant-upload"
                aria-label="上传文件"
                title="上传文件"
                disabled={
                  uploading || selectedAttachments.length >= MAX_ATTACHMENTS
                }
                onClick={() => fileInput.current?.click()}
              >
                {uploading ? <LoadingScene /> : <Upload aria-hidden />}
              </button>
              <button
                type="button"
                aria-label="关闭附件面板"
                onClick={() => setPickerOpen(false)}
              >
                <X aria-hidden />
              </button>
            </header>
            <label className="project-assistant-picker-search">
              <Search aria-hidden />
              <input
                type="search"
                placeholder="搜索项目素材"
                value={attachmentSearch}
                onChange={(event) => setAttachmentSearch(event.target.value)}
              />
            </label>
            <div className="project-assistant-picker-list">
              {attachmentsQuery.isLoading ? (
                <LoadingState
                  label="正在读取项目素材…"
                  variant="inline"
                  className="project-assistant-picker-empty"
                />
              ) : attachmentsQuery.data?.items.length ? (
                attachmentsQuery.data.items.map((file) => {
                  const attachment = toSelected(file);
                  const selected = selectedAttachments.some(
                    (item) => item.id === attachment.id,
                  );
                  return (
                    <button
                      key={file.id}
                      type="button"
                      className={selected ? "selected" : ""}
                      aria-pressed={selected}
                      disabled={
                        !selected &&
                        selectedAttachments.length >= MAX_ATTACHMENTS
                      }
                      onClick={() => insertAttachment(attachment)}
                    >
                      <span className="project-assistant-picker-preview">
                        <AssistantAssetPreview asset={attachment} />
                      </span>
                      <span>
                        <strong>{file.display_name}</strong>
                        <small>
                          {attachmentTypeLabel(attachment)} ·{" "}
                          {attachmentSize(file.byte_size)}
                        </small>
                      </span>
                      {selected ? <Check aria-hidden /> : null}
                    </button>
                  );
                })
              ) : (
                <span className="project-assistant-picker-empty">
                  {attachmentSearch
                    ? "没有匹配的项目素材"
                    : "项目中还没有可用素材"}
                </span>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {open && modelPickerOpen && conversation ? (
        <AssistantModelPicker
          textModels={modelsQuery.data?.items ?? []}
          generationOptions={generationOptionsQuery.data}
          conversation={conversation}
          loading={modelsQuery.isLoading || generationOptionsQuery.isLoading}
          saving={modelSaving}
          error={modelConfigError}
          onClose={() => setModelPickerOpen(false)}
          onSelect={(kind, modelId) => void selectModel(kind, modelId)}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(conversationToDelete)}
        title="删除助手对话"
        description={
          conversationToDelete
            ? `对话「${conversationToDelete.title}」及其中的全部消息将被永久删除。`
            : ""
        }
        confirmLabel="删除对话"
        pending={deletingConversation}
        onCancel={() => setConversationToDelete(undefined)}
        onConfirm={removeConversation}
      />
    </aside>
  );
}
