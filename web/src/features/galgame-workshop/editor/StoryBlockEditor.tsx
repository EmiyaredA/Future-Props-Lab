import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquareText, Plus } from "lucide-react";
import type {
  GalgameStoryBlock,
  GalgameStoryChapter,
  GalgameStoryFragment,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  sameDialogueGroup,
  storyBlockBundles,
} from "@features/galgame-workshop/editor/blockFlow";
import type { GalgameStoryDialogueBlock } from "@features/galgame-workshop/editor/dialogue";
import type { BlockKind } from "@features/galgame-workshop/editor/model";
import { replayStageToBlock } from "@features/galgame-workshop/editor/stage";
import {
  BlockInsertPalette,
  CommentCard,
  CurtainCard,
  DialogueCard,
  GenericBlockCard,
  NarrationCard,
  OfficialCommandCard,
  StoryParagraphCard,
  WaitCard,
  type AudioChannel,
} from "@features/galgame-workshop/editor/StoryBlockEditorParts";

export function StoryBlockEditor({
  document,
  chapter,
  fragment,
  selectedBlockId,
  onSelectBlock,
  onEditProperties,
  onBlock,
  onAddBlock,
  onAddAllCharacters,
  onAddAudio,
  onContinueDialogue,
  onDeleteBlock,
  onVoiceStale,
}: {
  document: GalgameStoryProject;
  chapter: GalgameStoryChapter;
  fragment: GalgameStoryFragment;
  selectedBlockId?: string;
  onSelectBlock: (blockId: string) => void;
  onEditProperties: () => void;
  onBlock: (block: GalgameStoryBlock) => void;
  onAddBlock: (kind: BlockKind, beforeBundleId?: string) => void;
  onAddAllCharacters: (beforeBundleId?: string) => void;
  onAddAudio: (
    action: "play" | "stop",
    channel: AudioChannel,
    beforeBundleId?: string,
  ) => void;
  onContinueDialogue: (
    block: GalgameStoryDialogueBlock,
    beforeBundleId?: string,
  ) => void;
  onDeleteBlock: (blockId: string) => void;
  onVoiceStale: (blockId: string) => void;
}) {
  const editorRef = useRef<HTMLElement>(null);
  const insertTargetRef = useRef<{
    anchor: HTMLElement;
    beforeBundleId?: string;
  } | null>(null);
  const focusInsertedBlockRef = useRef(false);
  const focusInsertedBlockTimeoutRef = useRef<number | undefined>(undefined);
  const [insertTarget, setInsertTarget] = useState<{
    anchor: HTMLElement;
    beforeBundleId?: string;
  } | null>(null);
  const bundles = storyBlockBundles(fragment);
  const hasTerminator = bundles.some(
    (bundle) =>
      bundle.primaryBlock.type === "branch" ||
      bundle.primaryBlock.type === "endChapter",
  );
  const selectedBundle = bundles.find((bundle) =>
    bundle.blocks.some((block) => block.id === selectedBlockId),
  );
  const openInsertPalette = (anchor: HTMLElement, beforeBundleId?: string) => {
    const target = { anchor, beforeBundleId };
    insertTargetRef.current = target;
    setInsertTarget(target);
  };
  const closeInsertPalette = useCallback((restoreFocus: boolean) => {
    const target = insertTargetRef.current;
    insertTargetRef.current = null;
    setInsertTarget(null);
    if (restoreFocus)
      requestAnimationFrame(() => {
        if (target?.anchor.isConnected) target.anchor.focus();
      });
  }, []);
  const expectInsertedBlockFocus = () => {
    focusInsertedBlockRef.current = true;
    if (focusInsertedBlockTimeoutRef.current)
      window.clearTimeout(focusInsertedBlockTimeoutRef.current);
    focusInsertedBlockTimeoutRef.current = window.setTimeout(() => {
      focusInsertedBlockRef.current = false;
      focusInsertedBlockTimeoutRef.current = undefined;
    }, 500);
  };

  useEffect(() => {
    if (!focusInsertedBlockRef.current || !selectedBlockId) return;
    focusInsertedBlockRef.current = false;
    if (focusInsertedBlockTimeoutRef.current) {
      window.clearTimeout(focusInsertedBlockTimeoutRef.current);
      focusInsertedBlockTimeoutRef.current = undefined;
    }
    requestAnimationFrame(() => {
      const card = editorRef.current?.querySelector<HTMLElement>(
        `[data-block-id="${selectedBlockId}"]`,
      );
      card?.focus();
    });
  }, [selectedBlockId]);

  useEffect(
    () => () => {
      if (focusInsertedBlockTimeoutRef.current)
        window.clearTimeout(focusInsertedBlockTimeoutRef.current);
    },
    [],
  );

  return (
    <section
      ref={editorRef}
      className="galgame-story-block-editor"
      aria-label="Block 卡片编辑器"
      onPointerDownCapture={(event) => {
        const target = event.target as HTMLElement;
        if (
          target.closest(
            "button, input, textarea, select, a, [contenteditable='true']",
          )
        )
          return;
        target.closest<HTMLElement>("[data-block-id]")?.focus();
      }}
      onKeyDownCapture={(event) => {
        if (
          event.key !== "Tab" ||
          event.shiftKey ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.nativeEvent.isComposing ||
          insertTarget
        )
          return;
        const target = event.target as HTMLElement;
        if (
          target.closest(
            "input, textarea, select, [contenteditable='true'], [role='dialog']",
          )
        )
          return;
        if (!bundles.length) {
          const empty = target.closest<HTMLElement>(".galgame-empty-blocks");
          if (!empty) return;
          event.preventDefault();
          openInsertPalette(empty);
          return;
        }
        if (!selectedBundle) return;
        const selectedCard = editorRef.current?.querySelector<HTMLElement>(
          `[data-block-id="${selectedBundle.id}"]`,
        );
        if (!selectedCard?.contains(target)) return;
        event.preventDefault();
        openInsertPalette(selectedCard, selectedBundle.id);
      }}
    >
      <div className="galgame-block-list">
        {bundles.map((bundle, index) => {
          const block = bundle.primaryBlock;
          const nextBundleId = bundles[index + 1]?.id;
          const selected = bundle.blocks.some(
            (candidate) => candidate.id === selectedBlockId,
          );
          const rawBlockIndex =
            block.type === "dialogue"
              ? (fragment.blocks ?? []).findIndex(
                  (candidate) => candidate.id === block.id,
                )
              : -1;
          const effectiveStage =
            block.type === "dialogue" && rawBlockIndex >= 0
              ? replayStageToBlock(document, fragment, rawBlockIndex)
              : undefined;
          const effectiveActor =
            block.type === "dialogue"
              ? effectiveStage?.soloActor?.characterId === block.characterId
                ? effectiveStage.soloActor
                : effectiveStage?.actors[block.characterId]
              : undefined;
          return (
            <div className="galgame-block-row" key={bundle.id}>
              {block.type === "dialogue" ? (
                <DialogueCard
                  block={block}
                  bundle={bundle}
                  index={index}
                  selected={selected}
                  groupedBefore={sameDialogueGroup(
                    bundles[index - 1]?.primaryBlock,
                    block,
                  )}
                  groupedAfter={sameDialogueGroup(
                    block,
                    bundles[index + 1]?.primaryBlock,
                  )}
                  document={document}
                  effectiveActor={effectiveActor}
                  onSelect={() => onSelectBlock(block.id)}
                  onBlock={onBlock}
                  onContinue={(current) =>
                    onContinueDialogue(current, nextBundleId)
                  }
                  onDelete={() => {
                    onDeleteBlock(block.id);
                    requestAnimationFrame(() => {
                      const focusId =
                        nextBundleId ?? bundles[index - 1]?.primaryBlock.id;
                      if (!focusId) return;
                      editorRef.current
                        ?.querySelector<HTMLElement>(
                          `[data-block-id="${focusId}"]`,
                        )
                        ?.focus();
                    });
                  }}
                  onVoiceStale={() => onVoiceStale(block.id)}
                />
              ) : block.type === "narration" ? (
                <NarrationCard
                  block={block}
                  index={index}
                  selected={selected}
                  document={document}
                  onSelect={() => onSelectBlock(block.id)}
                  onBlock={onBlock}
                />
              ) : block.type === "storyParagraph" ? (
                <StoryParagraphCard
                  block={block}
                  index={index}
                  selected={selected}
                  groupedBefore={
                    bundles[index - 1]?.primaryBlock.type === "storyParagraph"
                  }
                  groupedAfter={
                    bundles[index + 1]?.primaryBlock.type === "storyParagraph"
                  }
                  document={document}
                  onSelect={() => onSelectBlock(block.id)}
                  onBlock={onBlock}
                />
              ) : block.type === "comment" ? (
                <CommentCard
                  block={block}
                  index={index}
                  selected={selected}
                  onSelect={() => onSelectBlock(block.id)}
                  onBlock={onBlock}
                />
              ) : block.type === "wait" ? (
                <WaitCard
                  block={block}
                  index={index}
                  selected={selected}
                  onSelect={() => onSelectBlock(block.id)}
                  onBlock={onBlock}
                />
              ) : block.type === "curtain" ? (
                <CurtainCard
                  block={block}
                  index={index}
                  selected={selected}
                  onSelect={() => onSelectBlock(block.id)}
                />
              ) : block.type === "paragraphParams" ||
                block.type === "systemMessage" ? (
                <OfficialCommandCard
                  block={block}
                  index={index}
                  selected={selected}
                  onSelect={() => onSelectBlock(block.id)}
                />
              ) : (
                <GenericBlockCard
                  block={block}
                  index={index}
                  selected={selected}
                  document={document}
                  chapter={chapter}
                  onSelect={() => onSelectBlock(block.id)}
                />
              )}
            </div>
          );
        })}
        {!bundles.length ? (
          <div className="galgame-empty-blocks" tabIndex={0}>
            <MessageSquareText aria-hidden />
            <strong>这个 Fragment 还没有 Block</strong>
            <span>按 Tab 或使用下方按钮添加第一个 Block。</span>
            <button
              type="button"
              onClick={(event) => openInsertPalette(event.currentTarget)}
            >
              <Plus aria-hidden />
              添加第一个 Block
            </button>
          </div>
        ) : null}
      </div>
      <footer>
        <span>{bundles.length} 个可见 Block</span>
        <span>选中 Block，按 Tab 在其前面插入</span>
      </footer>
      {insertTarget ? (
        <BlockInsertPalette
          anchor={insertTarget.anchor}
          beforeBundleId={insertTarget.beforeBundleId}
          selectedBlock={selectedBundle?.primaryBlock}
          story={document}
          hasTerminator={hasTerminator}
          onClose={closeInsertPalette}
          onBlock={onBlock}
          onEditProperties={onEditProperties}
          onAddBlock={(kind, beforeBundleId) => {
            expectInsertedBlockFocus();
            onAddBlock(kind, beforeBundleId);
          }}
          onAddAllCharacters={(beforeBundleId) => {
            expectInsertedBlockFocus();
            onAddAllCharacters(beforeBundleId);
          }}
          onAddAudio={(action, channel, beforeBundleId) => {
            expectInsertedBlockFocus();
            onAddAudio(action, channel, beforeBundleId);
          }}
        />
      ) : null}
    </section>
  );
}
