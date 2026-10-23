import { useEffect, useMemo, useRef, useState } from "react";
import "@features/models/models.css";
import { modelQueryKeys } from "@features/models/queryKeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Paperclip, Send, Square, Trash2, X } from "lucide-react";
import {
  createModelTestConversation,
  deleteModelTestAttachment,
  deleteModelTestConversation,
  getCatalog,
  getModelTestConversation,
  getModelTestConversations,
  patchModelTestConversation,
  streamModelTest,
  uploadModelTestAttachments,
  type ModelStreamEvent,
  type ModelTestConversation,
  type ModelTestConversationSummary,
  type ModelTestMessage,
} from "@features/models/api";
import type { SelectOption } from "@shared/ui/CustomSelect";
import { ModelTestCapabilityPanel } from "@features/models/conversation/ModelTestCapabilityPanel";
import { ModelTestToolWarnings } from "@features/models/conversation/ModelTestToolControls";
import {
  ModelTestWorkspaceHeader,
  type ModelTestMode,
} from "@features/models/workspace/ModelTestWorkspaceHeader";

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

import {
  AttachmentImage,
  EmptyChat,
  MessageCard,
} from "@features/models/conversation/ModelTestConversationView";
import { ModelTestConversationPanel } from "@features/models/conversation/ModelTestConversationPanel";
import { ModelTestSettingsPanel } from "@features/models/conversation/ModelTestSettingsPanel";
import { ModelTestDialogs } from "@features/models/conversation/ModelTestDialogs";
import { errorPresentation } from "@features/models/conversation/modelTestPresentation";
import {
  availableCatalogModels,
  preferredChatModel,
  preferredModeModel,
  useInitialCatalogModel,
} from "./catalogTestSelection";
export function ModelTestPage({
  onOpenAudioAnnotation = () => undefined,
  initialModelId,
  onInitialModelHandled,
}: {
  onOpenAudioAnnotation?: (projectId: string) => void;
  initialModelId?: string | null;
  onInitialModelHandled?: () => void;
}) {
  const queryClient = useQueryClient();
  const catalogQuery = useQuery({
    queryKey: modelQueryKeys.catalog,
    queryFn: getCatalog,
  });
  const conversationsQuery = useQuery({
    queryKey: modelQueryKeys.conversations,
    queryFn: getModelTestConversations,
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [streamedContent, setStreamedContent] = useState("");
  const [stoppedPreview, setStoppedPreview] = useState<{
    messageId: string;
    content: string;
  } | null>(null);
  const [conversationSearch, setConversationSearch] = useState("");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const [conversationToDelete, setConversationToDelete] =
    useState<ModelTestConversationSummary | null>(null);
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [removingAttachmentId, setRemovingAttachmentId] = useState<
    string | null
  >(null);
  const [mobilePanel, setMobilePanel] = useState<
    "conversations" | "settings" | null
  >(null);
  const [generationModelId, setGenerationModelId] = useState<string | null>(
    null,
  );
  const lastGenerationModelByMode = useRef<
    Partial<
      Record<
        "image" | "video" | "speech" | "synthesis" | "realtime_voice",
        string
      >
    >
  >({});
  const abortRef = useRef<AbortController | null>(null);
  const activeMessageIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const autoCreated = useRef(Boolean(initialModelId));

  const availableModels = useMemo(
    () => availableCatalogModels(catalogQuery.data),
    [catalogQuery.data],
  );
  const textModels = useMemo(
    () =>
      availableModels.filter(
        (model) =>
          ["openai", "deepseek", "anthropic"].includes(model.providerKind) &&
          model.capabilities.includes("chat"),
      ),
    [availableModels],
  );
  const createMutation = useMutation({
    mutationFn: (modelId?: string) =>
      createModelTestConversation(
        modelId ?? preferredChatModel(catalogQuery.data, textModels),
      ),
    onSuccess: async (conversation) => {
      queryClient.setQueryData(
        modelQueryKeys.conversation(conversation.id),
        conversation,
      );
      queryClient.setQueryData<
        Awaited<ReturnType<typeof getModelTestConversations>>
      >(modelQueryKeys.conversations, (current) => ({
        items: [
          conversation,
          ...(current?.items ?? []).filter(
            (item) => item.id !== conversation.id,
          ),
        ],
      }));
      setActiveId(conversation.id);
      setInput("");
      setError("");
      setConversationSearch("");
      setMobilePanel(null);
      await queryClient.invalidateQueries({
        queryKey: modelQueryKeys.conversations,
      });
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
  });

  useInitialCatalogModel({
    modelId: initialModelId,
    catalog: catalogQuery.data,
    onChat: createMutation.mutate,
    onOther: setGenerationModelId,
    onError: setError,
    onHandled: onInitialModelHandled,
  });
  useEffect(() => {
    const items = conversationsQuery.data?.items;
    if (!items) return;
    if (
      items.length &&
      (!activeId || !items.some((item) => item.id === activeId))
    ) {
      setActiveId(items[0].id);
    } else if (
      !items.length &&
      textModels.length &&
      !autoCreated.current &&
      !createMutation.isPending
    ) {
      autoCreated.current = true;
      createMutation.mutate(undefined);
    }
  }, [
    activeId,
    conversationsQuery.data?.items,
    createMutation,
    textModels.length,
  ]);

  const detailQuery = useQuery({
    queryKey: modelQueryKeys.conversation(activeId),
    queryFn: () => getModelTestConversation(activeId as string),
    enabled: Boolean(activeId),
  });
  const conversation = detailQuery.data;
  const conversationTools = conversation?.tools ?? [];
  const draftAttachments = conversation?.draft_attachments ?? [];
  const selectedModel = textModels.find(
    (model) => model.value === conversation?.model_id,
  );
  const selectedModelSupportsVision = Boolean(
    selectedModel?.capabilities.includes("vision"),
  );
  const selectedModelSupportsTools = Boolean(
    selectedModel?.capabilities.includes("tools"),
  );

  useEffect(() => {
    setAttachmentPreview(null);
    setUploadingAttachments(false);
    setRemovingAttachmentId(null);
    setStoppedPreview(null);
  }, [activeId]);

  useEffect(() => {
    if (!conversation || !stoppedPreview) return;
    const stoppedMessage = conversation.messages.find(
      (message) => message.id === stoppedPreview.messageId,
    );
    if (stoppedMessage && stoppedMessage.status !== "pending") {
      setStoppedPreview(null);
    }
  }, [conversation, stoppedPreview]);

  useEffect(() => {
    requestAnimationFrame(() => {
      const scroll = chatScrollRef.current;
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    });
  }, [activeId, conversation?.messages, streamedContent]);

  const updateLocal = (next: ModelTestConversation) => {
    queryClient.setQueryData(modelQueryKeys.conversation(next.id), next);
    void queryClient.invalidateQueries({
      queryKey: modelQueryKeys.conversations,
    });
  };
  const patch = async (
    changes: Partial<
      Pick<
        ModelTestConversation,
        "title" | "model_id" | "system_prompt" | "temperature" | "max_tokens"
      >
    > & { tool_ids?: string[] },
  ) => {
    if (!conversation || streamingId) return;
    setError("");
    try {
      updateLocal(
        await patchModelTestConversation(
          conversation.id,
          conversation.revision,
          changes,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await detailQuery.refetch();
    }
  };

  const remove = async () => {
    if (
      !conversationToDelete ||
      streamingId ||
      uploadingAttachments ||
      deletingConversation
    )
      return;
    setDeletingConversation(true);
    try {
      await deleteModelTestConversation(
        conversationToDelete.id,
        conversationToDelete.revision,
      );
      setConversationToDelete(null);
      queryClient.setQueryData<
        Awaited<ReturnType<typeof getModelTestConversations>>
      >(modelQueryKeys.conversations, (current) => ({
        items: (current?.items ?? []).filter(
          (item) => item.id !== conversationToDelete.id,
        ),
      }));
      if (activeId === conversationToDelete.id) {
        setActiveId(null);
        autoCreated.current = false;
      }
      await conversationsQuery.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeletingConversation(false);
    }
  };

  const uploadAttachments = async (files: FileList | null) => {
    if (!conversation || !files?.length || streamingId) return;
    const selected = Array.from(files);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!selectedModelSupportsVision) {
      setError("当前模型不支持图片，请先选择支持 vision 的模型。");
      return;
    }
    if (draftAttachments.length + selected.length > MAX_ATTACHMENTS) {
      setError("每条消息最多上传 5 张图片。");
      return;
    }
    const invalidType = selected.find(
      (file) => file.type && !ACCEPTED_IMAGE_TYPES.has(file.type),
    );
    if (invalidType) {
      setError(`不支持图片「${invalidType.name}」的格式。`);
      return;
    }
    const oversized = selected.find((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (oversized) {
      setError(`图片「${oversized.name}」超过 8 MiB。`);
      return;
    }
    setError("");
    setUploadingAttachments(true);
    try {
      await uploadModelTestAttachments(conversation.id, selected);
      await detailQuery.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploadingAttachments(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeDraftAttachment = async (attachmentId: string) => {
    if (!conversation || streamingId || uploadingAttachments) return;
    setError("");
    setRemovingAttachmentId(attachmentId);
    try {
      await deleteModelTestAttachment(conversation.id, attachmentId);
      await detailQuery.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRemovingAttachmentId(null);
    }
  };

  const run = async (regenerate: boolean) => {
    const attachmentIds = draftAttachments.map((attachment) => attachment.id);
    if (
      !conversation ||
      streamingId ||
      uploadingAttachments ||
      (!regenerate && !input.trim() && !attachmentIds.length)
    )
      return;
    if (!regenerate && attachmentIds.length && !selectedModelSupportsVision) {
      setError("当前模型不支持图片，请先选择支持 vision 的模型。");
      return;
    }
    setError("");
    setStreamedContent("");
    setStoppedPreview(null);
    setStreamingId("starting");
    activeMessageIdRef.current = null;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamModelTest(
        conversation.id,
        {
          expected_revision: conversation.revision,
          ...(regenerate
            ? {}
            : { content: input.trim(), attachment_ids: attachmentIds }),
        },
        regenerate,
        controller.signal,
        (event: ModelStreamEvent) => {
          if (event.type === "start") {
            const assistantMessageId = String(
              event.payload.assistant_message_id,
            );
            activeMessageIdRef.current = assistantMessageId;
            setStreamingId(assistantMessageId);
            if (!regenerate) setInput("");
            void detailQuery.refetch();
          } else if (event.type === "delta") {
            setStreamedContent(
              (current) => current + String(event.payload.text || ""),
            );
          } else if (event.type === "step") {
            void detailQuery.refetch();
          } else if (event.type === "error") {
            const raw = String(event.payload.message || "模型调用失败");
            const friendly = errorPresentation(raw);
            setError(`${friendly.title}：${friendly.message}`);
          }
        },
      );
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        const raw = cause instanceof Error ? cause.message : String(cause);
        const friendly = errorPresentation(raw);
        setError(`${friendly.title}：${friendly.message}`);
      }
    } finally {
      abortRef.current = null;
      activeMessageIdRef.current = null;
      setStreamingId(null);
      setStreamedContent("");
      await Promise.all([
        detailQuery.refetch(),
        queryClient.invalidateQueries({
          queryKey: modelQueryKeys.conversations,
        }),
        queryClient.invalidateQueries({ queryKey: modelQueryKeys.logs }),
      ]);
    }
  };

  const stopGeneration = () => {
    const messageId = activeMessageIdRef.current;
    if (messageId) {
      setStoppedPreview({ messageId, content: streamedContent });
    }
    abortRef.current?.abort();
  };

  const visibleMessages = (conversation?.messages ?? []).filter(
    (message) => message.status !== "superseded",
  );
  const completedAssistantTurns = new Set(
    (conversation?.messages ?? [])
      .filter(
        (message) =>
          message.role === "assistant" && message.status === "completed",
      )
      .map((message) => message.turn_id),
  );
  const hasCompletedImageContext = (conversation?.messages ?? []).some(
    (message) =>
      message.role === "user" &&
      completedAssistantTurns.has(message.turn_id) &&
      Boolean(message.attachments?.length),
  );
  const modelOptions: SelectOption[] = textModels.length
    ? textModels.map((model) => {
        const supportsVision = model.capabilities.includes("vision");
        return {
          value: model.value,
          label: model.label,
          description: `${model.description}${supportsVision ? " · 支持图片" : ""}`,
          disabled: hasCompletedImageContext && !supportsVision,
        };
      })
    : [{ value: "", label: "暂无可用模型", disabled: true }];
  const lastAssistantId = [...visibleMessages]
    .reverse()
    .find((message) => message.role === "assistant")?.id;
  const selectedModelAvailable = textModels.some(
    (model) => model.value === conversation?.model_id,
  );
  const canSend =
    selectedModelAvailable &&
    !uploadingAttachments &&
    Boolean(input.trim() || draftAttachments.length) &&
    (!draftAttachments.length || selectedModelSupportsVision);
  const toolsCompatible =
    !conversationTools.length ||
    (selectedModelSupportsTools &&
      conversationTools.every((tool) => tool.enabled));
  const conversationItems = conversationsQuery.data?.items ?? [];
  const generationModel = availableModels.find(
    (model) => model.value === generationModelId,
  );
  const availableModes: Record<ModelTestMode, boolean> = {
    synthesis: availableModels.some((model) =>
      model.capabilities.includes("speech_synthesis"),
    ),
    chat: Boolean(textModels.length),
    image: availableModels.some(
      (model) => model.providerKind === "senseaudio_image",
    ),
    video: availableModels.some((model) =>
      ["senseaudio_video", "zealman_video", "volcengine_video"].includes(
        model.providerKind,
      ),
    ),
    speech: availableModels.some(
      (model) =>
        ["openai", "senseaudio_asr", "senseaudio_asr_pro"].includes(
          model.providerKind,
        ) && model.capabilities.includes("speech_recognition"),
    ),
    realtime_voice: availableModels.some((model) =>
      model.capabilities.includes("voice"),
    ),
  };
  const selectMode = (mode: ModelTestMode) => {
    if (mode === "chat") {
      setGenerationModelId(null);
      return;
    }
    const next = preferredModeModel(
      availableModels,
      mode,
      lastGenerationModelByMode.current[mode],
      catalogQuery.data?.default_model_ids,
    );
    if (!next) return;
    lastGenerationModelByMode.current[mode] = next.value;
    setGenerationModelId(next.value);
  };
  if (generationModel) {
    return (
      <ModelTestCapabilityPanel
        models={availableModels}
        modelId={generationModel.value}
        onOpenAudioAnnotation={onOpenAudioAnnotation}
        onSelectMode={selectMode}
        onSelectModel={(modelId, mode) => {
          lastGenerationModelByMode.current[mode] = modelId;
          setGenerationModelId(modelId);
        }}
      />
    );
  }

  return (
    <section className="model-test-page">
      <ModelTestWorkspaceHeader
        activeMode="chat"
        availableModes={availableModes}
        onSelectMode={selectMode}
        modelId={conversation?.model_id ?? textModels[0]?.value ?? ""}
        modelOptions={modelOptions}
        modelDisabled={Boolean(streamingId) || uploadingAttachments}
        onSelectModel={(model_id) => {
          if (conversation) void patch({ model_id });
          else createMutation.mutate(model_id);
        }}
        actions={
          <div className="mobile-panel-actions">
            <button
              className="btn"
              onClick={() => setMobilePanel("conversations")}
            >
              对话
            </button>
            <button className="btn" onClick={() => setMobilePanel("settings")}>
              参数
            </button>
          </div>
        }
      />
      {error ? (
        <div className="inline-alert danger playground-alert" role="alert">
          {error}
          <button aria-label="关闭提示" onClick={() => setError("")}>
            <X aria-hidden />
          </button>
        </div>
      ) : null}
      <div className="playground-grid">
        <ModelTestConversationPanel
          open={mobilePanel === "conversations"}
          items={conversationItems}
          activeId={activeId}
          search={conversationSearch}
          creating={createMutation.isPending}
          disabled={Boolean(streamingId) || uploadingAttachments}
          onSearch={setConversationSearch}
          onCreate={() => createMutation.mutate(undefined)}
          onSelect={(id) => {
            setActiveId(id);
            setMobilePanel(null);
          }}
          onDelete={(item) => {
            setError("");
            setConversationToDelete(item);
          }}
          onClose={() => setMobilePanel(null)}
        />

        <main className="chat-panel">
          {conversation ? (
            <>
              <div className="chat-titlebar">
                <div className="chat-title-copy">
                  <input
                    key={`${conversation.id}-${conversation.title}`}
                    defaultValue={conversation.title}
                    aria-label="对话标题"
                    disabled={Boolean(streamingId)}
                    onBlur={(event) => {
                      const title = event.target.value.trim();
                      if (title && title !== conversation.title)
                        void patch({ title });
                    }}
                  />
                  {conversation.model_slug ? (
                    <span
                      className="chat-model-name"
                      title={conversation.model_slug}
                    >
                      当前模型 · {conversation.model_slug}
                    </span>
                  ) : null}
                </div>
                <button
                  className="chat-delete-button"
                  aria-label="删除当前对话"
                  disabled={Boolean(streamingId) || uploadingAttachments}
                  onClick={() => {
                    setError("");
                    setConversationToDelete(conversation);
                  }}
                >
                  <Trash2 aria-hidden />
                </button>
              </div>
              <div className="chat-scroll" ref={chatScrollRef}>
                {visibleMessages.length ? (
                  visibleMessages.map((message) => {
                    const locallyStopped =
                      stoppedPreview?.messageId === message.id &&
                      message.status === "pending";
                    const displayMessage: ModelTestMessage = locallyStopped
                      ? {
                          ...message,
                          status: "cancelled",
                          error_message: null,
                        }
                      : message;
                    return (
                      <MessageCard
                        key={message.id}
                        conversationId={conversation.id}
                        message={displayMessage}
                        contentOverride={
                          message.id === streamingId
                            ? streamedContent
                            : locallyStopped
                              ? stoppedPreview.content
                              : undefined
                        }
                        isLastAssistant={message.id === lastAssistantId}
                        generating={Boolean(streamingId)}
                        onRegenerate={() => void run(true)}
                        onShowError={setErrorDetail}
                        onPreviewAttachment={(url, name) =>
                          setAttachmentPreview({ url, name })
                        }
                      />
                    );
                  })
                ) : (
                  <EmptyChat />
                )}
              </div>
              <div className="composer-wrap">
                {!selectedModelAvailable ? (
                  <p className="model-warning">
                    当前模型不可用，请在右侧重新选择已启用的文本模型。
                  </p>
                ) : null}
                {selectedModelAvailable &&
                (draftAttachments.length || hasCompletedImageContext) &&
                !selectedModelSupportsVision ? (
                  <p className="model-warning">
                    当前对话包含图片，请选择支持 vision 的模型。
                  </p>
                ) : null}
                <ModelTestToolWarnings
                  selected={conversationTools}
                  supported={selectedModelSupportsTools}
                />
                <div className="composer">
                  {draftAttachments.length || uploadingAttachments ? (
                    <div
                      className="composer-attachments"
                      aria-label="待发送图片"
                    >
                      {draftAttachments.map((attachment) => (
                        <div className="draft-attachment" key={attachment.id}>
                          <AttachmentImage
                            conversationId={conversation.id}
                            attachment={attachment}
                            onOpen={(url, name) =>
                              setAttachmentPreview({ url, name })
                            }
                          />
                          <button
                            type="button"
                            className="remove-attachment"
                            aria-label={`移除图片 ${attachment.original_filename}`}
                            disabled={
                              Boolean(streamingId) ||
                              removingAttachmentId === attachment.id
                            }
                            onClick={() =>
                              void removeDraftAttachment(attachment.id)
                            }
                          >
                            {removingAttachmentId === attachment.id ? (
                              <LoaderCircle aria-hidden />
                            ) : (
                              <X aria-hidden />
                            )}
                          </button>
                        </div>
                      ))}
                      {uploadingAttachments ? (
                        <div className="attachment-uploading" role="status">
                          <LoaderCircle aria-hidden /> 上传中
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void run(false);
                      }
                    }}
                    disabled={Boolean(streamingId) || uploadingAttachments}
                    placeholder="输入要测试的问题"
                    rows={3}
                  />
                  <button
                    type="button"
                    className="attachment-button"
                    aria-label="添加图片"
                    title={
                      selectedModelSupportsVision
                        ? "添加图片"
                        : "当前模型不支持图片"
                    }
                    disabled={
                      Boolean(streamingId) ||
                      uploadingAttachments ||
                      !selectedModelAvailable ||
                      !selectedModelSupportsVision ||
                      draftAttachments.length >= MAX_ATTACHMENTS
                    }
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploadingAttachments ? (
                      <LoaderCircle aria-hidden />
                    ) : (
                      <Paperclip aria-hidden />
                    )}
                  </button>
                  <input
                    ref={fileInputRef}
                    hidden
                    multiple
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={(event) =>
                      void uploadAttachments(event.target.files)
                    }
                  />
                  <span className="composer-hint">
                    Enter 发送 · Shift + Enter 换行
                  </span>
                  {streamingId ? (
                    <button
                      className="send-button stop"
                      aria-label="停止生成"
                      onClick={stopGeneration}
                    >
                      <Square aria-hidden fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      className="send-button"
                      aria-label="发送"
                      disabled={!canSend || !toolsCompatible}
                      onClick={() => void run(false)}
                    >
                      <Send aria-hidden />
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <EmptyChat />
          )}
        </main>

        <ModelTestSettingsPanel
          open={mobilePanel === "settings"}
          conversation={conversation}
          tools={conversationTools}
          toolsSupported={selectedModelSupportsTools}
          disabled={Boolean(streamingId)}
          onPatch={patch}
          onClose={() => setMobilePanel(null)}
        />
      </div>
      <ModelTestDialogs
        error={errorDetail}
        attachment={attachmentPreview}
        deleteTarget={conversationToDelete}
        deleting={deletingConversation}
        deleteError={error}
        onCloseError={() => setErrorDetail(null)}
        onCloseAttachment={() => setAttachmentPreview(null)}
        onCancelDelete={() => setConversationToDelete(null)}
        onDelete={remove}
      />
    </section>
  );
}
