import {
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentPropsWithoutRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  Eye,
  History,
  ImagePlus,
  LoaderCircle,
  MessageSquareText,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Sparkle,
  Sparkles,
  Square,
  Trash2,
  Upload,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getFiles,
  uploadManagedFile,
  type ManagedFile,
} from "@features/files/api";
import {
  createVisualAssistantConversation,
  deleteVisualAssistantConversation,
  getVisualAssistantConversation,
  getVisualAssistantConversations,
  getVisualAssistantModels,
  patchVisualAssistantConversation,
  streamVisualAssistant,
  type VisualAssistantAsset,
  type VisualAssistantConversation,
  type VisualAssistantMessage,
  type VisualAssistantModelOption,
} from "@features/visual-workshop/api";
import { ApiError, fetchApiBlob } from "@platform/api/client";

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const PANEL_WIDTH_KEY = "fpl_visual_assistant_panel_width";
const ACCEPTED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

type SelectedImage = Pick<
  VisualAssistantAsset,
  "id" | "display_name" | "mime_type" | "byte_size"
>;

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<{ children?: ReactNode }>(node))
    return extractText(node.props.children);
  return "";
}

function AssistantCodeBlock({ children }: ComponentPropsWithoutRef<"pre">) {
  const source = extractText(children).replace(/\n$/, "");
  return (
    <div className="assistant-code-block">
      <button
        type="button"
        aria-label="复制代码"
        onClick={() => void navigator.clipboard.writeText(source)}
      >
        <Copy aria-hidden />
      </button>
      <pre>{children}</pre>
    </div>
  );
}

function AssetPreview({ asset }: { asset: SelectedImage }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    void fetchApiBlob(`/v1/files/${encodeURIComponent(asset.id)}/content`)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset.id]);
  return url ? (
    <img src={url} alt={asset.display_name} />
  ) : (
    <ImagePlus aria-hidden />
  );
}

function ModelPickerModal({
  models,
  currentModelId,
  loading,
  saving,
  onClose,
  onSelect,
}: {
  models: VisualAssistantModelOption[];
  currentModelId: string | null;
  loading: boolean;
  saving: boolean;
  onClose: () => void;
  onSelect: (modelId: string | null) => void;
}) {
  const currentProviderId = models.find(
    (model) => model.id === currentModelId,
  )?.provider_id;
  const [providerId, setProviderId] = useState(currentProviderId ?? "");
  const providers = useMemo(
    () =>
      Array.from(
        models.reduce((result, model) => {
          const existing = result.get(model.provider_id);
          if (existing) existing.count += 1;
          else
            result.set(model.provider_id, {
              id: model.provider_id,
              name: model.provider_name,
              count: 1,
            });
          return result;
        }, new Map<string, { id: string; name: string; count: number }>()),
      ).map(([, provider]) => provider),
    [models],
  );

  useEffect(() => {
    if (!providers.length) return;
    if (!providers.some((provider) => provider.id === providerId)) {
      setProviderId(currentProviderId ?? providers[0].id);
    }
  }, [currentProviderId, providerId, providers]);

  const visibleModels = models.filter(
    (model) => model.provider_id === providerId,
  );
  return createPortal(
    <div
      className="assistant-model-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className="assistant-model-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="选择对话模型"
      >
        <header>
          <div className="assistant-model-heading">
            <span className="assistant-model-heading-icon">
              <Sparkles aria-hidden />
            </span>
            <div>
              <h2>选择对话模型</h2>
              <p>为当前对话指定模型，附图时请选择带“视觉”标记的模型。</p>
            </div>
          </div>
          <button type="button" aria-label="关闭模型选择" onClick={onClose}>
            <X aria-hidden />
          </button>
        </header>
        <div className="assistant-model-browser">
          <nav aria-label="模型供应商">
            {providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className={provider.id === providerId ? "active" : ""}
                onClick={() => setProviderId(provider.id)}
              >
                <span>
                  <i aria-hidden>{provider.name.slice(0, 1).toUpperCase()}</i>
                  <b>{provider.name}</b>
                </span>
                <small>{provider.count}</small>
              </button>
            ))}
          </nav>
          <div className="assistant-model-list">
            {loading ? (
              <div className="assistant-model-state">
                <LoaderCircle className="spinning" aria-hidden /> 正在读取模型…
              </div>
            ) : visibleModels.length ? (
              visibleModels.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  className={model.id === currentModelId ? "selected" : ""}
                  disabled={saving}
                  onClick={() => onSelect(model.id)}
                >
                  <span>
                    <strong>{model.label}</strong>
                    {model.id === currentModelId ? (
                      <i className="assistant-model-selected">
                        <Check aria-hidden />
                      </i>
                    ) : null}
                  </span>
                  <code>{model.slug}</code>
                  {model.description ? <p>{model.description}</p> : null}
                  <footer>
                    <em>
                      <MessageSquareText aria-hidden /> 对话
                    </em>
                    {model.capabilities.includes("vision") ? (
                      <em className="vision">
                        <Eye aria-hidden /> 视觉
                      </em>
                    ) : null}
                    {model.capabilities.includes("tools") ? (
                      <em>
                        <Wrench aria-hidden /> 工具
                      </em>
                    ) : null}
                  </footer>
                </button>
              ))
            ) : (
              <div className="assistant-model-state">没有可用的对话模型</div>
            )}
          </div>
        </div>
        <footer>
          <span>
            当前生效：
            <strong>
              {models.find((model) => model.id === currentModelId)?.label ||
                "自动选择"}
            </strong>
          </span>
          <button
            type="button"
            disabled={saving || currentModelId === null}
            onClick={() => onSelect(null)}
          >
            恢复自动选择
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function MessageView({
  message,
  content,
  streaming,
  onRetry,
}: {
  message: VisualAssistantMessage;
  content: string;
  streaming: boolean;
  onRetry: () => void;
}) {
  return (
    <article
      className={`project-assistant-message ${message.role} ${message.status}`}
    >
      <span className="project-assistant-avatar">
        {message.role === "user" ? (
          <UserRound aria-hidden />
        ) : (
          <Bot aria-hidden />
        )}
      </span>
      <div>
        <header>
          <strong>{message.role === "user" ? "你" : "创作助手"}</strong>
          {message.model_slug ? <small>{message.model_slug}</small> : null}
        </header>
        {message.assets?.length ? (
          <div className="project-assistant-message-assets">
            {message.assets.map((asset) => (
              <span key={asset.id} title={asset.display_name}>
                <AssetPreview asset={asset} />
              </span>
            ))}
          </div>
        ) : null}
        {message.role === "assistant" ? (
          content ? (
            <div className="project-assistant-markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{ pre: AssistantCodeBlock }}
              >
                {content}
              </ReactMarkdown>
              {streaming ? (
                <i className="project-assistant-stream-caret" />
              ) : null}
            </div>
          ) : streaming ? (
            <span className="project-assistant-typing" aria-label="正在回复">
              <i />
              <i />
              <i />
            </span>
          ) : null
        ) : content ? (
          <p>{content}</p>
        ) : null}
        {message.status === "error" ? (
          <div className="project-assistant-error-card" role="alert">
            <span>{message.error_message || "生成失败，请稍后重试"}</span>
            <button type="button" onClick={onRetry}>
              <RefreshCw aria-hidden /> 重试
            </button>
          </div>
        ) : null}
        {message.role === "assistant" && content && !streaming ? (
          <button
            type="button"
            className="project-assistant-copy"
            aria-label="复制回复"
            onClick={() => void navigator.clipboard.writeText(content)}
          >
            <Copy aria-hidden />
          </button>
        ) : null}
      </div>
    </article>
  );
}

function toSelected(file: ManagedFile): SelectedImage {
  return {
    id: file.id,
    display_name: file.display_name,
    mime_type: file.mime_type,
    byte_size: file.byte_size,
  };
}

export function ProjectAssistantPanel({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoCreated = useRef(false);
  const [activeId, setActiveId] = useState<string>();
  const [input, setInput] = useState("");
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [streamingId, setStreamingId] = useState<string>();
  const [streamedContent, setStreamedContent] = useState("");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [modelSaving, setModelSaving] = useState(false);
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
  const imagesQuery = useQuery({
    queryKey: ["visual-assistant-project-images", projectId],
    queryFn: () =>
      getFiles({
        projectId,
        mediaKind: "image",
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
  const conversation = detailQuery.data;

  const createMutation = useMutation({
    mutationFn: () => createVisualAssistantConversation(projectId),
    onSuccess: (created) => {
      client.setQueryData(
        ["visual-assistant-conversation", projectId, created.id],
        created,
      );
      setActiveId(created.id);
      setInput("");
      setSelectedImages([]);
      setHistoryOpen(false);
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
    setSelectedImages([]);
    setModelPickerOpen(false);
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
      (!input.trim() && !selectedImages.length)
    )
      return;
    const controller = new AbortController();
    abortRef.current = controller;
    setNotice("");
    setStreamedContent("");
    let startedId = "";
    try {
      await streamVisualAssistant(
        projectId,
        conversation.id,
        {
          expected_revision: conversation.revision,
          content: input,
          asset_ids: selectedImages.map((image) => image.id),
        },
        controller.signal,
        (event) => {
          if (event.type === "start") {
            startedId = String(event.payload.assistant_message_id || "");
            setStreamingId(startedId);
            setInput("");
            setSelectedImages([]);
            if (event.payload.model_changed_from) {
              setNotice(
                `原模型不可用，已切换为 ${String(event.payload.model)}`,
              );
            }
            void detailQuery.refetch();
          } else if (event.type === "delta") {
            setStreamedContent(
              (current) => current + String(event.payload.text || ""),
            );
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
      if (startedId) await refreshConversation();
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

  const selectModel = async (modelId: string | null) => {
    if (!conversation || streamingId || modelId === conversation.model_id) {
      setModelPickerOpen(false);
      return;
    }
    setModelSaving(true);
    try {
      const updated = await patchVisualAssistantConversation(
        projectId,
        conversation.id,
        conversation.revision,
        { model_id: modelId },
      );
      client.setQueryData(
        ["visual-assistant-conversation", projectId, conversation.id],
        updated,
      );
      await listQuery.refetch();
      setModelPickerOpen(false);
      setNotice(
        modelId ? `已切换为 ${updated.model_slug}` : "已恢复为自动选择模型",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "切换模型失败");
      await detailQuery.refetch();
    } finally {
      setModelSaving(false);
    }
  };

  const removeConversation = async (
    target:
      | Pick<VisualAssistantConversation, "id" | "title" | "revision">
      | undefined,
  ) => {
    if (
      !target ||
      streamingId ||
      !window.confirm(`删除对话「${target.title}」？`)
    )
      return;
    try {
      await deleteVisualAssistantConversation(
        projectId,
        target.id,
        target.revision,
      );
      setActiveId(undefined);
      autoCreated.current = false;
      await listQuery.refetch();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除对话失败");
    }
  };

  const addImage = (image: SelectedImage) => {
    if (selectedImages.some((current) => current.id === image.id)) return;
    if (selectedImages.length >= MAX_IMAGES) {
      setNotice("每条消息最多添加 5 张图片");
      return;
    }
    if (
      image.byte_size > MAX_IMAGE_BYTES ||
      !ACCEPTED_TYPES.has(image.mime_type)
    ) {
      setNotice("仅支持不超过 8MB 的 JPEG、PNG、WebP 或 GIF 图片");
      return;
    }
    setSelectedImages((current) => [...current, image]);
    setPickerOpen(false);
  };

  const uploadImages = async (files: FileList | null) => {
    if (!files?.length) return;
    const candidates = Array.from(files);
    if (fileInput.current) fileInput.current.value = "";
    if (selectedImages.length + candidates.length > MAX_IMAGES) {
      setNotice("每条消息最多添加 5 张图片");
      return;
    }
    const invalid = candidates.find(
      (file) => !ACCEPTED_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES,
    );
    if (invalid) {
      setNotice(`「${invalid.name}」不是支持的图片或超过 8MB`);
      return;
    }
    setUploading(true);
    try {
      const uploaded: SelectedImage[] = [];
      for (const file of candidates) {
        uploaded.push(toSelected(await uploadManagedFile(file, projectId)));
      }
      setSelectedImages((current) => [...current, ...uploaded]);
      setPickerOpen(false);
      await client.invalidateQueries({
        queryKey: ["visual-assistant-project-images", projectId],
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "图片上传失败");
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
    setInput(user.content);
    setSelectedImages(user.assets ?? []);
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
            onClick={() => setModelPickerOpen(true)}
          >
            <span>
              <Sparkle aria-hidden />
            </span>
            <ChevronDown aria-hidden />
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
            title="收起"
            onClick={() => {
              setModelPickerOpen(false);
              onClose();
            }}
          >
            <Minus aria-hidden />
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
                  onClick={() => void removeConversation(item)}
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
            <MessageView
              key={message.id}
              message={message}
              content={
                message.id === streamingId ? streamedContent : message.content
              }
              streaming={message.id === streamingId}
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
                  onClick={() => setInput(suggestion)}
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
        {selectedImages.length ? (
          <div className="project-assistant-drafts" aria-label="待发送图片">
            {selectedImages.map((image) => (
              <span key={image.id}>
                <AssetPreview asset={image} />
                <button
                  type="button"
                  aria-label={`移除图片 ${image.display_name}`}
                  disabled={Boolean(streamingId)}
                  onClick={() =>
                    setSelectedImages((current) =>
                      current.filter((candidate) => candidate.id !== image.id),
                    )
                  }
                >
                  <X aria-hidden />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          value={input}
          rows={3}
          disabled={!conversation || Boolean(streamingId)}
          placeholder="输入创意想法，询问当前画布…"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void run();
            }
          }}
        />
        <div className="project-assistant-composer-actions">
          <div>
            <button
              type="button"
              aria-label="添加项目图片"
              title="添加项目图片"
              disabled={
                !conversation ||
                Boolean(streamingId) ||
                selectedImages.length >= MAX_IMAGES
              }
              onClick={() => setPickerOpen((value) => !value)}
            >
              <ImagePlus aria-hidden />
            </button>
            <button
              type="button"
              aria-label="上传图片"
              title="上传图片"
              disabled={!conversation || Boolean(streamingId) || uploading}
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? (
                <LoaderCircle className="spinning" aria-hidden />
              ) : (
                <Upload aria-hidden />
              )}
            </button>
            <input
              ref={fileInput}
              hidden
              multiple
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(event) => void uploadImages(event.target.files)}
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
                !conversation || (!input.trim() && !selectedImages.length)
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
            aria-label="选择项目图片"
          >
            <header>
              <strong>选择项目图片</strong>
              <button
                type="button"
                aria-label="关闭图片选择"
                onClick={() => setPickerOpen(false)}
              >
                <X aria-hidden />
              </button>
            </header>
            <div>
              {imagesQuery.isLoading ? (
                <span className="project-assistant-picker-empty">
                  正在读取图片…
                </span>
              ) : imagesQuery.data?.items.length ? (
                imagesQuery.data.items.map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => addImage(toSelected(file))}
                  >
                    <AssetPreview asset={toSelected(file)} />
                    <span>{file.display_name}</span>
                  </button>
                ))
              ) : (
                <span className="project-assistant-picker-empty">
                  项目中还没有图片
                </span>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {open && modelPickerOpen ? (
        <ModelPickerModal
          models={modelsQuery.data?.items ?? []}
          currentModelId={conversation?.model_id ?? null}
          loading={modelsQuery.isLoading}
          saving={modelSaving}
          onClose={() => setModelPickerOpen(false)}
          onSelect={(modelId) => void selectModel(modelId)}
        />
      ) : null}
    </aside>
  );
}
