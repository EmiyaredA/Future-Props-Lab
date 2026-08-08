import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, File, FileText, Film, Music, X } from "lucide-react";
import { fileQueryKeys, getFiles, type ManagedFile } from "@features/files";
import { fetchApiBlob } from "@platform/api/client";
import {
  EMPTY_EDITOR_TEXT,
  assetPart,
  attachmentSize,
  attachmentTypeLabel,
  caretInComposer,
  composerKey,
  composerText,
  isImage,
  mentionAtCaret,
  normalizeComposerParts,
  textPart,
  toSelected,
  uniqueComposerAttachments,
  type AssistantComposerHandle,
  type ComposerCaret,
  type ComposerPart,
  type ComposerTextPart,
  type MentionMatch,
  type SelectedAttachment,
} from "@features/visual-workshop/assistant/AssistantComposerModel";

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

export function AssistantAssetPreview({
  asset,
}: {
  asset: SelectedAttachment;
}) {
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

export const AssistantComposer = forwardRef<
  AssistantComposerHandle,
  {
    projectId: string;
    value: ComposerPart[];
    disabled: boolean;
    maxAttachments: number;
    onChange: (parts: ComposerPart[]) => void;
    onSubmit: () => void;
    onLimit: () => void;
  }
>(function AssistantComposer(
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
    queryKey: fileQueryKeys.list({
      projectId,
      query: mention?.query ?? "",
      sort: "updated",
      includeReferences: true,
    }),
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
    const textElement = [
      ...root.querySelectorAll<HTMLElement>("[data-composer-text]"),
    ].find((element) => element.dataset.partKey === caret.key);
    if (!composing.current && textElement)
      setMention(
        mentionAtCaret(
          [
            {
              key: caret.key,
              type: "text",
              text: (textElement.textContent || "").replaceAll(
                EMPTY_EDITOR_TEXT,
                "",
              ),
            },
          ],
          caret,
        ) ?? undefined,
      );
  };

  const ensureCaret = () => {
    const root = editorRef.current;
    if (!root) return;
    const selection = window.getSelection();
    // Non-collapsed selection: leave highlight alone (caretInComposer only tracks caret).
    if (
      selection &&
      !selection.isCollapsed &&
      selection.anchorNode &&
      root.contains(selection.anchorNode)
    )
      return;
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
    let detectedMention = mentionAtCaret(normalized, caret) ?? undefined;
    if (!detectedMention) {
      const activeText = caret
        ? normalized.find(
            (part): part is ComposerTextPart =>
              part.type === "text" && part.key === caret.key,
          )
        : [...normalized]
            .reverse()
            .find((part): part is ComposerTextPart => part.type === "text");
      if (activeText && (!caret || activeText.text.length - caret.offset <= 1))
        detectedMention =
          mentionAtCaret(normalized, {
            key: activeText.key,
            offset: activeText.text.length,
          }) ?? undefined;
    }
    onChange(normalized);
    setMention(detectedMention);
    requestAnimationFrame(refreshMention);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    rememberCaret();
    if (
      !composing.current &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const caret = lastCaret.current;
      const root = editorRef.current;
      const textElement = caret
        ? [
            ...(root?.querySelectorAll<HTMLElement>("[data-composer-text]") ??
              []),
          ].find((element) => element.dataset.partKey === caret.key)
        : undefined;
      if (caret && textElement) {
        const text = (textElement.textContent || "").replaceAll(
          EMPTY_EDITOR_TEXT,
          "",
        );
        const nextText =
          text.slice(0, caret.offset) + event.key + text.slice(caret.offset);
        setMention(
          mentionAtCaret([{ key: caret.key, type: "text", text: nextText }], {
            key: caret.key,
            offset: caret.offset + event.key.length,
          }) ?? undefined,
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
                <AssistantAssetPreview asset={part.asset} />
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
                    <AssistantAssetPreview asset={attachment} />
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
