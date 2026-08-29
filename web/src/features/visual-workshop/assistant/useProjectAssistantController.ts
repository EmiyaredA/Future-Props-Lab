import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fileQueryKeys,
  getFiles,
  invalidateFileScope,
  uploadManagedFile,
} from "@features/files";
import { visualWorkshopQueryKeys as visualKeys } from "@features/visual-workshop/queryKeys";
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
import {
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  composerContentParts,
  composerText,
  isImage,
  partsFromMessage,
  textPart,
  toSelected,
  uniqueComposerAttachments,
  uploadIsSupported,
  type AssistantComposerHandle,
  type ComposerPart,
  type SelectedAttachment,
} from "@features/visual-workshop/assistant/AssistantComposerModel";
import type { PendingApproval } from "@features/visual-workshop/assistant/AssistantMessageView";
import type { AgentModelKind } from "@features/visual-workshop/assistant/AssistantModelPicker";
import type { ProjectAssistantPanelProps } from "@features/visual-workshop/assistant/projectAssistantTypes";

const PANEL_WIDTH_KEY = "fpl_visual_assistant_panel_width";
type ConversationDeleteTarget = Pick<
  VisualAssistantConversation,
  "id" | "title" | "revision"
>;

export function useProjectAssistantController({
  projectId,
  open,
  prepareCanvas,
  onClose,
}: ProjectAssistantPanelProps) {
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
    queryKey: visualKeys.assistantConversations(projectId),
    queryFn: () => getVisualAssistantConversations(projectId),
    enabled: open,
  });
  const detailQuery = useQuery({
    queryKey: visualKeys.assistantConversation(projectId, activeId),
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
    queryKey: visualKeys.assistantModels(projectId),
    queryFn: () => getVisualAssistantModels(projectId),
    enabled: open && modelPickerOpen,
  });
  const generationOptionsQuery = useQuery({
    queryKey: visualKeys.generationOptions,
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
        visualKeys.assistantConversation(projectId, created.id),
        created,
      );
      client.setQueryData<{ items: VisualAssistantConversationSummary[] }>(
        visualKeys.assistantConversations(projectId),
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
                visualKeys.canvas(projectId),
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
              queryKey: visualKeys.generationTasks,
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
        visualKeys.assistantConversation(projectId, conversation.id),
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
        visualKeys.assistantConversation(projectId, conversation.id),
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

  return {
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
  };
}
