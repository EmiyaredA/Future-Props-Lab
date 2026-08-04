import {
  forwardRef,
  isValidElement,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
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
  File,
  FileText,
  Film,
  History,
  LoaderCircle,
  Maximize2,
  MessageSquareText,
  Music,
  Image as ImageIcon,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Upload,
  UserRound,
  Wrench,
  X,
  Video,
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
  getGenerationOptions,
  getVisualAssistantConversation,
  getVisualAssistantConversations,
  getVisualAssistantModels,
  patchVisualAssistantConversation,
  resolveVisualAssistantApproval,
  streamVisualAssistant,
  type VisualAssistantAction,
  type VisualAssistantAsset,
  type VisualAssistantConversation,
  type VisualAssistantConversationSummary,
  type VisualAssistantContentPart,
  type VisualAssistantMessage,
  type VisualAssistantModelOption,
  type GenerationOptions,
} from "@features/visual-workshop/api";
import { ApiError, fetchApiBlob } from "@platform/api/client";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";

const MAX_ATTACHMENTS = 5;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const PANEL_WIDTH_KEY = "fpl_visual_assistant_panel_width";
const SUPPORTED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
  ".mp4",
  ".webm",
  ".mov",
  ".mp3",
  ".wav",
  ".m4a",
  ".ogg",
  ".pdf",
  ".txt",
  ".md",
]);
const ATTACHMENT_ACCEPT = Array.from(SUPPORTED_EXTENSIONS).join(",");

type SelectedAttachment = Pick<
  VisualAssistantAsset,
  "id" | "display_name" | "mime_type" | "byte_size"
>;

function isImage(asset: SelectedAttachment) {
  return asset.mime_type.startsWith("image/");
}

function attachmentTypeLabel(asset: SelectedAttachment) {
  if (asset.mime_type.startsWith("image/")) return "图片";
  if (asset.mime_type.startsWith("video/")) return "视频";
  if (asset.mime_type.startsWith("audio/")) return "音频";
  if (asset.mime_type === "application/pdf") return "PDF";
  if (asset.mime_type === "text/markdown") return "Markdown";
  if (asset.mime_type.startsWith("text/")) return "文本";
  return "文件";
}

function attachmentSize(byteSize: number) {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${Math.round(byteSize / 1024)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

function uploadIsSupported(file: globalThis.File) {
  const dot = file.name.lastIndexOf(".");
  return (
    dot >= 0 && SUPPORTED_EXTENSIONS.has(file.name.slice(dot).toLowerCase())
  );
}

type PendingApproval = {
  runId: string;
  approvalId: string;
  canvasRevision: number;
};
type ConversationDeleteTarget = Pick<
  VisualAssistantConversation,
  "id" | "title" | "revision"
>;

const TOOL_LABELS: Record<string, string> = {
  read_canvas: "读取画布",
  list_project_assets: "查找项目素材",
  list_generation_options: "读取生成选项",
  inspect_generation_task: "检查生成任务",
  apply_canvas_changes: "更新画布",
  start_generation_on_canvas: "创建生成任务与占位节点",
};

const ACTION_STATUS_LABELS: Record<VisualAssistantAction["status"], string> = {
  proposed: "已规划",
  waiting_approval: "等待确认",
  running: "执行中",
  completed: "已完成",
  rejected: "已拒绝",
  failed: "失败",
  cancelled: "已取消",
};

function compactPayload(value: Record<string, unknown>) {
  const text = JSON.stringify(value, null, 2);
  return text.length > 2400 ? `${text.slice(0, 2400)}\n…` : text;
}

function AssistantActions({
  actions,
  pendingApproval,
  approvalBusy,
  onResolve,
}: {
  actions: VisualAssistantAction[];
  pendingApproval?: PendingApproval;
  approvalBusy: boolean;
  onResolve: (decision: "approve" | "reject") => void;
}) {
  if (!actions.length) return null;
  const waiting = pendingApproval
    ? actions.some(
        (action) =>
          action.approval_group_id === pendingApproval.approvalId &&
          action.status === "waiting_approval",
      )
    : false;
  const completed = actions.filter(
    (action) => action.status === "completed",
  ).length;
  return (
    <section className="project-assistant-steps" aria-label="Agent 执行步骤">
      <header>
        <span>
          <Wrench aria-hidden />
          <strong>执行步骤</strong>
        </span>
        <small>
          {completed}/{actions.length}
        </small>
      </header>
      <div>
        {actions.map((action) => {
          const hasDetails =
            Object.keys(action.display_payload).length > 0 ||
            Object.keys(action.result_payload).length > 0 ||
            Boolean(action.error_message);
          return (
            <details
              key={action.id || action.action_id}
              className={`status-${action.status}`}
            >
              <summary>
                <span className="project-assistant-step-mark">
                  {action.status === "completed" ? (
                    <Check aria-hidden />
                  ) : action.status === "running" ? (
                    <LoaderCircle className="spinning" aria-hidden />
                  ) : action.status === "failed" ||
                    action.status === "rejected" ||
                    action.status === "cancelled" ? (
                    <X aria-hidden />
                  ) : (
                    <Wrench aria-hidden />
                  )}
                </span>
                <span>
                  <strong>
                    {TOOL_LABELS[action.tool_name] || action.tool_name}
                  </strong>
                  <small>{ACTION_STATUS_LABELS[action.status]}</small>
                </span>
                {hasDetails ? <ChevronDown aria-hidden /> : null}
              </summary>
              {hasDetails ? (
                <div className="project-assistant-step-detail">
                  {Object.keys(action.display_payload).length ? (
                    <>
                      <b>计划</b>
                      <pre>{compactPayload(action.display_payload)}</pre>
                    </>
                  ) : null}
                  {Object.keys(action.result_payload).length ? (
                    <>
                      <b>结果</b>
                      <pre>{compactPayload(action.result_payload)}</pre>
                    </>
                  ) : null}
                  {action.error_message ? <p>{action.error_message}</p> : null}
                </div>
              ) : null}
            </details>
          );
        })}
      </div>
      {waiting && pendingApproval ? (
        <footer className="project-assistant-approval">
          <p>
            Agent 已准备好上述操作。确认后会以画布 revision{" "}
            {pendingApproval.canvasRevision}{" "}
            执行；若画布已变化，将安全停止并重新规划。
          </p>
          <div>
            <button
              type="button"
              disabled={approvalBusy}
              onClick={() => onResolve("reject")}
            >
              拒绝
            </button>
            <button
              type="button"
              className="primary"
              disabled={approvalBusy}
              onClick={() => onResolve("approve")}
            >
              {approvalBusy ? (
                <LoaderCircle className="spinning" aria-hidden />
              ) : (
                <Check aria-hidden />
              )}
              确认执行
            </button>
          </div>
        </footer>
      ) : null}
    </section>
  );
}

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

function AttachmentIcon({ asset }: { asset: SelectedAttachment }) {
  if (asset.mime_type.startsWith("video/")) return <Film aria-hidden />;
  if (asset.mime_type.startsWith("audio/")) return <Music aria-hidden />;
  if (
    asset.mime_type === "application/pdf" ||
    asset.mime_type.startsWith("text/")
  )
    return <FileText aria-hidden />;
  return <File aria-hidden />;
}

function AssetPreview({ asset }: { asset: SelectedAttachment }) {
  const [url, setUrl] = useState("");
  const image = isImage(asset);
  const assetId = asset.id;
  useEffect(() => {
    if (!image) {
      setUrl("");
      return;
    }
    let active = true;
    let objectUrl = "";
    void fetchApiBlob(`/v1/files/${encodeURIComponent(assetId)}/content`)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, image]);
  if (!image) return <AttachmentIcon asset={asset} />;
  return url ? (
    <img src={url} alt={asset.display_name} />
  ) : (
    <File aria-hidden />
  );
}

function InlineMessageContent({
  message,
}: {
  message: VisualAssistantMessage;
}) {
  const assets = new Map(
    (message.assets ?? []).map((asset) => [asset.id, asset]),
  );
  return (
    <p className="project-assistant-inline-content">
      {message.content_parts?.map((part, index) => {
        if (part.type === "text")
          return <span key={`text-${index}`}>{part.text}</span>;
        const asset = assets.get(part.asset_id);
        return asset ? (
          <span
            key={`asset-${index}`}
            className="project-assistant-inline-asset"
            title={asset.display_name}
          >
            <span className="project-assistant-inline-asset-preview">
              <AssetPreview asset={asset} />
            </span>
            <span>{asset.display_name}</span>
          </span>
        ) : null;
      })}
    </p>
  );
}

const EMPTY_EDITOR_TEXT = "\u200b";
let composerPartSequence = 0;

type ComposerTextPart = {
  key: string;
  type: "text";
  text: string;
};
type ComposerAssetPart = {
  key: string;
  type: "asset";
  asset: SelectedAttachment;
};
type ComposerPart = ComposerTextPart | ComposerAssetPart;
type ComposerCaret = { key: string; offset: number };
type MentionMatch = ComposerCaret & { start: number; query: string };

type AssistantMentionComposerHandle = {
  insertAssets: (assets: SelectedAttachment[]) => void;
  focus: () => void;
};

function composerKey(prefix: "text" | "asset") {
  composerPartSequence += 1;
  return `${prefix}-${composerPartSequence}`;
}

function textPart(text = ""): ComposerTextPart {
  return { key: composerKey("text"), type: "text", text };
}

function assetPart(asset: SelectedAttachment): ComposerAssetPart {
  return { key: composerKey("asset"), type: "asset", asset };
}

function normalizeComposerParts(parts: ComposerPart[]): ComposerPart[] {
  const normalized: ComposerPart[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      const text = part.text.replaceAll(EMPTY_EDITOR_TEXT, "");
      const previous = normalized.at(-1);
      if (previous?.type === "text")
        normalized[normalized.length - 1] = {
          ...previous,
          text: previous.text + text,
        };
      else normalized.push({ ...part, text });
      continue;
    }
    if (normalized.at(-1)?.type !== "text") normalized.push(textPart());
    normalized.push(part);
  }
  if (!normalized.length) normalized.push(textPart());
  if (normalized[0].type !== "text") normalized.unshift(textPart());
  if (normalized.at(-1)?.type !== "text") normalized.push(textPart());
  return normalized;
}

function uniqueComposerAttachments(parts: ComposerPart[]) {
  const unique = new Map<string, SelectedAttachment>();
  parts.forEach((part) => {
    if (part.type === "asset" && !unique.has(part.asset.id))
      unique.set(part.asset.id, part.asset);
  });
  return [...unique.values()];
}

function composerContentParts(
  parts: ComposerPart[],
): VisualAssistantContentPart[] {
  const contentParts: VisualAssistantContentPart[] = [];
  for (const part of parts) {
    if (part.type === "asset")
      contentParts.push({ type: "asset", asset_id: part.asset.id });
    else if (part.text) contentParts.push({ type: "text", text: part.text });
  }
  return contentParts;
}

function composerText(parts: ComposerPart[]) {
  return parts
    .filter((part): part is ComposerTextPart => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function caretInComposer(root: HTMLDivElement): ComposerCaret | null {
  const selection = window.getSelection();
  if (!selection?.isCollapsed || !selection.anchorNode) return null;
  const anchor = selection.anchorNode;
  const element = anchor instanceof HTMLElement ? anchor : anchor.parentElement;
  const textElement = element?.closest<HTMLElement>("[data-composer-text]");
  if (textElement && root.contains(textElement)) {
    const range = document.createRange();
    range.selectNodeContents(textElement);
    try {
      range.setEnd(anchor, selection.anchorOffset);
    } catch {
      return null;
    }
    return {
      key: textElement.dataset.partKey || "",
      offset: range.toString().replaceAll(EMPTY_EDITOR_TEXT, "").length,
    };
  }
  return null;
}

function mentionAtCaret(parts: ComposerPart[], caret: ComposerCaret | null) {
  if (!caret) return null;
  const part = parts.find(
    (candidate): candidate is ComposerTextPart =>
      candidate.key === caret.key && candidate.type === "text",
  );
  if (!part) return null;
  const prefix = part.text.slice(0, caret.offset);
  const match = prefix.match(/(?:^|[\s([（【])@([^\s@]*)$/u);
  if (!match) return null;
  const query = match[1] ?? "";
  return {
    ...caret,
    start: caret.offset - query.length - 1,
    query,
  } satisfies MentionMatch;
}

function partsFromMessage(message: VisualAssistantMessage): ComposerPart[] {
  const assets = new Map(
    (message.assets ?? []).map((asset) => [asset.id, asset]),
  );
  if (message.content_parts?.length) {
    const parts: ComposerPart[] = [];
    for (const part of message.content_parts) {
      if (part.type === "text") parts.push(textPart(part.text));
      else {
        const asset = assets.get(part.asset_id);
        if (asset) parts.push(assetPart(asset));
      }
    }
    return normalizeComposerParts(parts);
  }
  const legacy: ComposerPart[] = [textPart(message.content)];
  for (const asset of message.assets ?? []) legacy.push(assetPart(asset));
  return normalizeComposerParts(legacy);
}

const AssistantMentionComposer = forwardRef<
  AssistantMentionComposerHandle,
  {
    projectId: string;
    value: ComposerPart[];
    disabled: boolean;
    maxAttachments: number;
    onChange: (parts: ComposerPart[]) => void;
    onSubmit: () => void;
    onLimit: () => void;
  }
>(function AssistantMentionComposer(
  { projectId, value, disabled, maxAttachments, onChange, onSubmit, onLimit },
  forwardedRef,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const pendingCaret = useRef<ComposerCaret | undefined>(undefined);
  const lastCaret = useRef<ComposerCaret | undefined>(undefined);
  const composing = useRef(false);
  const [mention, setMention] = useState<MentionMatch>();
  const [activeOption, setActiveOption] = useState(0);
  const mentionQuery = useQuery({
    queryKey: [
      "visual-assistant-project-mentions",
      projectId,
      mention?.query ?? "",
    ],
    queryFn: () =>
      getFiles({
        projectId,
        query: mention?.query.trim() || undefined,
        includeReferences: true,
        sort: "updated",
      }),
    enabled: Boolean(mention) && !disabled,
  });
  const selectedIds = new Set(
    uniqueComposerAttachments(value).map((attachment) => attachment.id),
  );
  const options = mentionQuery.data?.items ?? [];

  const restoreCaret = (caret: ComposerCaret) => {
    const root = editorRef.current;
    if (!root) return;
    const textElement = [
      ...root.querySelectorAll<HTMLElement>("[data-composer-text]"),
    ].find((element) => element.dataset.partKey === caret.key);
    const node = textElement?.firstChild;
    if (!textElement || !node) return;
    const length = node.textContent?.length ?? 0;
    const offset =
      length === 1 && node.textContent === EMPTY_EDITOR_TEXT
        ? 1
        : Math.min(caret.offset, length);
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    lastCaret.current = caret;
  };

  useLayoutEffect(() => {
    if (!pendingCaret.current) return;
    const caret = pendingCaret.current;
    pendingCaret.current = undefined;
    restoreCaret(caret);
  }, [value]);

  useEffect(() => {
    setActiveOption(0);
  }, [mention?.query]);

  const emit = (parts: ComposerPart[], caret?: ComposerCaret) => {
    const normalized = normalizeComposerParts(parts);
    if (caret) {
      lastCaret.current = caret;
      pendingCaret.current = caret;
    }
    onChange(normalized);
  };

  const rememberCaret = () => {
    const root = editorRef.current;
    if (!root) return;
    const caret = caretInComposer(root);
    if (caret) lastCaret.current = caret;
  };

  const refreshMention = () => {
    const root = editorRef.current;
    if (!root) return;
    const caret = caretInComposer(root);
    if (!caret) return;
    lastCaret.current = caret;
    if (!composing.current)
      setMention(mentionAtCaret(value, caret) ?? undefined);
  };

  const ensureCaret = () => {
    const root = editorRef.current;
    if (!root) return;
    const caret = caretInComposer(root);
    if (caret) {
      lastCaret.current = caret;
      return;
    }
    const fallback = [...value]
      .reverse()
      .find((part): part is ComposerTextPart => part.type === "text");
    if (!fallback) return;
    restoreCaret(
      lastCaret.current ?? { key: fallback.key, offset: fallback.text.length },
    );
  };

  const insertAtCaret = (assets: SelectedAttachment[]) => {
    if (!assets.length) return;
    const existing = uniqueComposerAttachments(value);
    const nextIds = new Set(existing.map((asset) => asset.id));
    assets.forEach((asset) => nextIds.add(asset.id));
    if (nextIds.size > maxAttachments) {
      onLimit();
      return;
    }
    const caret = lastCaret.current ?? {
      key: (value.at(-1) as ComposerTextPart).key,
      offset: (value.at(-1) as ComposerTextPart).text.length,
    };
    const index = value.findIndex((part) => part.key === caret.key);
    const current = value[index];
    if (index < 0 || current?.type !== "text") return;
    const before = { ...current, text: current.text.slice(0, caret.offset) };
    const after = textPart(current.text.slice(caret.offset));
    emit(
      [
        ...value.slice(0, index),
        before,
        ...assets.map((asset) => assetPart(asset)),
        after,
        ...value.slice(index + 1),
      ],
      { key: after.key, offset: 0 },
    );
    setMention(undefined);
  };

  useImperativeHandle(forwardedRef, () => ({
    insertAssets: insertAtCaret,
    focus: () => editorRef.current?.focus(),
  }));

  const selectMention = (file: ManagedFile) => {
    if (!mention) return;
    const attachment = toSelected(file);
    if (!selectedIds.has(attachment.id) && selectedIds.size >= maxAttachments) {
      onLimit();
      return;
    }
    const index = value.findIndex((part) => part.key === mention.key);
    const current = value[index];
    if (index < 0 || current?.type !== "text") return;
    const before = {
      ...current,
      text: current.text.slice(0, mention.start),
    };
    const after = textPart(current.text.slice(mention.offset));
    emit(
      [
        ...value.slice(0, index),
        before,
        assetPart(attachment),
        after,
        ...value.slice(index + 1),
      ],
      { key: after.key, offset: 0 },
    );
    setMention(undefined);
  };

  const insertText = (text: string) => {
    const caret = lastCaret.current;
    if (!caret) return;
    const index = value.findIndex((part) => part.key === caret.key);
    const current = value[index];
    if (index < 0 || current?.type !== "text") return;
    const next = {
      ...current,
      text:
        current.text.slice(0, caret.offset) +
        text +
        current.text.slice(caret.offset),
    };
    emit([...value.slice(0, index), next, ...value.slice(index + 1)], {
      key: next.key,
      offset: caret.offset + text.length,
    });
  };

  const removeAsset = (key: string) => {
    const index = value.findIndex((part) => part.key === key);
    if (index < 0) return;
    const before = value[index - 1];
    emit(
      value.filter((part) => part.key !== key),
      before?.type === "text"
        ? { key: before.key, offset: before.text.length }
        : undefined,
    );
  };

  const syncFromDom = () => {
    const root = editorRef.current;
    if (!root) return;
    const knownAssets = new Map(
      value.flatMap((part) =>
        part.type === "asset" ? [[part.asset.id, part.asset] as const] : [],
      ),
    );
    const parts: ComposerPart[] = [];
    for (const node of root.childNodes) {
      if (node instanceof HTMLElement && node.dataset.assetId) {
        const asset = knownAssets.get(node.dataset.assetId);
        if (asset)
          parts.push({
            key: node.dataset.partKey || composerKey("asset"),
            type: "asset",
            asset,
          });
        continue;
      }
      const element = node instanceof HTMLElement ? node : undefined;
      parts.push({
        key: element?.dataset.partKey || composerKey("text"),
        type: "text",
        text: (node.textContent || "").replaceAll(EMPTY_EDITOR_TEXT, ""),
      });
    }
    const caret = caretInComposer(root);
    if (caret) {
      lastCaret.current = caret;
      pendingCaret.current = caret;
    }
    const normalized = normalizeComposerParts(parts);
    onChange(normalized);
    setMention(mentionAtCaret(normalized, caret) ?? undefined);
    queueMicrotask(() => {
      const settledCaret = caretInComposer(root);
      if (!settledCaret || composing.current) return;
      lastCaret.current = settledCaret;
      setMention(mentionAtCaret(normalized, settledCaret) ?? undefined);
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    rememberCaret();
    if (mention && !composing.current) {
      if (
        options.length &&
        (event.key === "ArrowDown" || event.key === "ArrowUp")
      ) {
        event.preventDefault();
        setActiveOption((current) =>
          event.key === "ArrowDown"
            ? (current + 1) % options.length
            : (current - 1 + options.length) % options.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const candidate = options[activeOption];
        if (candidate) selectMention(candidate);
        return;
      }
    }
    if (event.key === "Escape" && mention) {
      event.preventDefault();
      setMention(undefined);
      return;
    }
    if (event.key === "Enter") {
      if (composing.current || event.nativeEvent.isComposing) return;
      event.preventDefault();
      if (event.shiftKey) insertText("\n");
      else onSubmit();
      return;
    }
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    const caret = lastCaret.current;
    if (!caret) return;
    const index = value.findIndex((part) => part.key === caret.key);
    const current = value[index];
    if (current?.type !== "text") return;
    const adjacent =
      event.key === "Backspace" && caret.offset === 0
        ? value[index - 1]
        : event.key === "Delete" && caret.offset === current.text.length
          ? value[index + 1]
          : undefined;
    if (adjacent?.type === "asset") {
      event.preventDefault();
      removeAsset(adjacent.key);
    }
  };

  return (
    <div className="project-assistant-rich-editor-shell">
      <div
        ref={editorRef}
        className="project-assistant-rich-editor"
        role="textbox"
        aria-label="消息内容"
        aria-multiline="true"
        aria-autocomplete="list"
        aria-expanded={Boolean(mention)}
        data-empty={
          !composerText(value).length &&
          !value.some((part) => part.type === "asset")
        }
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder="输入创意想法，使用 @ 引用项目素材…"
        onInput={syncFromDom}
        onKeyDown={handleKeyDown}
        onKeyUp={refreshMention}
        onMouseUp={ensureCaret}
        onFocus={ensureCaret}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          syncFromDom();
        }}
        onPaste={(event) => {
          event.preventDefault();
          rememberCaret();
          insertText(event.clipboardData.getData("text/plain"));
        }}
      >
        {value.map((part) =>
          part.type === "text" ? (
            <span key={part.key} data-composer-text data-part-key={part.key}>
              {part.text || EMPTY_EDITOR_TEXT}
            </span>
          ) : (
            <span
              key={part.key}
              className="project-assistant-inline-asset is-editable"
              contentEditable={false}
              data-asset-id={part.asset.id}
              data-part-key={part.key}
              title={part.asset.display_name}
            >
              <span className="project-assistant-inline-asset-preview">
                <AssetPreview asset={part.asset} />
              </span>
              <span>{part.asset.display_name}</span>
              <button
                type="button"
                aria-label={`移除附件 ${part.asset.display_name}`}
                disabled={disabled}
                onClick={() => removeAsset(part.key)}
              >
                <X aria-hidden />
              </button>
            </span>
          ),
        )}
      </div>
      {mention ? (
        <div
          className="project-assistant-mention-menu"
          role="listbox"
          aria-label="引用项目素材"
        >
          {mentionQuery.isLoading ? (
            <span>正在读取项目素材…</span>
          ) : options.length ? (
            options.map((file, index) => {
              const attachment = toSelected(file);
              const atLimit =
                !selectedIds.has(attachment.id) &&
                selectedIds.size >= maxAttachments;
              return (
                <button
                  key={file.id}
                  type="button"
                  role="option"
                  aria-selected={index === activeOption}
                  disabled={atLimit}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectMention(file);
                  }}
                  onMouseEnter={() => setActiveOption(index)}
                >
                  <span className="project-assistant-picker-preview">
                    <AssetPreview asset={attachment} />
                  </span>
                  <span>
                    <strong>{file.display_name}</strong>
                    <small>
                      {attachmentTypeLabel(attachment)} ·{" "}
                      {attachmentSize(file.byte_size)}
                    </small>
                  </span>
                  {selectedIds.has(file.id) ? <Check aria-hidden /> : null}
                </button>
              );
            })
          ) : (
            <span>
              {mention.query ? "没有匹配的项目素材" : "项目中还没有可用素材"}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
});

type AgentModelKind = "text" | "image" | "video";

type AgentConfigModel = {
  id: string;
  provider_id: string;
  provider_name: string;
  slug: string;
  label: string;
  description: string;
  kind: AgentModelKind;
  capabilities: string[];
};

function ModelPickerModal({
  textModels,
  generationOptions,
  conversation,
  loading,
  saving,
  error,
  onClose,
  onSelect,
}: {
  textModels: VisualAssistantModelOption[];
  generationOptions?: GenerationOptions;
  conversation: VisualAssistantConversation;
  loading: boolean;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSelect: (kind: AgentModelKind, modelId: string | null) => void;
}) {
  const [kind, setKind] = useState<AgentModelKind>("text");
  const [providerByKind, setProviderByKind] = useState<
    Record<AgentModelKind, string>
  >({ text: "", image: "", video: "" });
  const models = useMemo<AgentConfigModel[]>(
    () => [
      ...textModels.map((model) => ({ ...model, kind: "text" as const })),
      ...(generationOptions?.models ?? []).map((model) => ({
        ...model,
        kind: model.kind,
        capabilities:
          model.kind === "image"
            ? ["image_generation", ...(model.sizes?.length ? ["sizes"] : [])]
            : ["video_generation"],
      })),
    ],
    [generationOptions?.models, textModels],
  );
  const currentModelIds: Record<AgentModelKind, string | null> = {
    text: conversation.model_id,
    image: conversation.image_model_id,
    video: conversation.video_model_id,
  };
  const kindModels = models.filter((model) => model.kind === kind);
  const currentProviderId = kindModels.find(
    (model) => model.id === currentModelIds[kind],
  )?.provider_id;
  const providerId = providerByKind[kind];
  const providers = useMemo(
    () =>
      Array.from(
        kindModels.reduce((result, model) => {
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
    [kindModels],
  );

  useEffect(() => {
    if (!providers.length) return;
    if (!providers.some((provider) => provider.id === providerId)) {
      setProviderByKind((current) => ({
        ...current,
        [kind]: currentProviderId ?? providers[0].id,
      }));
    }
  }, [currentProviderId, kind, providerId, providers]);

  const visibleModels = kindModels.filter(
    (model) => model.provider_id === providerId,
  );
  const selection = (targetKind: AgentModelKind) =>
    models.find(
      (model) =>
        model.kind === targetKind && model.id === currentModelIds[targetKind],
    );
  const kindLabel = {
    text: "Agent 文本",
    image: "图像生成",
    video: "视频生成",
  } satisfies Record<AgentModelKind, string>;
  const kindHelp = {
    text: "用于理解需求、规划步骤和调用工具",
    image: "用于 Agent 创建图片节点、参考图和视觉方案",
    video: "用于 Agent 创建视频节点、首尾帧和动态分镜",
  } satisfies Record<AgentModelKind, string>;
  const KindIcon =
    kind === "text" ? MessageSquareText : kind === "image" ? ImageIcon : Video;
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
        aria-label="配置 Agent 模型"
      >
        <header>
          <div className="assistant-model-heading">
            <span className="assistant-model-heading-icon">
              <SlidersHorizontal aria-hidden />
            </span>
            <div>
              <h2>配置 Agent 模型</h2>
              <p>
                分别指定对话、图像和视频任务使用的模型；未指定时由 Agent
                自动选择。
              </p>
            </div>
          </div>
          <button type="button" aria-label="关闭模型选择" onClick={onClose}>
            <X aria-hidden />
          </button>
        </header>
        <div
          className="assistant-model-tabs"
          role="tablist"
          aria-label="模型用途"
        >
          {(["text", "image", "video"] as AgentModelKind[]).map((tab) => {
            const Icon =
              tab === "text"
                ? MessageSquareText
                : tab === "image"
                  ? ImageIcon
                  : Video;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={kind === tab}
                onClick={() => setKind(tab)}
              >
                <Icon aria-hidden />
                <span>
                  <strong>{kindLabel[tab]}</strong>
                  <small>{selection(tab)?.label || "自动选择"}</small>
                </span>
              </button>
            );
          })}
        </div>
        <div className="assistant-model-browser">
          <nav aria-label="模型供应商">
            {providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className={provider.id === providerId ? "active" : ""}
                onClick={() =>
                  setProviderByKind((current) => ({
                    ...current,
                    [kind]: provider.id,
                  }))
                }
              >
                <span>
                  <i aria-hidden>{provider.name.slice(0, 1).toUpperCase()}</i>
                  <b>{provider.name}</b>
                </span>
                <small>{provider.count}</small>
              </button>
            ))}
          </nav>
          <div className="assistant-model-content">
            <header>
              <span>
                <KindIcon aria-hidden />
                <span>
                  <strong>选择{kindLabel[kind]}模型</strong>
                  <small>{kindHelp[kind]}</small>
                </span>
              </span>
              <button
                type="button"
                disabled={saving || currentModelIds[kind] === null}
                onClick={() => onSelect(kind, null)}
              >
                恢复自动选择
              </button>
            </header>
            <div className="assistant-model-list">
              {loading ? (
                <div className="assistant-model-state">
                  <LoaderCircle className="spinning" aria-hidden />{" "}
                  正在读取模型…
                </div>
              ) : visibleModels.length ? (
                visibleModels.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    className={
                      model.id === currentModelIds[kind] ? "selected" : ""
                    }
                    disabled={saving}
                    onClick={() => onSelect(kind, model.id)}
                  >
                    <span>
                      <strong>{model.label}</strong>
                      {model.id === currentModelIds[kind] ? (
                        <i className="assistant-model-selected">
                          <Check aria-hidden />
                        </i>
                      ) : null}
                    </span>
                    <code>{model.slug}</code>
                    {model.description ? <p>{model.description}</p> : null}
                    <footer>
                      {kind === "text" ? (
                        <em>
                          <MessageSquareText aria-hidden /> 对话
                        </em>
                      ) : null}
                      {kind === "image" ? (
                        <em>
                          <ImageIcon aria-hidden /> 图像生成
                        </em>
                      ) : null}
                      {kind === "video" ? (
                        <em>
                          <Video aria-hidden /> 视频生成
                        </em>
                      ) : null}
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
                <div className="assistant-model-state">
                  没有可用的{kindLabel[kind]}模型
                </div>
              )}
            </div>
          </div>
        </div>
        <footer>
          <span className="assistant-model-footer-label">当前 Agent 配置</span>
          {(["text", "image", "video"] as AgentModelKind[]).map((item) => (
            <span className="assistant-model-summary" key={item}>
              <small>{kindLabel[item]}</small>
              <strong>{selection(item)?.label || "自动选择"}</strong>
            </span>
          ))}
          <span
            className={
              error
                ? "assistant-model-save-state error"
                : "assistant-model-save-state"
            }
          >
            {saving ? "正在保存…" : error || "配置已保存"}
          </span>
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
  actions,
  pendingApproval,
  approvalBusy,
  onResolveApproval,
  onRetry,
}: {
  message: VisualAssistantMessage;
  content: string;
  streaming: boolean;
  actions: VisualAssistantAction[];
  pendingApproval?: PendingApproval;
  approvalBusy: boolean;
  onResolveApproval: (decision: "approve" | "reject") => void;
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
        {message.assets?.length && !message.content_parts?.length ? (
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
        ) : message.content_parts?.length ? (
          <InlineMessageContent message={message} />
        ) : content ? (
          <p>{content}</p>
        ) : null}
        {message.role === "assistant" ? (
          <AssistantActions
            actions={actions}
            pendingApproval={pendingApproval}
            approvalBusy={approvalBusy}
            onResolve={onResolveApproval}
          />
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

function toSelected(file: ManagedFile): SelectedAttachment {
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
  prepareCanvas,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  prepareCanvas: () => Promise<number>;
}) {
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const composerRef = useRef<AssistantMentionComposerHandle>(null);
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
    queryKey: [
      "visual-assistant-project-attachments",
      projectId,
      attachmentSearch,
    ],
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
      await client.invalidateQueries({
        queryKey: ["visual-assistant-project-attachments", projectId],
      });
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
            <Maximize2 aria-hidden />
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
            <MessageView
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
        <AssistantMentionComposer
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
                        <AssetPreview asset={attachment} />
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
        <ModelPickerModal
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
