import { useEffect, useMemo, useRef, useState } from "react";
import { Box, FileText, Image, Search, UserRound, X } from "lucide-react";
import type {
  GalgameStoryBlock,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  BLOCK_REGISTRY,
  type BlockCapability,
} from "@features/galgame-workshop/editor/blockRegistry";

export type StorySearchTarget =
  | {
      kind: "story";
      chapterId: string;
      fragmentId: string;
      blockId?: string;
    }
  | { kind: "character"; characterId: string }
  | { kind: "scene"; sceneId: string }
  | { kind: "cg"; cgId: string }
  | { kind: "asset"; assetId: string };

type SearchItem = {
  id: string;
  label: string;
  detail: string;
  keywords: string;
  target: StorySearchTarget;
  icon: typeof FileText;
};

function blockSummary(block: GalgameStoryBlock, document: GalgameStoryProject) {
  if (block.type === "branch" && block.prompt.trim())
    return block.prompt.trim();
  if (block.type === "if") return block.condition;
  if (block.type === "setVariable") return `写入变量 ${block.variableId}`;
  return (BLOCK_REGISTRY[block.type] as BlockCapability).summary(
    block,
    document,
  );
}

export function GlobalStorySearch({
  open,
  document,
  onClose,
  onSelect,
}: {
  open: boolean;
  document: GalgameStoryProject;
  onClose: () => void;
  onSelect: (target: StorySearchTarget) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const items = useMemo<SearchItem[]>(() => {
    const result: SearchItem[] = [];
    for (const chapter of document.chapters ?? []) {
      for (const fragment of chapter.fragments ?? []) {
        result.push({
          id: `fragment-${chapter.id}-${fragment.id}`,
          label: fragment.title,
          detail: `${chapter.title} · Fragment`,
          keywords: `${chapter.title} ${fragment.title} ${fragment.id}`,
          target: {
            kind: "story",
            chapterId: chapter.id,
            fragmentId: fragment.id,
          },
          icon: FileText,
        });
        for (const block of fragment.blocks ?? []) {
          const summary = blockSummary(block, document);
          result.push({
            id: `block-${block.id}`,
            label: summary,
            detail: `${chapter.title} / ${fragment.title} · ${BLOCK_REGISTRY[block.type].label}`,
            keywords: `${summary} ${block.id} ${block.type} ${JSON.stringify(block)}`,
            target: {
              kind: "story",
              chapterId: chapter.id,
              fragmentId: fragment.id,
              blockId: block.id,
            },
            icon: Box,
          });
        }
      }
    }
    for (const character of document.characters ?? [])
      result.push({
        id: `character-${character.id}`,
        label: character.name,
        detail: `角色 · ${character.expressions?.length ?? 0} 个表情`,
        keywords: `${character.name} ${character.description} ${character.id}`,
        target: { kind: "character", characterId: character.id },
        icon: UserRound,
      });
    for (const scene of document.scenes ?? [])
      result.push({
        id: `scene-${scene.id}`,
        label: scene.name,
        detail: `场景 · ${scene.layers?.length ?? 0} 个图层`,
        keywords: `${scene.name} ${scene.description} ${scene.id}`,
        target: { kind: "scene", sceneId: scene.id },
        icon: Image,
      });
    for (const cg of document.cgs ?? [])
      result.push({
        id: `cg-${cg.id}`,
        label: cg.name,
        detail: `CG · ${cg.variants?.length ?? 0} 个差分`,
        keywords: `${cg.name} ${cg.description} ${cg.id} ${(cg.variants ?? [])
          .map((variant) => variant.label)
          .join(" ")}`,
        target: { kind: "cg", cgId: cg.id },
        icon: Image,
      });
    for (const asset of document.assets ?? []) {
      const label =
        "label" in asset ? asset.label : `${asset.role} · ${asset.id}`;
      result.push({
        id: `asset-${asset.id}`,
        label,
        detail: `资源 · ${asset.role}`,
        keywords: `${label} ${asset.role} ${asset.id}`,
        target: { kind: "asset", assetId: asset.id },
        icon: Image,
      });
    }
    return result;
  }, [document]);
  const normalized = query.trim().toLocaleLowerCase();
  const filtered = normalized
    ? items
        .filter((item) =>
          item.keywords.toLocaleLowerCase().includes(normalized),
        )
        .slice(0, 40)
    : items.slice(0, 16);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div
      className="galgame-command-overlay"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="galgame-command-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="搜索项目内容"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <label>
          <Search aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索台词、指令、章节、角色或资源…"
          />
          <kbd>Esc</kbd>
          <button type="button" aria-label="关闭搜索" onClick={onClose}>
            <X aria-hidden />
          </button>
        </label>
        <div className="galgame-command-results">
          {filtered.length ? (
            filtered.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => {
                    onSelect(item.target);
                    onClose();
                  }}
                >
                  <Icon aria-hidden />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </span>
                </button>
              );
            })
          ) : (
            <p>没有找到匹配内容。</p>
          )}
        </div>
      </section>
    </div>
  );
}
