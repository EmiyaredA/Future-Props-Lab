import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import type { ManagedFile } from "@features/files";
import { useSelectPopover } from "@shared/ui/useSelectPopover";
import { ReadOnlyMedia } from "@shared/ui/ReadOnlyMedia";
import { GenerationMediaPreview } from "./GenerationMediaPreview";
import { promptPartsFromValue } from "./generationPromptModel";
import type {
  PromptReferenceSlots,
  PromptRenderDocument,
  PromptRenderToken,
} from "./promptRendering";

type SourceToken = PromptRenderToken & { sourceStart: number };

/** Collapse source-only blank lines without losing the offsets used by @. */
function displayLines(tokens: SourceToken[]) {
  const lines: SourceToken[][] = [[]];
  for (const token of tokens) {
    if (token.kind !== "text") {
      lines[lines.length - 1].push(token);
      continue;
    }
    let start = token.sourceStart;
    for (const part of token.text.split(/(\r\n|\r|\n)/)) {
      if (/^[\r\n]+$/.test(part)) lines.push([]);
      else if (part)
        lines[lines.length - 1].push({
          ...token,
          text: part,
          sourceStart: start,
        });
      start += part.length;
    }
  }
  return lines.filter((line) => line.some((token) => token.text.trim()));
}

function Reference({
  label,
  original,
  file,
  definition,
  kind,
  referenceId = label,
}: {
  label: string;
  original: string;
  file?: ManagedFile;
  definition?: string;
  kind?: string;
  referenceId?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  useSelectPopover(open, trigger, popup, 440, 320, "start");
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus({ preventScroll: true });
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  const content = (
    <>
      {file ? (
        <span className="prompt-reference-thumb">
          <GenerationMediaPreview file={file} thumbnailOnly />
        </span>
      ) : null}
      <span>{label}</span>
    </>
  );
  if (!file && !definition)
    return (
      <span
        className="prompt-reference is-unresolved"
        data-reference-kind={kind}
        title={`${original} · 未找到对应引用`}
      >
        {label}
      </span>
    );
  return (
    <span ref={root} className="prompt-reference-anchor">
      <button
        type="button"
        ref={trigger}
        className="prompt-reference"
        data-reference-kind={kind ?? file?.media_kind}
        title={file?.display_name ?? definition}
        aria-label={`查看${referenceId}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {content}
      </button>
      {open && (
        <div
          ref={popup}
          popover="manual"
          id={id}
          role="dialog"
          aria-label={`${referenceId}预览`}
          className="prompt-reference-popover"
          onBlur={(event) => {
            if (!root.current?.contains(event.relatedTarget as Node))
              setOpen(false);
          }}
        >
          <header>
            <strong>{label}</strong>
            <button
              ref={closeButton}
              type="button"
              aria-label="关闭素材预览"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <X size={15} aria-hidden />
            </button>
          </header>
          {file ? (
            <>
              <ReadOnlyMedia
                path={`/v1/files/${encodeURIComponent(file.id)}/content`}
                kind={file.media_kind}
                name={file.display_name}
              />
              <small>{file.display_name}</small>
            </>
          ) : (
            <>
              <p>{definition}</p>
            </>
          )}
        </div>
      )}
    </span>
  );
}

const referenceLabels = { picture: "图片", video: "视频", audio: "音频" };

export function PromptRenderedContent({
  document,
  assets,
  referenceSlots,
  caret,
}: {
  document: PromptRenderDocument;
  assets: ManagedFile[];
  referenceSlots?: PromptReferenceSlots;
  caret?: number;
}) {
  const definitions = new Map<string, string>();
  const subjects = document.sections.find(
    (section) => section.field === "subject_definitions",
  );
  const subjectText =
    subjects?.blocks
      .flatMap((block) => block.tokens.map((token) => token.text))
      .join("") ?? "";
  for (const match of subjectText.matchAll(
    /^\s*(<Subject [1-9]\d*>)([^\r\n]*)/gm,
  ))
    definitions.set(match[1], match[2].trim());
  const renderToken = (token: SourceToken): ReactNode => {
    if (token.kind === "text") return token.text || "\u200b";
    if (
      token.kind === "picture" ||
      token.kind === "video" ||
      token.kind === "audio"
    ) {
      const index = Number(token.text.match(/\d+/)?.[0]);
      const slot = referenceSlots?.[token.kind]?.[index - 1];
      const kind = token.kind === "picture" ? "image" : token.kind;
      const file = slot
        ? assets.find((item) => item.id === slot && item.media_kind === kind)
        : undefined;
      return (
        <Reference
          label={`${referenceLabels[token.kind]}${index}`}
          original={token.text}
          file={file}
          kind={kind}
        />
      );
    }
    if (token.kind === "subject") {
      const definition = definitions.get(token.text);
      return (
        <Reference
          label={`主体${token.text.match(/\d+/)?.[0]}`}
          referenceId={`主体${token.text.match(/\d+/)?.[0]}`}
          kind="subject"
          original={token.text}
          definition={definition}
        />
      );
    }
    if (token.kind === "dialogue") {
      let position = token.sourceStart;
      return (
        <span className="prompt-render-dialogue" aria-label="对白或歌词">
          {token.children?.map((child, i) => {
            const rendered = mappedToken(
              { ...child, sourceStart: position },
              true,
            );
            position += child.text.length;
            return <Fragment key={i}>{rendered}</Fragment>;
          }) ?? token.text}
        </span>
      );
    }
    if (token.kind === "marker") {
      if (token.text === "<d>" || token.text === "</d>") return null;
      return (
        <span className="prompt-render-marker" title={token.text}>
          {token.text}
        </span>
      );
    }
    if (token.kind === "task")
      return (
        <>
          {token.text
            .slice(1, -1)
            .split(/(\s+\+\s+)/)
            .map((part, index) =>
              /^\s+\+/.test(part) ? (
                part
              ) : (
                <span key={index} className="prompt-render-task" title={part}>
                  {part}
                </span>
              ),
            )}
        </>
      );
    if (token.kind === "shot") {
      const [, index, timing] =
        token.text.match(/^\[Shot (\d+)(?:,\s*(.*))?\]$/) ?? [];
      return (
        <span className="prompt-render-token is-shot" title={token.text}>
          镜头{index}
          {timing ? ` · ${timing}` : ""}
        </span>
      );
    }
    const title =
      token.kind === "speaker"
        ? `说话人 ${token.text.slice(1, -1)}`
        : token.kind === "relationship"
          ? token.text
          : undefined;
    return (
      <span className={`prompt-render-token is-${token.kind}`} title={title}>
        {token.text}
      </span>
    );
  };
  function mappedToken(token: SourceToken, literal = false): ReactNode {
    if (token.kind === "dialogue") return renderToken(token);
    if (
      !literal &&
      token.kind === "text" &&
      /\[[^\]\r\n]+\]/.test(token.text)
    ) {
      const nodes: ReactNode[] = [];
      let offset = 0;
      for (const match of token.text.matchAll(/\[[^\]\r\n]+\]/g)) {
        const part = promptPartsFromValue(match[0], assets).find(
          (item) => item.type === "asset",
        );
        if (part?.type !== "asset" || !part.file) continue;
        if (match.index > offset)
          nodes.push(
            mappedToken({
              ...token,
              text: token.text.slice(offset, match.index),
              sourceStart: token.sourceStart + offset,
            }),
          );
        nodes.push(
          <span
            key={match.index}
            contentEditable={false}
            data-prompt-source-start={token.sourceStart + match.index}
            data-prompt-source-length={match[0].length}
            data-prompt-atomic="true"
          >
            <Reference
              original={match[0]}
              label={part.file.display_name}
              file={part.file}
            />
          </span>,
        );
        offset = match.index + match[0].length;
      }
      if (offset) {
        if (offset < token.text.length)
          nodes.push(
            mappedToken({
              ...token,
              text: token.text.slice(offset),
              sourceStart: token.sourceStart + offset,
            }),
          );
        return nodes.map((node, index) => (
          <Fragment key={index}>{node}</Fragment>
        ));
      }
    }
    const atomic = !["text", "time"].includes(token.kind);
    return (
      <span
        data-prompt-source-start={token.sourceStart}
        data-prompt-source-length={token.text.length}
        data-prompt-atomic={atomic ? "true" : undefined}
        contentEditable={atomic ? false : undefined}
      >
        {renderToken(token)}
      </span>
    );
  }
  let offset = 0;
  const sections = document.sections.map((section) => {
    offset += section.heading.length;
    const mapped = {
      ...section,
      blocks: section.blocks.flatMap((block) => {
        const tokens = block.tokens.map((token) => {
          const start = offset;
          offset += token.text.length;
          return { ...token, sourceStart: start };
        });
        return displayLines(tokens).map((line) => ({ ...block, tokens: line }));
      }),
    };
    if (caret !== undefined && !section.hidden) {
      const blocks = mapped.blocks;
      if (!blocks.length)
        blocks.push({
          kind: "paragraph",
          tokens: [{ kind: "text", text: "", sourceStart: caret }],
        });
      for (let index = 0; index < blocks.length; index += 1) {
        const last = blocks[index].tokens.at(-1)!;
        const end = last.sourceStart + last.text.trimEnd().length;
        const next = blocks[index + 1]?.tokens[0]?.sourceStart ?? offset;
        if (caret > end && caret <= next) {
          blocks.splice(index + 1, 0, {
            kind: "paragraph",
            tokens: [{ kind: "text", text: "", sourceStart: caret }],
          });
          break;
        }
      }
    }
    return mapped;
  });
  return (
    <>
      {sections
        .filter((section) => !section.hidden)
        .map((section, index) => (
          <section
            className={`prompt-render-section${section.hideHeading ? " is-description" : ""}`}
            key={index}
          >
            {section.field && !section.hideHeading && (
              <h3 contentEditable={false}>{section.title}</h3>
            )}
            {section.blocks.map((block, blockIndex) => (
              <div
                className={`prompt-render-block is-${block.kind}`}
                key={blockIndex}
              >
                {block.tokens.map((token, tokenIndex) => {
                  let text = token.text;
                  let start = token.sourceStart;
                  if (tokenIndex === 0)
                    start += text.length - text.trimStart().length;
                  if (tokenIndex === 0) text = text.trimStart();
                  if (tokenIndex === block.tokens.length - 1)
                    text = text.trimEnd();
                  return (
                    <Fragment key={tokenIndex}>
                      {mappedToken({ ...token, text, sourceStart: start })}
                    </Fragment>
                  );
                })}
                <span
                  data-prompt-caret-end="true"
                  data-prompt-source-start={
                    (block.tokens.at(-1)?.sourceStart ?? 0) +
                    (block.tokens.at(-1)?.text.trimEnd().length ?? 0)
                  }
                  data-prompt-source-length="0"
                >
                  {"\u200b"}
                </span>
              </div>
            ))}
          </section>
        ))}
    </>
  );
}
