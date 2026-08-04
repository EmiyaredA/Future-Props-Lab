import {
  type CSSProperties,
  FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Image,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Music,
  Settings2,
  Sparkles,
  Upload,
  Video,
  X,
} from "lucide-react";
import {
  getFiles,
  getFolders,
  uploadManagedFile,
  type ManagedFile,
  type MediaKind,
} from "@features/files";
import {
  createGenerationTask,
  getGenerationOptions,
  type GenerationTaskInput,
} from "@features/visual-workshop/api";
import { ApiError, fetchApiBlob } from "@platform/api/client";
import { CustomSelect } from "@shared/ui/CustomSelect";
import {
  EMPTY_COMPOSER_TEXT,
  findMentionAtCaret,
  mentionPartLength,
  mentionProjection,
  normalizeMentionParts,
} from "@features/visual-workshop/mention-composer/model";
import {
  IMAGE_CLARITY_OPTIONS,
  IMAGE_RATIO_OPTIONS,
  MEDIA_ACCEPT,
  VIDEO_RATIO_OPTIONS,
  VIDEO_RESOLUTION_OPTIONS,
  imageRatioIconStyle,
  imageSizeChoices,
  type GenerationKind,
  type VideoMode,
} from "@features/visual-workshop/generation/options";

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.problem.detail || error.message;
  return error instanceof Error ? error.message : "创建任务失败，请稍后重试。";
}

function MediaPreview({ file }: { file: ManagedFile }) {
  const [source, setSource] = useState("");
  useEffect(() => {
    if (file.media_kind === "audio") return;
    let active = true;
    let objectUrl = "";
    void fetchApiBlob(`/v1/files/${file.id}/content`)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, file.media_kind]);
  if (file.media_kind === "image" && source) return <img src={source} alt="" />;
  if (file.media_kind === "video" && source)
    return <video src={source} muted preload="metadata" aria-hidden />;
  const Icon =
    file.media_kind === "video"
      ? Video
      : file.media_kind === "audio"
        ? Music
        : Image;
  return <Icon aria-hidden />;
}

const EMPTY_PROMPT_TEXT = EMPTY_COMPOSER_TEXT;
let promptPartSequence = 0;

type PromptTextPart = { key: string; type: "text"; text: string };
type PromptAssetPart = { key: string; type: "asset"; file: ManagedFile };
type PromptPart = PromptTextPart | PromptAssetPart;
type PromptCaret = { key: string; offset: number };
type PromptMention = PromptCaret & { start: number; query: string };
type PromptSelection = { start: number; end: number };

function promptKey(prefix: "text" | "asset") {
  promptPartSequence += 1;
  return `${prefix}-${promptPartSequence}`;
}

function promptTextPart(text = ""): PromptTextPart {
  return { key: promptKey("text"), type: "text", text };
}

function promptAssetPart(file: ManagedFile): PromptAssetPart {
  return { key: promptKey("asset"), type: "asset", file };
}

function normalizePromptParts(parts: PromptPart[]): PromptPart[] {
  return normalizeMentionParts(parts, promptTextPart);
}

function promptProjection(parts: PromptPart[]) {
  return mentionProjection(parts, (part) => `@${part.file.display_name}`);
}

function promptPartLength(part: PromptPart) {
  return mentionPartLength(part, (token) => `@${token.file.display_name}`);
}

function promptBoundaryOffset(
  root: HTMLDivElement,
  parts: PromptPart[],
  node: Node,
  offset: number,
) {
  if (node === root) {
    let total = 0;
    for (let index = 0; index < offset; index += 1) {
      const child = root.childNodes[index];
      const element = child instanceof HTMLElement ? child : undefined;
      const part = parts.find(
        (candidate) => candidate.key === element?.dataset.partKey,
      );
      if (part) total += promptPartLength(part);
    }
    return total;
  }
  const element = node instanceof HTMLElement ? node : node.parentElement;
  const partElement = element?.closest<HTMLElement>("[data-part-key]");
  if (!partElement || !root.contains(partElement)) return null;
  const index = parts.findIndex(
    (part) => part.key === partElement.dataset.partKey,
  );
  if (index < 0) return null;
  const before = parts
    .slice(0, index)
    .reduce((total, part) => total + promptPartLength(part), 0);
  const part = parts[index];
  if (part.type === "asset")
    return before + (offset > 0 ? promptPartLength(part) : 0);
  const range = document.createRange();
  range.selectNodeContents(partElement);
  try {
    range.setEnd(node, offset);
  } catch {
    return null;
  }
  return before + range.toString().replaceAll(EMPTY_PROMPT_TEXT, "").length;
}

function promptSelection(
  root: HTMLDivElement,
  parts: PromptPart[],
): PromptSelection | null {
  const selection = window.getSelection();
  if (!selection?.anchorNode || !selection.focusNode) return null;
  const anchor = promptBoundaryOffset(
    root,
    parts,
    selection.anchorNode,
    selection.anchorOffset,
  );
  const focus = promptBoundaryOffset(
    root,
    parts,
    selection.focusNode,
    selection.focusOffset,
  );
  if (anchor === null || focus === null) return null;
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
}

function promptCaretAtOffset(parts: PromptPart[], target: number) {
  let offset = 0;
  let previousText: PromptTextPart | undefined;
  for (const part of parts) {
    const length = promptPartLength(part);
    if (part.type === "text") {
      if (target <= offset + length)
        return { key: part.key, offset: Math.max(0, target - offset) };
      previousText = part;
    } else if (target < offset + length && previousText) {
      return { key: previousText.key, offset: previousText.text.length };
    }
    offset += length;
  }
  return previousText
    ? { key: previousText.key, offset: previousText.text.length }
    : undefined;
}

function renderPromptParts(root: HTMLDivElement, parts: PromptPart[]) {
  const fragment = document.createDocumentFragment();
  for (const part of parts) {
    if (part.type === "text") {
      const span = document.createElement("span");
      span.dataset.promptText = "";
      span.dataset.partKey = part.key;
      span.append(document.createTextNode(part.text));
      fragment.append(span);
      continue;
    }
    const asset = document.createElement("span");
    asset.className = "generation-prompt-asset";
    asset.contentEditable = "false";
    asset.dataset.assetId = part.file.id;
    asset.dataset.partKey = part.key;
    asset.title = part.file.display_name;

    const preview = document.createElement("span");
    preview.className = "generation-prompt-asset-preview";
    preview.setAttribute("aria-hidden", "true");
    preview.dataset.kindLabel =
      part.file.media_kind === "image"
        ? "图"
        : part.file.media_kind === "video"
          ? "视"
          : part.file.media_kind === "audio"
            ? "音"
            : "文";
    const name = document.createElement("span");
    name.textContent = part.file.display_name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.removePromptAsset = part.key;
    remove.setAttribute("aria-label", `移除引用 ${part.file.display_name}`);
    asset.append(preview, name, remove);
    fragment.append(asset);
  }
  root.replaceChildren(fragment);
}

function promptCaret(root: HTMLDivElement): PromptCaret | null {
  const selection = window.getSelection();
  if (!selection?.isCollapsed || !selection.anchorNode) return null;
  const anchor = selection.anchorNode;
  const element = anchor instanceof HTMLElement ? anchor : anchor.parentElement;
  const textElement = element?.closest<HTMLElement>("[data-prompt-text]");
  if (!textElement || !root.contains(textElement)) return null;
  const range = document.createRange();
  range.selectNodeContents(textElement);
  try {
    range.setEnd(anchor, selection.anchorOffset);
  } catch {
    return null;
  }
  return {
    key: textElement.dataset.partKey || "",
    offset: range.toString().replaceAll(EMPTY_PROMPT_TEXT, "").length,
  };
}

function promptMentionAtCaret(
  parts: PromptPart[],
  caret: PromptCaret | null,
): PromptMention | null {
  return findMentionAtCaret(parts, caret);
}

function GenerationPromptEditor({
  value,
  assets,
  label,
  placeholder,
  onChange,
}: {
  value: string;
  assets: ManagedFile[];
  label: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastCaret = useRef<PromptCaret | undefined>(undefined);
  const pendingCaret = useRef<PromptCaret | undefined>(undefined);
  const pendingDomSync = useRef(true);
  const composing = useRef(false);
  const [parts, setParts] = useState<PromptPart[]>(() => [
    promptTextPart(value),
  ]);
  const [mention, setMention] = useState<PromptMention>();
  const [mentionTop, setMentionTop] = useState(32);
  const [activeOption, setActiveOption] = useState(0);
  const query = mention?.query.trim().toLocaleLowerCase("zh-CN") ?? "";
  const options = assets
    .filter((file) =>
      query
        ? `${file.display_name} ${file.original_filename}`
            .toLocaleLowerCase("zh-CN")
            .includes(query)
        : true,
    )
    .slice(0, 8);

  const restoreCaret = (caret: PromptCaret) => {
    const root = editorRef.current;
    const textElement = [
      ...(root?.querySelectorAll<HTMLElement>("[data-prompt-text]") ?? []),
    ].find((element) => element.dataset.partKey === caret.key);
    const node = textElement?.firstChild;
    if (!textElement || !node) return;
    const length = node.textContent?.length ?? 0;
    const offset =
      length === 1 && node.textContent === EMPTY_PROMPT_TEXT
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
    const root = editorRef.current;
    if (!root || !pendingDomSync.current) return;
    pendingDomSync.current = false;
    renderPromptParts(root, parts);
    if (!pendingCaret.current) return;
    const caret = pendingCaret.current;
    pendingCaret.current = undefined;
    restoreCaret(caret);
  }, [parts]);

  useEffect(() => {
    if (promptProjection(parts) === value) return;
    if (document.activeElement === editorRef.current) return;
    pendingDomSync.current = true;
    setParts([promptTextPart(value)]);
  }, [parts, value]);

  useEffect(() => setActiveOption(0), [query]);

  const commit = (next: PromptPart[], caret?: PromptCaret) => {
    const normalized = normalizePromptParts(next);
    const projected = promptProjection(normalized);
    if (projected.length > 6000) {
      pendingDomSync.current = true;
      setParts((current) => [...current]);
      return;
    }
    if (caret) {
      lastCaret.current = caret;
      pendingCaret.current = caret;
    }
    pendingDomSync.current = true;
    setParts(normalized);
    onChange(projected);
  };

  const rememberCaret = () => {
    const root = editorRef.current;
    if (!root) return;
    const caret = promptCaret(root);
    if (caret) lastCaret.current = caret;
  };

  const placeMentionMenu = () => {
    const root = editorRef.current;
    const selection = window.getSelection();
    if (!root || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer)) return;
    const caretRect =
      typeof range.getBoundingClientRect === "function"
        ? range.getBoundingClientRect()
        : undefined;
    if (!caretRect) return;
    const rootRect = root.getBoundingClientRect();
    setMentionTop(Math.max(28, caretRect.bottom - rootRect.top + 6));
  };

  const ensureCaret = () => {
    const root = editorRef.current;
    if (!root) return;
    const caret = promptCaret(root);
    if (caret) {
      lastCaret.current = caret;
      return;
    }
    const fallback = [...parts]
      .reverse()
      .find((part): part is PromptTextPart => part.type === "text");
    if (fallback)
      restoreCaret(
        lastCaret.current ?? {
          key: fallback.key,
          offset: fallback.text.length,
        },
      );
  };

  const insertText = (text: string) => {
    const caret = lastCaret.current;
    if (!caret) return;
    const index = parts.findIndex((part) => part.key === caret.key);
    const current = parts[index];
    if (current?.type !== "text") return;
    const next = {
      ...current,
      text:
        current.text.slice(0, caret.offset) +
        text +
        current.text.slice(caret.offset),
    };
    commit([...parts.slice(0, index), next, ...parts.slice(index + 1)], {
      key: next.key,
      offset: caret.offset + text.length,
    });
  };

  const replaceSelection = (selection: PromptSelection, replacement = "") => {
    let { start, end } = selection;
    let offset = 0;
    for (const part of parts) {
      const length = promptPartLength(part);
      const partEnd = offset + length;
      if (part.type === "asset") {
        if (start > offset && start < partEnd) start = offset;
        if (end > offset && end < partEnd) end = partEnd;
      }
      offset = partEnd;
    }
    const next: PromptPart[] = [];
    let inserted = false;
    offset = 0;
    for (const part of parts) {
      const length = promptPartLength(part);
      const partEnd = offset + length;
      if (partEnd <= start || offset >= end) {
        if (!inserted && offset >= end) {
          next.push(promptTextPart(replacement));
          inserted = true;
        }
        next.push(part);
        offset = partEnd;
        continue;
      }
      if (part.type === "text") {
        const prefixLength = Math.max(0, start - offset);
        const suffixOffset = Math.min(length, Math.max(0, end - offset));
        if (prefixLength)
          next.push({ ...part, text: part.text.slice(0, prefixLength) });
        if (!inserted) {
          next.push(promptTextPart(replacement));
          inserted = true;
        }
        if (suffixOffset < length)
          next.push(promptTextPart(part.text.slice(suffixOffset)));
      } else if (!inserted) {
        next.push(promptTextPart(replacement));
        inserted = true;
      }
      offset = partEnd;
    }
    if (!inserted) next.push(promptTextPart(replacement));
    const normalized = normalizePromptParts(next);
    const caret = promptCaretAtOffset(normalized, start + replacement.length);
    commit(normalized, caret);
    setMention(undefined);
  };

  const removeAsset = (key: string) => {
    const index = parts.findIndex((part) => part.key === key);
    if (index < 0) return;
    const before = parts[index - 1];
    commit(
      parts.filter((part) => part.key !== key),
      before?.type === "text"
        ? { key: before.key, offset: before.text.length }
        : undefined,
    );
  };

  const selectAsset = (file: ManagedFile) => {
    if (!mention) return;
    const index = parts.findIndex((part) => part.key === mention.key);
    const current = parts[index];
    if (current?.type !== "text") return;
    const before = { ...current, text: current.text.slice(0, mention.start) };
    const after = promptTextPart(current.text.slice(mention.offset));
    commit(
      [
        ...parts.slice(0, index),
        before,
        promptAssetPart(file),
        after,
        ...parts.slice(index + 1),
      ],
      { key: after.key, offset: 0 },
    );
    setMention(undefined);
  };

  const syncFromDom = () => {
    const root = editorRef.current;
    if (!root) return;
    const known = new Map(
      [
        ...assets,
        ...parts.flatMap((part) => (part.type === "asset" ? [part.file] : [])),
      ].map((file) => [file.id, file]),
    );
    const next: PromptPart[] = [];
    for (const node of [...root.childNodes]) {
      if (node instanceof HTMLElement && node.dataset.assetId) {
        const file = known.get(node.dataset.assetId);
        if (file)
          next.push({
            key: node.dataset.partKey || promptKey("asset"),
            type: "asset",
            file,
          });
        continue;
      }
      let element = node instanceof HTMLElement ? node : undefined;
      if (!element) {
        element = document.createElement("span");
        element.dataset.promptText = "";
        element.dataset.partKey = promptKey("text");
        root.insertBefore(element, node);
        element.append(node);
      } else if (!element.dataset.partKey) {
        element.dataset.promptText = "";
        element.dataset.partKey = promptKey("text");
      }
      next.push({
        key: element.dataset.partKey,
        type: "text",
        text: (node.textContent || "").replaceAll(EMPTY_PROMPT_TEXT, ""),
      });
    }
    const caret = promptCaret(root);
    if (caret) lastCaret.current = caret;
    const normalized = normalizePromptParts(next);
    const projected = promptProjection(normalized);
    if (projected.length > 6000) {
      pendingDomSync.current = true;
      if (caret) pendingCaret.current = caret;
      setParts((current) => [...current]);
      return;
    }
    setParts(normalized);
    onChange(projected);
    setMention(promptMentionAtCaret(normalized, caret) ?? undefined);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    rememberCaret();
    const root = editorRef.current;
    const selection = root ? promptSelection(root, parts) : null;
    if (
      !composing.current &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      if (selection && selection.start !== selection.end) {
        event.preventDefault();
        replaceSelection(selection, event.key);
        return;
      }
      const caret = lastCaret.current;
      const textElement = caret
        ? [
            ...(editorRef.current?.querySelectorAll<HTMLElement>(
              "[data-prompt-text]",
            ) ?? []),
          ].find((element) => element.dataset.partKey === caret.key)
        : undefined;
      if (caret && textElement) {
        const text = (textElement.textContent || "").replaceAll(
          EMPTY_PROMPT_TEXT,
          "",
        );
        const nextText =
          text.slice(0, caret.offset) + event.key + text.slice(caret.offset);
        placeMentionMenu();
        setMention(
          promptMentionAtCaret(
            [{ key: caret.key, type: "text", text: nextText }],
            { key: caret.key, offset: caret.offset + event.key.length },
          ) ?? undefined,
        );
      }
    }
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
        const file = options[activeOption];
        if (file) selectAsset(file);
        return;
      }
    }
    if (event.key === "Escape" && mention) {
      event.preventDefault();
      setMention(undefined);
      return;
    }
    if (event.key === "Enter" && !composing.current) {
      event.preventDefault();
      if (selection && selection.start !== selection.end)
        replaceSelection(selection, "\n");
      else insertText("\n");
      return;
    }
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    if (composing.current || event.nativeEvent.isComposing) return;
    if (!selection) return;
    let { start, end } = selection;
    if (start === end) {
      if (event.key === "Backspace" && start > 0) start -= 1;
      if (event.key === "Delete" && end < promptProjection(parts).length)
        end += 1;
    }
    if (start === end) return;
    event.preventDefault();
    replaceSelection({ start, end });
  };

  return (
    <div className="generation-prompt-editor-shell">
      <div
        ref={editorRef}
        className="generation-prompt-editor"
        role="textbox"
        aria-label={label}
        aria-multiline="true"
        aria-autocomplete="list"
        aria-expanded={Boolean(mention)}
        data-empty={!promptProjection(parts).length}
        data-placeholder={placeholder}
        contentEditable
        suppressContentEditableWarning
        onInput={syncFromDom}
        onKeyDown={handleKeyDown}
        onKeyUp={rememberCaret}
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
          const selection = editorRef.current
            ? promptSelection(editorRef.current, parts)
            : null;
          const text = event.clipboardData.getData("text/plain");
          if (selection && selection.start !== selection.end)
            replaceSelection(selection, text);
          else insertText(text);
        }}
        onCut={(event) => {
          const selection = editorRef.current
            ? promptSelection(editorRef.current, parts)
            : null;
          if (!selection || selection.start === selection.end) return;
          event.preventDefault();
          event.clipboardData.setData(
            "text/plain",
            window.getSelection()?.toString() ?? "",
          );
          replaceSelection(selection);
        }}
        onClick={(event) => {
          const target =
            event.target instanceof Element
              ? event.target.closest<HTMLButtonElement>(
                  "[data-remove-prompt-asset]",
                )
              : null;
          const key = target?.dataset.removePromptAsset;
          if (key) removeAsset(key);
        }}
      />
      <small>{promptProjection(parts).length}/6000</small>
      {mention ? (
        <div
          className="generation-prompt-mention-menu"
          role="listbox"
          aria-label="引用已选素材"
          style={{ top: mentionTop }}
        >
          {options.length ? (
            options.map((file, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === activeOption}
                key={file.id}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectAsset(file);
                }}
                onMouseEnter={() => setActiveOption(index)}
              >
                <span className="generation-prompt-option-preview">
                  <MediaPreview file={file} />
                </span>
                <span>
                  <strong>{file.display_name}</strong>
                  <small>
                    {file.media_kind === "image"
                      ? "图片"
                      : file.media_kind === "video"
                        ? "视频"
                        : file.media_kind === "audio"
                          ? "音频"
                          : "文档"}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <span>{assets.length ? "没有匹配素材" : "请先在上方添加素材"}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ProjectMediaPicker({
  projectId,
  label,
  kind = "image",
  value,
  multiple = false,
  max = 1,
  minimal = false,
  onChange,
  onFilesLoaded,
}: {
  projectId: string;
  label: string;
  kind?: Extract<MediaKind, "image" | "video" | "audio">;
  value: string[];
  multiple?: boolean;
  max?: number;
  minimal?: boolean;
  onChange: (value: string[]) => void;
  onFilesLoaded?: (files: ManagedFile[]) => void;
}) {
  const client = useQueryClient();
  const uploadInput = useRef<HTMLInputElement>(null);
  const folders = useQuery({
    queryKey: ["file-folders", projectId],
    queryFn: () => getFolders(projectId),
  });
  const folderIds = useMemo(
    () => [undefined, ...(folders.data?.items.map((item) => item.id) ?? [])],
    [folders.data],
  );
  const fileQueries = useQueries({
    queries: folderIds.map((folderId) => ({
      queryKey: ["files", projectId, folderId ?? "root", kind, true],
      queryFn: () =>
        getFiles({
          projectId,
          folderId,
          mediaKind: kind,
          includeReferences: true,
        }),
      enabled: !folders.isLoading,
    })),
  });
  const files = useMemo(() => {
    const unique = new Map<string, ManagedFile>();
    fileQueries.forEach((query) =>
      query.data?.items.forEach((file) => unique.set(file.id, file)),
    );
    return [...unique.values()].sort((left, right) =>
      left.display_name.localeCompare(right.display_name, "zh-CN"),
    );
  }, [fileQueries]);
  useEffect(() => onFilesLoaded?.(files), [files, onFilesLoaded]);
  const upload = useMutation({
    mutationFn: async (selected: File[]) => {
      const uploaded: ManagedFile[] = [];
      for (const file of selected)
        uploaded.push(await uploadManagedFile(file, projectId));
      return uploaded;
    },
    onSuccess: (uploaded) => {
      void client.invalidateQueries({ queryKey: ["files", projectId] });
      onFilesLoaded?.(uploaded);
      const ids = uploaded
        .filter((file) => file.media_kind === kind)
        .map((file) => file.id);
      onChange(
        multiple
          ? [...new Set([...value, ...ids])].slice(0, max)
          : ids.slice(-1),
      );
    },
  });
  const loading =
    folders.isLoading || fileQueries.some((query) => query.isLoading);
  const visibleFiles = minimal
    ? files.filter((file) => value.includes(file.id))
    : files;
  const UploadIcon =
    kind === "video" ? Video : kind === "audio" ? Music : Image;
  const uploadButton = (
    <button
      type="button"
      className="generation-media-upload"
      aria-label={`上传${label}`}
      title={`上传${label}`}
      disabled={upload.isPending || (multiple && value.length >= max)}
      onClick={() => uploadInput.current?.click()}
    >
      {upload.isPending ? (
        <LoaderCircle className="spinning" aria-hidden />
      ) : minimal ? (
        <UploadIcon aria-hidden />
      ) : (
        <Upload aria-hidden />
      )}
      <span className={minimal ? "sr-only" : undefined}>
        {upload.isPending ? "上传中" : "上传"}
      </span>
    </button>
  );

  return (
    <fieldset
      className={`generation-image-picker${minimal ? " is-minimal" : ""}`}
    >
      <legend className={minimal ? "sr-only" : undefined}>{label}</legend>
      <input
        ref={uploadInput}
        hidden
        type="file"
        multiple={multiple}
        accept={MEDIA_ACCEPT[kind]}
        onChange={(event) => {
          const remaining = Math.max(0, max - (multiple ? value.length : 0));
          const selected = [...(event.target.files ?? [])].slice(
            0,
            multiple ? remaining : 1,
          );
          if (selected.length) upload.mutate(selected);
          event.currentTarget.value = "";
        }}
      />
      {loading ? (
        <span className="generation-picker-state">
          <LoaderCircle className="spinning" aria-hidden />
          {minimal ? null : "正在读取项目素材…"}
        </span>
      ) : (
        <div className="generation-image-options">
          {minimal ? null : uploadButton}
          {visibleFiles.map((file) => {
            const selected = value.includes(file.id);
            return (
              <button
                type="button"
                className={selected ? "selected" : ""}
                aria-pressed={selected}
                aria-label={file.display_name}
                title={file.display_name}
                key={file.id}
                onClick={() => {
                  if (!multiple) {
                    onChange(selected ? [] : [file.id]);
                    return;
                  }
                  if (selected)
                    onChange(value.filter((item) => item !== file.id));
                  else if (value.length < max) onChange([...value, file.id]);
                }}
              >
                <span className="generation-media-preview">
                  <MediaPreview file={file} />
                </span>
                {minimal ? null : <span>{file.display_name}</span>}
                {!minimal && selected ? <Check aria-hidden /> : null}
              </button>
            );
          })}
          {minimal ? uploadButton : null}
        </div>
      )}
      {multiple && !minimal ? (
        <small>
          已选 {value.length}/{max}
        </small>
      ) : null}
      {upload.isError ? (
        <small className="generation-picker-error" role="alert">
          {errorMessage(upload.error)}
        </small>
      ) : null}
    </fieldset>
  );
}

export function GenerationDrawer({
  projectId,
  onClose,
  lockedKind,
  onTaskCreated,
  compact = false,
}: {
  projectId: string;
  onClose: () => void;
  lockedKind?: GenerationKind;
  onTaskCreated?: (
    task: Awaited<ReturnType<typeof createGenerationTask>>,
  ) => void;
  compact?: boolean;
}) {
  const client = useQueryClient();
  const [kind, setKind] = useState<GenerationKind>(lockedKind ?? "image");
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [seed, setSeed] = useState("");
  const [imageCount, setImageCount] = useState(1);
  const [imageReference, setImageReference] = useState<string[]>([]);
  const [videoMode, setVideoMode] = useState<VideoMode>("text");
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState<"480p" | "720p" | "1080p">(
    "720p",
  );
  const [ratio, setRatio] = useState<"16:9" | "9:16" | "4:3" | "3:4" | "1:1">(
    "16:9",
  );
  const [watermark, setWatermark] = useState(true);
  const [generateAudio, setGenerateAudio] = useState(false);
  const [firstFrame, setFirstFrame] = useState<string[]>([]);
  const [lastFrame, setLastFrame] = useState<string[]>([]);
  const [references, setReferences] = useState<string[]>([]);
  const [audioReferences, setAudioReferences] = useState<string[]>([]);
  const [videoReferences, setVideoReferences] = useState<string[]>([]);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [notice, setNotice] = useState("");
  const [promptFiles, setPromptFiles] = useState<Record<string, ManagedFile>>(
    {},
  );
  const modelMenuRef = useRef<HTMLDetailsElement>(null);
  const rememberPromptFiles = useCallback((files: ManagedFile[]) => {
    setPromptFiles((current) => {
      let changed = false;
      const next = { ...current };
      files.forEach((file) => {
        if (next[file.id] !== file) {
          next[file.id] = file;
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, []);
  const selectedPromptAssetIds = useMemo(() => {
    if (kind === "image") return imageReference;
    if (videoMode === "image") return firstFrame;
    if (videoMode === "frames") return [...firstFrame, ...lastFrame];
    if (videoMode === "reference")
      return [...references, ...videoReferences, ...audioReferences];
    return [];
  }, [
    audioReferences,
    firstFrame,
    imageReference,
    kind,
    lastFrame,
    references,
    videoMode,
    videoReferences,
  ]);
  const promptAssets = [...new Set(selectedPromptAssetIds)].flatMap((id) =>
    promptFiles[id] ? [promptFiles[id]] : [],
  );
  const options = useQuery({
    queryKey: ["visual-generation-options"],
    queryFn: getGenerationOptions,
  });
  const models = (options.data?.models ?? []).filter(
    (model) => model.kind === kind,
  );
  const selectedModel = models.find((model) => model.id === modelId);
  const availableImageSizes = useMemo(
    () => imageSizeChoices(selectedModel?.sizes ?? []),
    [selectedModel?.sizes],
  );
  const selectedImageSize =
    availableImageSizes.find((option) => option.value === size) ??
    availableImageSizes[0];

  useEffect(() => {
    const preferred = models.find((model) =>
      kind === "image"
        ? model.slug === "senseaudio-image-2.0-260319"
        : model.slug === "doubao-seedance-2-0-260128",
    );
    if (!models.some((model) => model.id === modelId))
      setModelId(preferred?.id ?? models[0]?.id ?? "");
  }, [kind, modelId, models]);
  useEffect(() => {
    if (
      kind === "image" &&
      selectedModel?.sizes?.length &&
      !selectedModel.sizes.includes(size)
    )
      setSize(
        selectedModel.sizes.includes("1024x1024")
          ? "1024x1024"
          : selectedModel.sizes[0],
      );
  }, [kind, selectedModel, size]);

  const createMutation = useMutation({
    mutationFn: async ({
      body,
      count = 1,
    }: {
      body: GenerationTaskInput;
      count?: number;
    }) => {
      const tasks = [];
      for (let index = 0; index < count; index += 1) {
        tasks.push(await createGenerationTask(projectId, body));
      }
      return tasks;
    },
    onSuccess: (tasks) => {
      const task = tasks[0];
      if (!task) return;
      setNotice(
        tasks.length === 1
          ? `任务已提交（${task.id.slice(0, 8)}），可在“生成任务”页查看进度。`
          : `已提交 ${tasks.length} 个生成任务，第一个结果将自动绑定当前节点。`,
      );
      void client.invalidateQueries({ queryKey: ["visual-generation-tasks"] });
      onTaskCreated?.(task);
    },
    onError: (error) => setNotice(errorMessage(error)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice("");
    if (!modelId) {
      setNotice("请先在模型服务中启用对应的 SenseAudio 供应商和模型。");
      return;
    }
    if ((kind === "image" || videoMode === "text") && !prompt.trim()) {
      setNotice("请输入生成提示词。");
      return;
    }
    if (
      kind === "video" &&
      videoMode === "reference" &&
      audioReferences.length > 0 &&
      references.length === 0 &&
      videoReferences.length === 0
    ) {
      setNotice("参考音频需要搭配至少一张图片或一个视频。");
      return;
    }
    if (kind === "image") {
      createMutation.mutate({
        body: {
          kind: "image",
          model_id: modelId,
          prompt,
          size,
          seed: seed === "" ? null : Number(seed),
          reference_asset_id: imageReference[0] ?? null,
        },
        count: imageCount,
      });
      return;
    }
    createMutation.mutate({
      body: {
        kind: "video",
        model_id: modelId,
        prompt,
        mode: videoMode === "image" ? "frames" : videoMode,
        duration,
        resolution,
        ratio,
        watermark,
        generate_audio: generateAudio,
        first_frame_asset_id:
          videoMode === "frames" || videoMode === "image"
            ? (firstFrame[0] ?? null)
            : null,
        last_frame_asset_id:
          videoMode === "frames" ? (lastFrame[0] ?? null) : null,
        reference_asset_ids: videoMode === "reference" ? references : [],
        audio_asset_ids: videoMode === "reference" ? audioReferences : [],
        video_asset_ids: videoMode === "reference" ? videoReferences : [],
      },
    });
  };

  if (compact && lockedKind === "image") {
    return (
      <aside
        className={`canvas-generation-drawer is-compact image-node-composer${composerExpanded ? " is-expanded" : ""}`}
        aria-label="节点 AI 生成"
      >
        <form className="video-node-composer-form" onSubmit={submit}>
          <div className="image-composer-body">
            <div className="image-composer-tools">
              <ProjectMediaPicker
                projectId={projectId}
                label="参考图片（可选）"
                minimal
                value={imageReference}
                onChange={setImageReference}
                onFilesLoaded={rememberPromptFiles}
              />
              <button
                type="button"
                className="video-composer-close"
                aria-label={
                  composerExpanded ? "收起图片生成器" : "展开图片生成器"
                }
                title={composerExpanded ? "收起" : "展开"}
                onClick={() => setComposerExpanded((current) => !current)}
              >
                {composerExpanded ? (
                  <Minimize2 aria-hidden />
                ) : (
                  <Maximize2 aria-hidden />
                )}
              </button>
            </div>
            <div className="video-composer-prompt image-composer-prompt">
              <GenerationPromptEditor
                value={prompt}
                assets={promptAssets}
                label="图片提示词"
                placeholder="描述你想生成的画面…"
                onChange={setPrompt}
              />
            </div>
          </div>

          {notice ? (
            <div
              className="generation-notice video-composer-notice"
              role="status"
            >
              {notice}
            </div>
          ) : null}

          <footer className="video-composer-footer image-composer-footer">
            <span className="video-composer-kind">
              <Image aria-hidden />
              图片生成
            </span>
            <details
              className="video-composer-model"
              ref={modelMenuRef}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  event.currentTarget.removeAttribute("open");
              }}
            >
              <summary
                role="button"
                aria-label="生成模型"
                aria-disabled={options.isLoading || models.length === 0}
                onClick={(event) => {
                  if (options.isLoading || models.length === 0)
                    event.preventDefault();
                }}
              >
                <span>{selectedModel?.label ?? "暂无可用模型"}</span>
                <ChevronDown aria-hidden />
              </summary>
              <div className="video-model-menu" role="listbox">
                {models.map((model) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={model.id === modelId}
                    key={model.id}
                    onClick={() => {
                      setModelId(model.id);
                      modelMenuRef.current?.removeAttribute("open");
                    }}
                  >
                    {model.id === modelId ? <Check aria-hidden /> : <span />}
                    {model.label}
                  </button>
                ))}
              </div>
            </details>
            <details className="video-composer-parameters image-composer-parameters">
              <summary role="button" aria-label="图片参数">
                <span
                  className="image-parameter-summary-icon"
                  aria-hidden="true"
                />
                {selectedImageSize
                  ? `${selectedImageSize.ratio} / ${selectedImageSize.clarity}`
                  : "选择尺寸"}
                <ChevronDown aria-hidden />
              </summary>
              <div className="image-parameter-popover">
                <fieldset className="image-ratio-options">
                  <legend>比例</legend>
                  <div role="group" aria-label="图片比例">
                    {IMAGE_RATIO_OPTIONS.map((option) => {
                      const choices = availableImageSizes.filter(
                        (choice) => choice.ratio === option.label,
                      );
                      const available = choices.length > 0;
                      const selected =
                        selectedImageSize?.ratio === option.label;
                      return (
                        <button
                          type="button"
                          aria-label={`比例 ${option.label}`}
                          aria-pressed={selected}
                          disabled={!available}
                          key={option.label}
                          onClick={() => {
                            const next =
                              choices.find(
                                (choice) =>
                                  choice.clarity === selectedImageSize?.clarity,
                              ) ?? choices[0];
                            if (next) setSize(next.value);
                          }}
                        >
                          <span className="image-ratio-icon-shell">
                            <span style={imageRatioIconStyle(option)} />
                          </span>
                          <span>{option.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                <fieldset className="image-clarity-options">
                  <legend>清晰度</legend>
                  <div role="group" aria-label="图片清晰度">
                    {IMAGE_CLARITY_OPTIONS.map((clarity) => {
                      const next = availableImageSizes.find(
                        (choice) =>
                          choice.ratio === selectedImageSize?.ratio &&
                          choice.clarity === clarity,
                      );
                      return (
                        <button
                          type="button"
                          aria-label={`清晰度 ${clarity}`}
                          aria-pressed={selectedImageSize?.clarity === clarity}
                          disabled={!next}
                          key={clarity}
                          onClick={() => {
                            if (next) setSize(next.value);
                          }}
                        >
                          {clarity}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                <label className="image-seed-control">
                  <span>种子（可选）</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="随机"
                    value={seed}
                    onChange={(event) => setSeed(event.target.value)}
                  />
                </label>
              </div>
            </details>
            <details className="image-composer-count">
              <summary role="button" aria-label="生成数量">
                ×{imageCount}
                <ChevronDown aria-hidden />
              </summary>
              <div role="listbox" aria-label="选择生成数量">
                {[1, 2, 3, 4].map((count) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={imageCount === count}
                    key={count}
                    onClick={(event) => {
                      setImageCount(count);
                      event.currentTarget
                        .closest("details")
                        ?.removeAttribute("open");
                    }}
                  >
                    ×{count}
                    {imageCount === count ? <Check aria-hidden /> : null}
                  </button>
                ))}
              </div>
            </details>
            <button
              className="video-composer-submit"
              disabled={createMutation.isPending || !modelId || !prompt.trim()}
              type="submit"
              aria-label={createMutation.isPending ? "正在提交" : "生成图片"}
            >
              {createMutation.isPending ? (
                <LoaderCircle className="spinning" aria-hidden />
              ) : (
                <ArrowUp aria-hidden />
              )}
            </button>
          </footer>
        </form>
      </aside>
    );
  }

  if (compact && lockedKind === "video") {
    const modeLabels: Array<{ value: VideoMode; label: string }> = [
      { value: "text", label: "文生视频" },
      { value: "image", label: "图生视频" },
      { value: "frames", label: "首尾帧" },
      { value: "reference", label: "全能参考" },
    ];
    return (
      <aside
        className={`canvas-generation-drawer is-compact video-node-composer${composerExpanded ? " is-expanded" : ""}`}
        aria-label="节点 AI 生成"
      >
        <form className="video-node-composer-form" onSubmit={submit}>
          <header className="video-composer-header">
            <nav aria-label="视频生成方式">
              {modeLabels.map((mode) => (
                <button
                  type="button"
                  className={videoMode === mode.value ? "active" : ""}
                  aria-pressed={videoMode === mode.value}
                  key={mode.value}
                  onClick={() => setVideoMode(mode.value)}
                >
                  {mode.label}
                </button>
              ))}
            </nav>
            <button
              type="button"
              className="video-composer-close"
              aria-label={
                composerExpanded ? "收起视频生成器" : "展开视频生成器"
              }
              title={composerExpanded ? "收起" : "展开"}
              onClick={() => setComposerExpanded((current) => !current)}
            >
              {composerExpanded ? (
                <Minimize2 aria-hidden />
              ) : (
                <Maximize2 aria-hidden />
              )}
            </button>
          </header>

          <div className="video-composer-body">
            {videoMode !== "text" ? (
              <div className="video-composer-reference">
                {videoMode === "image" ? (
                  <ProjectMediaPicker
                    projectId={projectId}
                    label="选择起始画面"
                    minimal
                    value={firstFrame}
                    onChange={setFirstFrame}
                    onFilesLoaded={rememberPromptFiles}
                  />
                ) : null}
                {videoMode === "frames" ? (
                  <>
                    <ProjectMediaPicker
                      projectId={projectId}
                      label="首帧"
                      minimal
                      value={firstFrame}
                      onChange={setFirstFrame}
                      onFilesLoaded={rememberPromptFiles}
                    />
                    <ProjectMediaPicker
                      projectId={projectId}
                      label="尾帧（可选）"
                      minimal
                      value={lastFrame}
                      onChange={setLastFrame}
                      onFilesLoaded={rememberPromptFiles}
                    />
                  </>
                ) : null}
                {videoMode === "reference" ? (
                  <>
                    <ProjectMediaPicker
                      projectId={projectId}
                      label="参考图片"
                      minimal
                      value={references}
                      multiple
                      max={9}
                      onChange={setReferences}
                      onFilesLoaded={rememberPromptFiles}
                    />
                    <ProjectMediaPicker
                      projectId={projectId}
                      label="参考视频"
                      kind="video"
                      minimal
                      value={videoReferences}
                      multiple
                      max={3}
                      onChange={setVideoReferences}
                      onFilesLoaded={rememberPromptFiles}
                    />
                    <ProjectMediaPicker
                      projectId={projectId}
                      label="参考音频"
                      kind="audio"
                      minimal
                      value={audioReferences}
                      multiple
                      max={3}
                      onChange={setAudioReferences}
                      onFilesLoaded={rememberPromptFiles}
                    />
                  </>
                ) : null}
              </div>
            ) : null}
            <div className="video-composer-prompt">
              <GenerationPromptEditor
                value={prompt}
                assets={promptAssets}
                label="视频提示词"
                placeholder="描述您的修改或生成需求…"
                onChange={setPrompt}
              />
            </div>
          </div>

          {notice ? (
            <div
              className="generation-notice video-composer-notice"
              role="status"
            >
              {notice}
            </div>
          ) : null}

          <footer className="video-composer-footer">
            <span className="video-composer-kind">
              <Video aria-hidden />
              视频生成
            </span>
            <details
              className="video-composer-model"
              ref={modelMenuRef}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  event.currentTarget.removeAttribute("open");
              }}
            >
              <summary
                role="button"
                aria-label="生成模型"
                aria-disabled={options.isLoading || models.length === 0}
                onClick={(event) => {
                  if (options.isLoading || models.length === 0)
                    event.preventDefault();
                }}
              >
                <span>{selectedModel?.label ?? "暂无可用模型"}</span>
                <ChevronDown aria-hidden />
              </summary>
              <div className="video-model-menu" role="listbox">
                {models.map((model) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={model.id === modelId}
                    key={model.id}
                    onClick={() => {
                      setModelId(model.id);
                      modelMenuRef.current?.removeAttribute("open");
                    }}
                  >
                    {model.id === modelId ? <Check aria-hidden /> : <span />}
                    {model.label}
                  </button>
                ))}
              </div>
            </details>
            <details className="video-composer-parameters">
              <summary>
                <Settings2 aria-hidden />
                {ratio} · {duration}S · {resolution.toUpperCase()}
                <ChevronDown aria-hidden />
              </summary>
              <div className="video-parameter-popover">
                <label className="video-duration-control">
                  <span className="video-duration-head">
                    <span>时长</span>
                    <output>{duration} 秒</output>
                  </span>
                  <input
                    type="range"
                    aria-label="时长"
                    min="4"
                    max="15"
                    step="1"
                    value={duration}
                    style={
                      {
                        "--video-duration-progress": `${((duration - 4) / 11) * 100}%`,
                      } as CSSProperties
                    }
                    onChange={(event) =>
                      setDuration(Number(event.target.value))
                    }
                  />
                  <span className="video-duration-limits" aria-hidden="true">
                    <span>4 秒</span>
                    <span>15 秒</span>
                  </span>
                </label>
                <label>
                  <span>画面比例</span>
                  <CustomSelect
                    ariaLabel="画面比例"
                    className="video-parameter-select"
                    value={ratio}
                    options={VIDEO_RATIO_OPTIONS}
                    onChange={(value) => setRatio(value as typeof ratio)}
                  />
                </label>
                <label>
                  <span>清晰度</span>
                  <CustomSelect
                    ariaLabel="清晰度"
                    className="video-parameter-select"
                    value={resolution}
                    options={VIDEO_RESOLUTION_OPTIONS}
                    onChange={(value) =>
                      setResolution(value as typeof resolution)
                    }
                  />
                </label>
                <div className="video-parameter-switches">
                  <label>
                    <input
                      type="checkbox"
                      checked={generateAudio}
                      onChange={(event) =>
                        setGenerateAudio(event.target.checked)
                      }
                    />
                    生成音频
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={watermark}
                      onChange={(event) => setWatermark(event.target.checked)}
                    />
                    保留水印
                  </label>
                </div>
              </div>
            </details>
            <button
              className="video-composer-submit"
              disabled={
                createMutation.isPending ||
                !modelId ||
                (videoMode === "text" && !prompt.trim())
              }
              type="submit"
              aria-label={createMutation.isPending ? "正在提交" : "生成视频"}
            >
              {createMutation.isPending ? (
                <LoaderCircle className="spinning" aria-hidden />
              ) : (
                <ArrowUp aria-hidden />
              )}
            </button>
          </footer>
        </form>
      </aside>
    );
  }

  return (
    <aside
      className={`canvas-generation-drawer${compact ? " is-compact" : ""}`}
      aria-label={lockedKind ? "节点 AI 生成" : "AI 生成"}
    >
      <header>
        <div>
          <strong>AI 生成</strong>
          <small>由 SenseAudio 异步生成，完成后自动进入素材库</small>
        </div>
        <button aria-label="关闭 AI 生成" onClick={onClose}>
          <X aria-hidden />
        </button>
      </header>
      {!lockedKind ? (
        <div className="generation-kind-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={kind === "image"}
            className={kind === "image" ? "active" : ""}
            onClick={() => setKind("image")}
          >
            <Image aria-hidden /> 图片
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === "video"}
            className={kind === "video" ? "active" : ""}
            onClick={() => setKind("video")}
          >
            <Video aria-hidden /> 视频
          </button>
        </div>
      ) : null}
      <form className="generation-form" onSubmit={submit}>
        <label>
          <span>模型</span>
          <select
            aria-label="生成模型"
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            disabled={options.isLoading}
          >
            {!models.length ? <option value="">暂无可用模型</option> : null}
            {models.map((model) => (
              <option value={model.id} key={model.id}>
                {model.label}
              </option>
            ))}
          </select>
          {selectedModel?.description ? (
            <small>{selectedModel.description}</small>
          ) : null}
        </label>
        <div className="generation-form-prompt">
          <span>提示词</span>
          <GenerationPromptEditor
            value={prompt}
            assets={promptAssets}
            label={kind === "image" ? "图片提示词" : "视频提示词"}
            placeholder={
              kind === "image" ? "描述要生成的画面…" : "描述镜头、动作和氛围…"
            }
            onChange={setPrompt}
          />
        </div>
        {kind === "image" ? (
          <>
            <div className="generation-form-grid">
              <label>
                <span>尺寸</span>
                <select
                  value={size}
                  onChange={(event) => setSize(event.target.value)}
                >
                  {(selectedModel?.sizes ?? []).map((option) => (
                    <option value={option} key={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>种子（可选）</span>
                <input
                  type="number"
                  min="0"
                  placeholder="随机"
                  value={seed}
                  onChange={(event) => setSeed(event.target.value)}
                />
              </label>
            </div>
            <ProjectMediaPicker
              projectId={projectId}
              label="参考图片（可选）"
              value={imageReference}
              onChange={setImageReference}
              onFilesLoaded={rememberPromptFiles}
            />
          </>
        ) : (
          <>
            <div className="generation-form-grid generation-form-grid-three">
              <label>
                <span>时长</span>
                <select
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                >
                  {Array.from({ length: 12 }, (_, index) => index + 4).map(
                    (value) => (
                      <option value={value} key={value}>
                        {value} 秒
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                <span>分辨率</span>
                <select
                  value={resolution}
                  onChange={(event) =>
                    setResolution(event.target.value as typeof resolution)
                  }
                >
                  <option value="480p">480p</option>
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </select>
              </label>
              <label>
                <span>比例</span>
                <select
                  value={ratio}
                  onChange={(event) =>
                    setRatio(event.target.value as typeof ratio)
                  }
                >
                  {(["16:9", "9:16", "4:3", "3:4", "1:1"] as const).map(
                    (value) => (
                      <option value={value} key={value}>
                        {value}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </div>
            <fieldset className="generation-mode-options">
              <legend>输入方式</legend>
              {(["text", "image", "frames", "reference"] as const).map(
                (value) => (
                  <button
                    type="button"
                    className={videoMode === value ? "selected" : ""}
                    aria-pressed={videoMode === value}
                    key={value}
                    onClick={() => setVideoMode(value)}
                  >
                    {value === "text"
                      ? "纯文本"
                      : value === "image"
                        ? "图生视频"
                        : value === "frames"
                          ? "首尾帧"
                          : "参考素材"}
                  </button>
                ),
              )}
            </fieldset>
            {videoMode === "image" ? (
              <ProjectMediaPicker
                projectId={projectId}
                label="起始画面（必选）"
                value={firstFrame}
                onChange={setFirstFrame}
                onFilesLoaded={rememberPromptFiles}
              />
            ) : null}
            {videoMode === "frames" ? (
              <>
                <ProjectMediaPicker
                  projectId={projectId}
                  label="首帧（必选）"
                  value={firstFrame}
                  onChange={setFirstFrame}
                  onFilesLoaded={rememberPromptFiles}
                />
                <ProjectMediaPicker
                  projectId={projectId}
                  label="尾帧（可选）"
                  value={lastFrame}
                  onChange={setLastFrame}
                  onFilesLoaded={rememberPromptFiles}
                />
              </>
            ) : null}
            {videoMode === "reference" ? (
              <>
                <ProjectMediaPicker
                  projectId={projectId}
                  label="参考图片"
                  value={references}
                  multiple
                  max={9}
                  onChange={setReferences}
                  onFilesLoaded={rememberPromptFiles}
                />
                <ProjectMediaPicker
                  projectId={projectId}
                  label="参考视频"
                  kind="video"
                  value={videoReferences}
                  multiple
                  max={3}
                  onChange={setVideoReferences}
                  onFilesLoaded={rememberPromptFiles}
                />
                <ProjectMediaPicker
                  projectId={projectId}
                  label="参考音频"
                  kind="audio"
                  value={audioReferences}
                  multiple
                  max={3}
                  onChange={setAudioReferences}
                  onFilesLoaded={rememberPromptFiles}
                />
              </>
            ) : null}
            <div className="generation-switches">
              <label>
                <input
                  type="checkbox"
                  checked={watermark}
                  onChange={(event) => setWatermark(event.target.checked)}
                />{" "}
                保留水印
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={generateAudio}
                  onChange={(event) => setGenerateAudio(event.target.checked)}
                />{" "}
                生成音频
              </label>
            </div>
          </>
        )}
        {notice ? (
          <div className="generation-notice" role="status">
            {notice}
          </div>
        ) : null}
        <button
          className="generation-submit"
          disabled={createMutation.isPending || !modelId}
          type="submit"
        >
          {createMutation.isPending ? (
            <LoaderCircle className="spinning" aria-hidden />
          ) : (
            <Sparkles aria-hidden />
          )}
          {createMutation.isPending ? "正在提交…" : "创建生成任务"}
        </button>
      </form>
    </aside>
  );
}
