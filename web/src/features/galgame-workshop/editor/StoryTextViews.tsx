import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy } from "lucide-react";
import type {
  GalgameStoryBlock,
  GalgameStoryFragment,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  BLOCK_REGISTRY,
  blockCapability,
  blockSummary,
  canonicalBlockJson,
} from "@features/galgame-workshop/editor/blockRegistry";
import {
  decodeRenpy,
  encodeRenpy,
} from "@features/galgame-workshop/editor/scriptCodecs";
import { RenpyCodeEditor } from "@features/galgame-workshop/editor/RenpyCodeEditor";
import { plainRichText } from "@features/galgame-workshop/editor/richText";

type TextBlock = Extract<
  GalgameStoryBlock,
  {
    type:
      | "narration"
      | "dialogue"
      | "storyParagraph"
      | "systemMessage"
      | "comment"
      | "floatingText";
  }
>;

function textField(block: GalgameStoryBlock): block is TextBlock {
  return (
    block.type === "narration" ||
    block.type === "dialogue" ||
    block.type === "storyParagraph" ||
    block.type === "systemMessage" ||
    block.type === "comment" ||
    block.type === "floatingText"
  );
}

export function PlainStoryView({
  document,
  fragment,
  onFragment,
}: {
  document: GalgameStoryProject;
  fragment: GalgameStoryFragment;
  onFragment: (fragment: GalgameStoryFragment) => void;
}) {
  const update = (index: number, block: GalgameStoryBlock) =>
    onFragment({
      ...fragment,
      blocks: (fragment.blocks ?? []).map((item, itemIndex) =>
        itemIndex === index ? block : item,
      ),
    });
  const move = (index: number, direction: -1 | 1) => {
    const blocks = [...(fragment.blocks ?? [])];
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    onFragment({ ...fragment, blocks });
  };
  return (
    <div className="galgame-plain-view">
      {(fragment.blocks ?? []).map((block, index) => (
        <div
          key={block.id}
          className="galgame-plain-line"
          data-block-id={block.id}
        >
          <span>{index + 1}</span>
          <strong>{blockCapability(block).label}</strong>
          {textField(block) ? (
            <textarea
              value={block.text}
              onChange={(event) =>
                update(
                  index,
                  block.type === "narration" ||
                    block.type === "dialogue" ||
                    block.type === "storyParagraph"
                    ? {
                        ...block,
                        text: event.target.value,
                        content: plainRichText(event.target.value),
                      }
                    : { ...block, text: event.target.value },
                )
              }
            />
          ) : (
            <p>{blockSummary(block, document)}</p>
          )}
          <button
            type="button"
            aria-label="上移"
            disabled={index === 0}
            onClick={() => move(index, -1)}
          >
            <ArrowUp />
          </button>
          <button
            type="button"
            aria-label="下移"
            disabled={index === (fragment.blocks?.length ?? 0) - 1}
            onClick={() => move(index, 1)}
          >
            <ArrowDown />
          </button>
          <button
            type="button"
            aria-label="复制 Block"
            onClick={() => {
              const clone = {
                ...block,
                id: crypto.randomUUID(),
              } as GalgameStoryBlock;
              const blocks = [...(fragment.blocks ?? [])];
              blocks.splice(index + 1, 0, clone);
              onFragment({ ...fragment, blocks });
            }}
          >
            <Copy />
          </button>
        </div>
      ))}
    </div>
  );
}

export function RenpyStoryView({
  document,
  fragment,
  onFragment,
}: {
  document: GalgameStoryProject;
  fragment: GalgameStoryFragment;
  onFragment: (fragment: GalgameStoryFragment) => void;
}) {
  const storageKey = `future-props-renpy-draft:${fragment.id}`;
  const encoded = useMemo(
    () => encodeRenpy(fragment.blocks ?? []),
    [fragment.blocks],
  );
  const [draft, setDraft] = useState(
    () => localStorage.getItem(storageKey) ?? encoded,
  );
  const [errors, setErrors] = useState<string[]>([]);
  const completions = useMemo(
    () => [
      ...["scene", "show", "hide", "call", "pause", "studio"].map((label) => ({
        label,
        type: "keyword",
      })),
      ...(document.characters ?? []).map((character) => ({
        label: character.id,
        detail: character.name,
        type: "variable",
      })),
      ...(document.scenes ?? []).map((scene) => ({
        label: scene.id,
        detail: scene.name,
        type: "variable",
      })),
      ...(document.chapters ?? []).flatMap((chapter) =>
        (chapter.fragments ?? []).map((item) => ({
          label: item.id,
          detail: `${chapter.title} / ${item.title}`,
          type: "function",
        })),
      ),
      ...Object.entries(BLOCK_REGISTRY).map(([type, item]) => ({
        label: `studio ${type}:`,
        detail: item.label,
        type: "keyword",
      })),
    ],
    [document],
  );
  useEffect(() => {
    setDraft(localStorage.getItem(storageKey) ?? encoded);
    setErrors([]);
  }, [encoded, storageKey]);
  return (
    <div className="galgame-renpy-view">
      <header>
        <strong>Ren’Py 风格</strong>
        <span>
          {errors.length
            ? "草稿有误，仍保留最后一次合法 Block"
            : "已同步 Block"}
        </span>
      </header>
      <RenpyCodeEditor
        value={draft}
        completions={completions}
        onChange={(next) => {
          setDraft(next);
          localStorage.setItem(storageKey, next);
          const decoded = decodeRenpy(next, fragment.blocks ?? [], document);
          setErrors(decoded.errors);
          if (decoded.blocks)
            onFragment({ ...fragment, blocks: decoded.blocks });
        }}
      />
      {errors.length ? (
        <ul>
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function JsonStoryView({
  fragment,
}: {
  fragment: GalgameStoryFragment;
}) {
  const value = canonicalBlockJson(fragment.blocks ?? []);
  return (
    <div className="galgame-json-view">
      <header>
        <span>规范化 JSON OP · 只读</span>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(value)}
        >
          <Copy /> 复制
        </button>
      </header>
      <pre>{value}</pre>
    </div>
  );
}
