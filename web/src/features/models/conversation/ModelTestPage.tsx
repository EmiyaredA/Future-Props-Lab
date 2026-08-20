import {
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import "@features/models/models.css";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  CircleAlert,
  Code2,
  Copy,
  Info,
  Image as ImageIcon,
  LoaderCircle,
  MessageSquareText,
  Paperclip,
  Plus,
  RotateCcw,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
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
  type ModelTestAttachment,
  type ModelTestConversation,
  type ModelTestMessage,
} from "@features/models/api";
import { fetchApiBlob } from "@platform/api/client";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import type { SelectOption } from "@shared/ui/CustomSelect";
import { ModelGenerationTestPanel } from "@features/models/generation/ModelGenerationTestPanel";
import { ModelTranscriptionTestPanel } from "@features/models/generation/ModelTranscriptionTestPanel";
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

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<{ children?: ReactNode }>(node))
    return extractText(node.props.children);
  return "";
}

function languageLabel(language?: string) {
  if (!language) return "Code";
  const labels: Record<string, string> = {
    bash: "Bash",
    css: "CSS",
    html: "HTML",
    javascript: "JavaScript",
    js: "JavaScript",
    json: "JSON",
    python: "Python",
    py: "Python",
    shell: "Shell",
    sql: "SQL",
    ts: "TypeScript",
    typescript: "TypeScript",
  };
  return labels[language.toLowerCase()] || language;
}

function MarkdownCodeBlock({ children }: ComponentPropsWithoutRef<"pre">) {
  const code = isValidElement<{
    className?: string;
    children?: ReactNode;
  }>(children)
    ? children
    : null;
  const language = code?.props.className?.match(/language-([^\s]+)/)?.[1];
  const source = extractText(code?.props.children).replace(/\n$/, "");
  return (
    <div className="markdown-code-block">
      <div className="markdown-code-head">
        <span>
          <Code2 aria-hidden /> {languageLabel(language)}
        </span>
        <button
          type="button"
          aria-label="复制代码"
          onClick={() => void navigator.clipboard.writeText(source)}
        >
          <Copy aria-hidden />
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function errorPresentation(raw: string) {
  if (/401|unauthori[sz]ed|invalid.{0,12}(api|key)|authentication/i.test(raw)) {
    return {
      code: "401 Unauthorized",
      title: "认证失败",
      message: "请检查 API Key 或网关地址后重新生成。",
    };
  }
  if (/timeout|timed out|超时/i.test(raw)) {
    return {
      code: "请求超时",
      title: "模型响应超时",
      message: "请稍后重试，或适当降低最大输出 Token。",
    };
  }
  return {
    code: "调用失败",
    title: "模型调用失败",
    message: "请检查供应商配置和模型状态后重试。",
  };
}

function formatConversationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function EmptyChat() {
  return (
    <div className="playground-empty">
      <span className="playground-empty-icon">
        <Sparkles aria-hidden />
      </span>
      <h2>开始一次模型测试</h2>
      <p>选择一个已启用的模型，输入问题或上传图片后即可查看流式回复效果。</p>
    </div>
  );
}

function AttachmentImage({
  conversationId,
  attachment,
  onOpen,
}: {
  conversationId: string;
  attachment: ModelTestAttachment;
  onOpen: (url: string, name: string) => void;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    void fetchApiBlob(
      `/v1/model-test/conversations/${encodeURIComponent(conversationId)}` +
        `/attachments/${encodeURIComponent(attachment.id)}/content`,
    )
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id, conversationId]);
  return (
    <button
      type="button"
      className="attachment-image"
      aria-label={`查看图片 ${attachment.original_filename}`}
      disabled={!url}
      onClick={() => url && onOpen(url, attachment.original_filename)}
    >
      {url ? (
        <img src={url} alt={attachment.original_filename} />
      ) : (
        <ImageIcon aria-hidden />
      )}
    </button>
  );
}

function MessageCard({
  conversationId,
  message,
  contentOverride,
  isLastAssistant,
  generating,
  onRegenerate,
  onShowError,
  onPreviewAttachment,
}: {
  conversationId: string;
  message: ModelTestMessage;
  contentOverride?: string;
  isLastAssistant: boolean;
  generating: boolean;
  onRegenerate: () => void;
  onShowError: (error: string) => void;
  onPreviewAttachment: (url: string, name: string) => void;
}) {
  const content = contentOverride ?? message.content;
  const statusLabel = {
    pending: "",
    completed: "",
    error: "生成失败",
    cancelled: "",
    superseded: "已替换",
  }[message.status];
  const replyStatus =
    message.role === "assistant" && message.status === "pending"
      ? { label: "正在回复", tone: "active" }
      : message.role === "assistant" && message.status === "cancelled"
        ? { label: "已停止", tone: "interrupt" }
        : null;
  const errorInfo =
    message.status === "error" && message.error_message
      ? errorPresentation(message.error_message)
      : null;
  return (
    <article className={`chat-message ${message.role} ${message.status}`}>
      <div className="chat-avatar">
        {message.role === "user" ? (
          <UserRound aria-hidden />
        ) : (
          <Bot aria-hidden />
        )}
      </div>
      <div className="chat-message-body">
        <div className="chat-message-meta">
          <strong>{message.role === "user" ? "你" : "模型回复"}</strong>
          {message.model_slug ? <span>{message.model_slug}</span> : null}
          {statusLabel ? <em>{statusLabel}</em> : null}
        </div>
        {message.attachments?.length ? (
          <div className="message-attachments">
            {message.attachments.map((attachment) => (
              <AttachmentImage
                key={attachment.id}
                conversationId={conversationId}
                attachment={attachment}
                onOpen={onPreviewAttachment}
              />
            ))}
          </div>
        ) : null}
        {message.role === "assistant" ? (
          content ? (
            <div className="markdown-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{ pre: MarkdownCodeBlock }}
              >
                {content}
              </ReactMarkdown>
              {message.status === "pending" ? (
                <i className="stream-caret" />
              ) : null}
            </div>
          ) : message.status === "pending" ? (
            <div className="typing-indicator" aria-label="正在生成">
              <i />
              <i />
              <i />
            </div>
          ) : null
        ) : content ? (
          <p className="user-copy">{content}</p>
        ) : null}
        {replyStatus ? (
          <div className="reply-status-row" role="status" aria-live="polite">
            <span className={`reply-status-pill ${replyStatus.tone}`}>
              {replyStatus.tone === "active" ? (
                <i className="reply-status-dot" aria-hidden />
              ) : null}
              {replyStatus.label}
            </span>
          </div>
        ) : null}
        {errorInfo && message.error_message ? (
          <div className="model-error-card" role="alert">
            <div className="model-error-icon">
              <CircleAlert aria-hidden />
            </div>
            <div className="model-error-copy">
              <div>
                <strong>{errorInfo.title}</strong>
                <span>{errorInfo.code}</span>
              </div>
              <p>{errorInfo.message}</p>
              <div className="model-error-actions">
                <button
                  type="button"
                  onClick={() => onShowError(message.error_message as string)}
                >
                  查看详情
                </button>
                {isLastAssistant ? (
                  <button
                    type="button"
                    disabled={generating}
                    onClick={onRegenerate}
                  >
                    重新生成
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
        {message.role === "assistant" && content ? (
          <div className="message-actions">
            <button
              type="button"
              aria-label="复制原始输出"
              title="复制原始输出"
              onClick={() => void navigator.clipboard.writeText(content)}
            >
              <Copy aria-hidden />
            </button>
            {isLastAssistant && !errorInfo ? (
              <button
                type="button"
                aria-label="重新生成"
                title="重新生成"
                disabled={generating}
                onClick={onRegenerate}
              >
                <RotateCcw aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function ModelTestPage({
  onOpenAudioAnnotation = () => undefined,
}: {
  onOpenAudioAnnotation?: (projectId: string) => void;
}) {
  const queryClient = useQueryClient();
  const catalogQuery = useQuery({
    queryKey: ["model-catalog"],
    queryFn: getCatalog,
  });
  const conversationsQuery = useQuery({
    queryKey: ["model-test-conversations"],
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
    useState<ModelTestConversation | null>(null);
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [removingAttachmentId, setRemovingAttachmentId] = useState<
    string | null
  >(null);
  const [temperatureDraft, setTemperatureDraft] = useState(0.7);
  const [mobilePanel, setMobilePanel] = useState<
    "conversations" | "settings" | null
  >(null);
  const [generationModelId, setGenerationModelId] = useState<string | null>(
    null,
  );
  const lastGenerationModelByMode = useRef<
    Partial<Record<"image" | "video" | "speech", string>>
  >({});
  const abortRef = useRef<AbortController | null>(null);
  const activeMessageIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoCreated = useRef(false);

  const availableModels = useMemo(
    () =>
      (catalogQuery.data?.providers ?? []).flatMap((provider) =>
        provider.enabled
          ? provider.models
              .filter((model) => model.enabled)
              .map((model) => ({
                value: model.id,
                label: model.label || model.slug,
                description: `${provider.name} · ${model.slug}`,
                capabilities: Array.from(
                  new Set([...model.capabilities, ...model.categories]),
                ),
                providerKind: provider.kind,
              }))
          : [],
      ),
    [catalogQuery.data],
  );
  const textModels = useMemo(
    () =>
      availableModels.filter(
        (model) =>
          ["openai", "anthropic"].includes(model.providerKind) &&
          model.capabilities.includes("chat"),
      ),
    [availableModels],
  );
  const createMutation = useMutation({
    mutationFn: (modelId?: string) =>
      createModelTestConversation(modelId ?? textModels[0]?.value),
    onSuccess: async (conversation) => {
      queryClient.setQueryData(
        ["model-test-conversation", conversation.id],
        conversation,
      );
      queryClient.setQueryData<
        Awaited<ReturnType<typeof getModelTestConversations>>
      >(["model-test-conversations"], (current) => ({
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
        queryKey: ["model-test-conversations"],
      });
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
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
    queryKey: ["model-test-conversation", activeId],
    queryFn: () => getModelTestConversation(activeId as string),
    enabled: Boolean(activeId),
  });
  const conversation = detailQuery.data;
  const draftAttachments = conversation?.draft_attachments ?? [];
  const selectedModel = textModels.find(
    (model) => model.value === conversation?.model_id,
  );
  const selectedModelSupportsVision = Boolean(
    selectedModel?.capabilities.includes("vision"),
  );

  useEffect(() => {
    if (conversation && !streamingId)
      setTemperatureDraft(conversation.temperature);
  }, [conversation, streamingId]);

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

  const updateLocal = (next: ModelTestConversation) => {
    queryClient.setQueryData(["model-test-conversation", next.id], next);
    void queryClient.invalidateQueries({
      queryKey: ["model-test-conversations"],
    });
  };
  const patch = async (
    changes: Partial<
      Pick<
        ModelTestConversation,
        "title" | "model_id" | "system_prompt" | "temperature" | "max_tokens"
      >
    >,
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
    if (!conversationToDelete || streamingId) return;
    setDeletingConversation(true);
    try {
      await deleteModelTestConversation(
        conversationToDelete.id,
        conversationToDelete.revision,
      );
      setConversationToDelete(null);
      setActiveId(null);
      autoCreated.current = false;
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
          queryKey: ["model-test-conversations"],
        }),
        queryClient.invalidateQueries({ queryKey: ["model-logs"] }),
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
  const conversationItems = conversationsQuery.data?.items ?? [];
  const normalizedSearch = conversationSearch.trim().toLowerCase();
  const filteredConversations = normalizedSearch
    ? conversationItems.filter((item) =>
        `${item.title} ${item.model_slug || ""}`
          .toLowerCase()
          .includes(normalizedSearch),
      )
    : conversationItems;

  const generationModel = availableModels.find(
    (model) => model.value === generationModelId,
  );
  const availableModes: Record<ModelTestMode, boolean> = {
    chat: Boolean(textModels.length),
    image: availableModels.some(
      (model) => model.providerKind === "senseaudio_image",
    ),
    video: availableModels.some(
      (model) => model.providerKind === "senseaudio_video",
    ),
    speech: availableModels.some(
      (model) =>
        ["openai", "senseaudio_asr"].includes(model.providerKind) &&
        model.capabilities.includes("speech_recognition"),
    ),
  };
  const selectMode = (mode: ModelTestMode) => {
    if (mode === "chat") {
      setGenerationModelId(null);
      return;
    }
    const candidates = availableModels.filter((model) =>
      mode === "speech"
        ? ["openai", "senseaudio_asr"].includes(model.providerKind) &&
          model.capabilities.includes("speech_recognition")
        : model.providerKind ===
          (mode === "image" ? "senseaudio_image" : "senseaudio_video"),
    );
    const remembered = lastGenerationModelByMode.current[mode];
    const next =
      candidates.find((model) => model.value === remembered) ?? candidates[0];
    if (!next) return;
    lastGenerationModelByMode.current[mode] = next.value;
    setGenerationModelId(next.value);
  };
  if (
    generationModel &&
    ["openai", "senseaudio_asr"].includes(generationModel.providerKind) &&
    generationModel.capabilities.includes("speech_recognition")
  ) {
    return (
      <ModelTranscriptionTestPanel
        models={availableModels}
        modelId={generationModel.value}
        onOpenAudioAnnotation={onOpenAudioAnnotation}
        onSelectMode={selectMode}
        onSelectModel={(modelId) => {
          const next = availableModels.find(
            (model) =>
              model.value === modelId &&
              ["openai", "senseaudio_asr"].includes(model.providerKind) &&
              model.capabilities.includes("speech_recognition"),
          );
          if (!next) return;
          lastGenerationModelByMode.current.speech = next.value;
          setGenerationModelId(next.value);
        }}
      />
    );
  }
  if (
    generationModel &&
    ["senseaudio_image", "senseaudio_video"].includes(
      generationModel.providerKind,
    )
  ) {
    return (
      <ModelGenerationTestPanel
        models={availableModels}
        modelId={generationModel.value}
        onSelectMode={selectMode}
        onSelectModel={(modelId) => {
          const next = availableModels.find((model) => model.value === modelId);
          if (!next) return;
          if (
            ["senseaudio_image", "senseaudio_video"].includes(next.providerKind)
          ) {
            const mode =
              next.providerKind === "senseaudio_image" ? "image" : "video";
            lastGenerationModelByMode.current[mode] = next.value;
            setGenerationModelId(next.value);
          }
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
        <aside
          className={`conversation-panel${mobilePanel === "conversations" ? " mobile-open" : ""}`}
        >
          <div className="panel-heading">
            <strong>历史对话</strong>
          </div>
          <div className="conversation-tools">
            <button
              type="button"
              className="new-conversation-button"
              disabled={
                createMutation.isPending ||
                Boolean(streamingId) ||
                uploadingAttachments
              }
              onClick={() => createMutation.mutate(undefined)}
            >
              <Plus aria-hidden /> 新建对话
            </button>
            <label className="conversation-search">
              <Search aria-hidden />
              <input
                value={conversationSearch}
                onChange={(event) => setConversationSearch(event.target.value)}
                placeholder="搜索对话"
                aria-label="搜索对话"
              />
            </label>
          </div>
          <div className="conversation-list">
            {filteredConversations.map((item) => (
              <button
                className={item.id === activeId ? "active" : ""}
                key={item.id}
                onClick={() => {
                  setActiveId(item.id);
                  setMobilePanel(null);
                }}
              >
                <span className="conversation-item-icon">
                  <MessageSquareText aria-hidden />
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    <span>{item.model_slug || "未选择模型"}</span>
                    <time>{formatConversationTime(item.updated_at)}</time>
                  </small>
                </span>
              </button>
            ))}
            {!filteredConversations.length && normalizedSearch ? (
              <p className="conversation-empty">没有匹配的对话</p>
            ) : null}
          </div>
          <div className="conversation-count">
            共 {conversationItems.length} 个对话
          </div>
          <button
            className="mobile-panel-close"
            onClick={() => setMobilePanel(null)}
          >
            收起
          </button>
        </aside>

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
                  onClick={() => setConversationToDelete(conversation)}
                >
                  <Trash2 aria-hidden />
                </button>
              </div>
              <div className="chat-scroll">
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
                      disabled={!canSend}
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

        <aside
          className={`settings-panel${mobilePanel === "settings" ? " mobile-open" : ""}`}
        >
          <div className="panel-heading settings-heading">
            <div className="settings-heading-copy">
              <span>
                <SlidersHorizontal aria-hidden />
                <strong>测试参数</strong>
              </span>
              <small>调整当前会话的生成方式</small>
            </div>
          </div>
          {conversation ? (
            <div className="settings-form">
              <label className="parameter-field">
                <span className="parameter-label">
                  系统提示词 <em className="optional-badge">可选</em>
                </span>
                <textarea
                  key={`${conversation.id}-system-${conversation.revision}`}
                  defaultValue={conversation.system_prompt}
                  rows={7}
                  disabled={Boolean(streamingId)}
                  placeholder="可选，用于定义模型角色和回答要求"
                  onBlur={(event) => {
                    if (event.target.value !== conversation.system_prompt)
                      void patch({ system_prompt: event.target.value });
                  }}
                />
              </label>
              <label className="parameter-field temperature-field">
                <span className="parameter-label">
                  Temperature
                  <output className="temperature-value">
                    {temperatureDraft.toFixed(1)}
                  </output>
                </span>
                <div className="temperature-control">
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={temperatureDraft}
                    disabled={Boolean(streamingId)}
                    style={
                      {
                        "--range-progress": `${(temperatureDraft / 2) * 100}%`,
                      } as CSSProperties
                    }
                    onChange={(event) =>
                      setTemperatureDraft(Number(event.target.value))
                    }
                    onPointerUp={(event) => {
                      const value = Number(event.currentTarget.value);
                      if (value !== conversation.temperature)
                        void patch({ temperature: value });
                    }}
                    onKeyUp={(event) => {
                      const value = Number(event.currentTarget.value);
                      if (value !== conversation.temperature)
                        void patch({ temperature: value });
                    }}
                  />
                  <div className="range-scale" aria-hidden="true">
                    <span>精确</span>
                    <span>平衡</span>
                    <span>创意</span>
                  </div>
                </div>
                <small className="parameter-help">
                  较低的值更稳定，较高的值更有创造性。
                </small>
              </label>
              <label className="parameter-field">
                <span className="parameter-label">最大输出</span>
                <div className="token-input">
                  <input
                    type="number"
                    min="1"
                    max="8192"
                    key={`${conversation.id}-tokens-${conversation.max_tokens}`}
                    defaultValue={conversation.max_tokens}
                    disabled={Boolean(streamingId)}
                    onBlur={(event) => {
                      const value = Math.min(
                        8192,
                        Math.max(1, Number(event.target.value)),
                      );
                      if (value !== conversation.max_tokens)
                        void patch({ max_tokens: value });
                    }}
                  />
                  <span>Token</span>
                </div>
              </label>
              <div className="parameter-note">
                <Info aria-hidden />
                <div>
                  <strong>上下文策略</strong>
                  <p>
                    仅已成功完成的轮次及其图片会进入下一次请求；失败或停止的回复只保留展示。
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="reset-parameters"
                disabled={Boolean(streamingId)}
                onClick={() => {
                  setTemperatureDraft(0.7);
                  void patch({
                    system_prompt: "",
                    temperature: 0.7,
                    max_tokens: 1024,
                  });
                }}
              >
                <RotateCcw aria-hidden /> 恢复默认参数
              </button>
            </div>
          ) : null}
          <button
            className="mobile-panel-close"
            onClick={() => setMobilePanel(null)}
          >
            收起
          </button>
        </aside>
      </div>
      {errorDetail ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setErrorDetail(null);
          }}
        >
          <div
            className="modal-card error-detail-modal"
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">调用错误</span>
                <h2>错误详情</h2>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="关闭错误详情"
                onClick={() => setErrorDetail(null)}
              >
                <X aria-hidden />
              </button>
            </div>
            <pre>{errorDetail}</pre>
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => void navigator.clipboard.writeText(errorDetail)}
              >
                复制完整错误
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => setErrorDetail(null)}
              >
                完成
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {attachmentPreview ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              setAttachmentPreview(null);
          }}
        >
          <div
            className="modal-card attachment-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`图片预览 ${attachmentPreview.name}`}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">图片附件</span>
                <h2>{attachmentPreview.name}</h2>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="关闭图片预览"
                onClick={() => setAttachmentPreview(null)}
              >
                <X aria-hidden />
              </button>
            </div>
            <div className="attachment-preview-stage">
              <img src={attachmentPreview.url} alt={attachmentPreview.name} />
            </div>
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(conversationToDelete)}
        title="删除测试对话"
        description={
          conversationToDelete
            ? `对话「${conversationToDelete.title}」及其中的全部消息将被永久删除。`
            : ""
        }
        confirmLabel="删除对话"
        pending={deletingConversation}
        onCancel={() => setConversationToDelete(null)}
        onConfirm={remove}
      />
    </section>
  );
}
