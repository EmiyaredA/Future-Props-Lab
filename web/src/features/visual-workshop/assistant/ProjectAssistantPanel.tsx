import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  History,
  LoaderCircle,
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
import {
  fileQueryKeys,
  getFiles,
  invalidateFileScope,
  uploadManagedFile,
} from "@features/files";
import {
  createVisualAssistantConversation,
  deleteVisualAssistantConversation,
  getGenerationOptions,
  getVisualAssistantConversation,
  getVisualAssistantConversations,
  getVisualAssistantModels,
  patchVisualAssistantConversation,
  resolveVisualAssistantApproval,
  streamVisualAssistant,
  type VisualAssistantAction,
  type VisualAssistantConversation,
  type VisualAssistantConversationSummary,
  type VisualAssistantMessage,
} from "@features/visual-workshop/api";
import { ApiError } from "@platform/api/client";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import {
  AssistantAssetPreview,
  AssistantComposer,
} from "@features/visual-workshop/assistant/AssistantComposer";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  attachmentSize,
  attachmentTypeLabel,
  composerContentParts,
  composerText,
  isImage,
  normalizeComposerParts,
  partsFromMessage,
  textPart,
  toSelected,
  uniqueComposerAttachments,
  uploadIsSupported,
  type AssistantComposerHandle,
  type ComposerPart,
  type SelectedAttachment,
} from "@features/visual-workshop/assistant/AssistantComposerModel";
import {
  AssistantMessageView,
  type PendingApproval,
} from "@features/visual-workshop/assistant/AssistantMessageView";
import {
  AssistantModelPicker,
  type AgentModelKind,
} from "@features/visual-workshop/assistant/AssistantModelPicker";

const PANEL_WIDTH_KEY = "fpl_visual_assistant_panel_width";

type ConversationDeleteTarget = Pick<
  VisualAssistantConversation,
  "id" | "title" | "revision"
>;

export function ProjectAssistantPanel({
  projectId,
  open,
  onClose,
  prepareCanvas,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  prepareCanvas: () => Promise<number>;
}) {
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const composerRef = useRef<AssistantComposerHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoCreated = useRef(false);
  const [activeId, setActiveId] = useState<string>();
  const [composerParts, setComposerParts] = useState<ComposerPart[]>(() => [
    textPart(),
  ]);
  const [attachmentSearch, setAttachmentSearch] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [streamingId, setStreamingId] = useState<string>();
  const [streamedContent, setStreamedContent] = useState("");
  const [streamedActions, setStreamedActions] = useState<
    VisualAssistantAction[]
  >([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval>();
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [conversationToDelete, setConversationToDelete] =
    useState<ConversationDeleteTarget>();
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelConfigError, setModelConfigError] = useState("");
  const [width, setWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
    return Number.isFinite(stored) && stored >= 360 && stored <= 620
      ? stored
      : 418;
  });

  const listQuery = useQuery({
    queryKey: ["visual-assistant-conversations", projectId],
    queryFn: () => getVisualAssistantConversations(projectId),
    enabled: open,
  });
  const detailQuery = useQuery({
    queryKey: ["visual-assistant-conversation", projectId, activeId],
    queryFn: () =>
      getVisualAssistantConversation(projectId, activeId as string),
    enabled: open && Boolean(activeId),
  });
  const attachmentsQuery = useQuery({
    queryKey: fileQueryKeys.list({
      projectId,
      query: attachmentSearch,
      sort: "updated",
      includeReferences: true,
    }),
    queryFn: () =>
      getFiles({
        projectId,
        query: attachmentSearch.trim() || undefined,
        includeReferences: true,
        sort: "updated",
      }),
    enabled: open && pickerOpen,
  });
  const modelsQuery = useQuery({
    queryKey: ["visual-assistant-models", projectId],
    queryFn: () => getVisualAssistantModels(projectId),
    enabled: open && modelPickerOpen,
  });
  const generationOptionsQuery = useQuery({
    queryKey: ["visual-generation-options"],
    queryFn: getGenerationOptions,
    enabled: open && modelPickerOpen,
  });
  const conversation = detailQuery.data;
  const selectedAttachments = useMemo(
    () => uniqueComposerAttachments(composerParts),
    [composerParts],
  );
  const input = useMemo(() => composerText(composerParts), [composerParts]);

  const createMutation = useMutation({
    mutationFn: () => createVisualAssistantConversation(projectId),
    onSuccess: (created) => {
      client.setQueryData(
        ["visual-assistant-conversation", projectId, created.id],
        created,
      );
      client.setQueryData<{ items: VisualAssistantConversationSummary[] }>(
        ["visual-assistant-conversations", projectId],
        (current) => ({
          items: [
            created,
            ...(current?.items.filter((item) => item.id !== created.id) ?? []),
          ],
        }),
      );
      setActiveId(created.id);
      setComposerParts([textPart()]);
      setHistoryOpen(false);
      setModelPickerOpen(false);
      setPickerOpen(false);
      setEditingTitle(false);
      setNotice("");
      void listQuery.refetch();
    },
    onError: (error) =>
      setNotice(error instanceof Error ? error.message : "无法创建对话"),
  });

  useEffect(() => {
    if (!open || !listQuery.data) return;
    const items = listQuery.data.items;
    if (
      items.length &&
      (!activeId || !items.some((item) => item.id === activeId))
    ) {
      setActiveId(items[0].id);
    } else if (
      !items.length &&
      !autoCreated.current &&
      !createMutation.isPending
    ) {
      autoCreated.current = true;
      createMutation.mutate();
    }
  }, [activeId, createMutation, listQuery.data, open]);

  useEffect(() => {
    autoCreated.current = false;
    setActiveId(undefined);
    setComposerParts([textPart()]);
    setAttachmentSearch("");
    setPickerOpen(false);
    setModelPickerOpen(false);
    setPendingApproval(undefined);
    setStreamedActions([]);
    setConversationToDelete(undefined);
    setNotice("");
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      if (scrollRef.current)
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  }, [conversation?.messages, open, streamedContent]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const refreshConversation = async () => {
    await detailQuery.refetch();
    await listQuery.refetch();
  };

  const run = async () => {
    if (
      !conversation ||
      streamingId ||
      (!input.trim() && !selectedAttachments.length)
    )
      return;
    const controller = new AbortController();
    abortRef.current = controller;
    setNotice("");
    setStreamedContent("");
    setStreamedActions([]);
    setPendingApproval(undefined);
    let startedId = "";
    let currentRunId = "";
    try {
      const canvasRevision = await prepareCanvas();
      await streamVisualAssistant(
        projectId,
        conversation.id,
        {
          expected_revision: conversation.revision,
          canvas_revision: canvasRevision,
          content_parts: composerContentParts(composerParts),
        },
        controller.signal,
        (event) => {
          if (event.type === "start") {
            currentRunId = String(event.payload.run_id || "");
            startedId = String(event.payload.assistant_message_id || "");
            setStreamingId(startedId);
            setComposerParts([textPart()]);
            setPickerOpen(false);
            const attachmentWarnings = Array.isArray(
              event.payload.attachment_warnings,
            )
              ? event.payload.attachment_warnings.map(String)
              : [];
            const notices: string[] = [];
            if (event.payload.model_changed_from) {
              notices.push(
                `原模型不可用，已切换为 ${String(event.payload.model)}`,
              );
            }
            notices.push(...attachmentWarnings);
            if (event.payload.agent_mode === "advice") {
              notices.push("当前模型不支持工具调用，本轮将以只读建议模式回复");
            }
            if (notices.length) setNotice(notices.join("；"));
            void detailQuery.refetch();
          } else if (event.type === "delta") {
            setStreamedContent(
              (current) => current + String(event.payload.text || ""),
            );
          } else if (event.type === "step") {
            setStreamedActions(
              (event.payload.actions as VisualAssistantAction[] | undefined) ??
                [],
            );
          } else if (event.type === "approval_required") {
            setPendingApproval({
              runId: currentRunId,
              approvalId: String(event.payload.approval_id || ""),
              canvasRevision: Number(event.payload.canvas_revision || 0),
            });
          } else if (event.type === "approval_resolved") {
            setPendingApproval(undefined);
            setApprovalBusy(false);
          } else if (event.type === "canvas_updated") {
            const revision = Number(event.payload.canvas_revision);
            const nodes = event.payload.nodes;
            if (Number.isFinite(revision) && Array.isArray(nodes)) {
              client.setQueryData(
                ["visual-workshop-canvas", projectId],
                (current: unknown) =>
                  current && typeof current === "object"
                    ? {
                        ...current,
                        revision,
                        nodes,
                        updated_at: new Date().toISOString(),
                      }
                    : current,
              );
            }
          } else if (event.type === "generation_task_created") {
            void client.invalidateQueries({
              queryKey: ["visual-generation-tasks"],
            });
          } else if (event.type === "error") {
            setNotice(String(event.payload.message || "模型调用失败"));
          }
        },
      );
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        if (error instanceof ApiError && error.status === 409)
          void detailQuery.refetch();
        setNotice(error instanceof Error ? error.message : "对话请求失败");
      }
    } finally {
      abortRef.current = null;
      setStreamingId(undefined);
      setStreamedContent("");
      setStreamedActions([]);
      setPendingApproval(undefined);
      setApprovalBusy(false);
      if (startedId) await refreshConversation();
    }
  };

  const resolveApproval = async (decision: "approve" | "reject") => {
    if (!conversation || !pendingApproval || approvalBusy) return;
    setApprovalBusy(true);
    setNotice("");
    try {
      const canvasRevision = await prepareCanvas();
      await resolveVisualAssistantApproval(
        projectId,
        conversation.id,
        pendingApproval.runId,
        pendingApproval.approvalId,
        decision,
        canvasRevision,
      );
      setNotice(
        decision === "approve" ? "已确认，Agent 正在执行" : "已拒绝本次操作",
      );
    } catch (error) {
      setApprovalBusy(false);
      setNotice(error instanceof Error ? error.message : "处理确认请求失败");
    }
  };

  const patchTitle = async (title: string) => {
    if (
      !conversation ||
      streamingId ||
      !title.trim() ||
      title.trim() === conversation.title
    ) {
      setEditingTitle(false);
      return;
    }
    try {
      const updated = await patchVisualAssistantConversation(
        projectId,
        conversation.id,
        conversation.revision,
        { title: title.trim() },
      );
      client.setQueryData(
        ["visual-assistant-conversation", projectId, conversation.id],
        updated,
      );
      await listQuery.refetch();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "重命名失败");
      await detailQuery.refetch();
    } finally {
      setEditingTitle(false);
    }
  };

  const selectModel = async (kind: AgentModelKind, modelId: string | null) => {
    if (!conversation || streamingId) return;
    const currentModelId =
      kind === "text"
        ? conversation.model_id
        : kind === "image"
          ? conversation.image_model_id
          : conversation.video_model_id;
    if (modelId === currentModelId) return;
    const field =
      kind === "text"
        ? "model_id"
        : kind === "image"
          ? "image_model_id"
          : "video_model_id";
    setModelSaving(true);
    setModelConfigError("");
    try {
      const updated = await patchVisualAssistantConversation(
        projectId,
        conversation.id,
        conversation.revision,
        { [field]: modelId },
      );
      client.setQueryData(
        ["visual-assistant-conversation", projectId, conversation.id],
        updated,
      );
      await listQuery.refetch();
    } catch (error) {
      setModelConfigError(
        error instanceof Error ? error.message : "保存模型配置失败",
      );
      await detailQuery.refetch();
    } finally {
      setModelSaving(false);
    }
  };

  const removeConversation = async () => {
    if (!conversationToDelete || streamingId) return;
    setDeletingConversation(true);
    try {
      await deleteVisualAssistantConversation(
        projectId,
        conversationToDelete.id,
        conversationToDelete.revision,
      );
      setConversationToDelete(undefined);
      setActiveId(undefined);
      autoCreated.current = false;
      await listQuery.refetch();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除对话失败");
    } finally {
      setDeletingConversation(false);
    }
  };

  const insertAttachment = (attachment: SelectedAttachment) => {
    if (
      !selectedAttachments.some((current) => current.id === attachment.id) &&
      selectedAttachments.length >= MAX_ATTACHMENTS
    ) {
      setNotice("每条消息最多添加 5 个附件");
      return;
    }
    if (isImage(attachment) && attachment.byte_size > MAX_IMAGE_BYTES) {
      setNotice("图片附件不能超过 8MB");
      return;
    }
    composerRef.current?.insertAssets([attachment]);
  };

  const uploadAttachments = async (files: FileList | null) => {
    if (!files?.length) return;
    const candidates = Array.from(files);
    if (fileInput.current) fileInput.current.value = "";
    if (selectedAttachments.length + candidates.length > MAX_ATTACHMENTS) {
      setNotice("每条消息最多添加 5 个附件");
      return;
    }
    const invalid = candidates.find(
      (file) =>
        !uploadIsSupported(file) ||
        (file.type.startsWith("image/") && file.size > MAX_IMAGE_BYTES),
    );
    if (invalid) {
      setNotice(`「${invalid.name}」类型不受支持，或图片超过 8MB`);
      return;
    }
    setUploading(true);
    try {
      const uploaded: SelectedAttachment[] = [];
      for (const file of candidates) {
        uploaded.push(toSelected(await uploadManagedFile(file, projectId)));
      }
      composerRef.current?.insertAssets(uploaded);
      await invalidateFileScope(client, projectId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "附件上传失败");
    } finally {
      setUploading(false);
    }
  };

  const retry = (message: VisualAssistantMessage) => {
    const user = conversation?.messages?.find(
      (candidate) =>
        candidate.turn_id === message.turn_id && candidate.role === "user",
    );
    if (!user) return;
    setComposerParts(partsFromMessage(user));
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.innerWidth <= 700) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const move = (pointer: PointerEvent) => {
      setWidth(
        Math.min(620, Math.max(360, startWidth + startX - pointer.clientX)),
      );
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  useEffect(() => {
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(width));
  }, [width]);

  const messages = conversation?.messages ?? [];
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
            <LoaderCircle aria-hidden /> 正在打开对话…
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
                {uploading ? (
                  <LoaderCircle className="spinning" aria-hidden />
                ) : (
                  <Upload aria-hidden />
                )}
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
                <span className="project-assistant-picker-empty">
                  正在读取项目素材…
                </span>
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
