import { BookOpenText, Braces, Clock3, Languages } from "lucide-react";
import { TimelinePlayheadAddMenu } from "./TimelinePlayheadAddMenu";
import { StoryJsonView } from "./StoryJsonView";
import { StoryLocalizationWorkspace } from "./StoryLocalizationWorkspace";
import { continuingDialogueBlock, storyBlockBundles } from "./blockFlow";
import { updateBlock, updateFragment } from "./model";
import { formatTimecode } from "./timeline";
import {
  StoryBlockEditor,
  StoryTimelineEditor,
} from "./editorWorkspaceModules";
import type { ReadyEditorPageViewModel } from "./editorViewModel";

export function GalgameEditorScriptWorkspace({
  model,
}: {
  model: ReadyEditorPageViewModel;
}) {
  const {
    addAllCharactersBlock,
    addAudioBlock,
    addBlock,
    chapter,
    deleteSelected,
    document,
    insertPreparedBlock,
    localizationLocale,
    pendingCardFocusRef,
    playbackFollow,
    playheadAddMenuRef,
    previewMode,
    previewTimelinePosition,
    replaceDocument,
    scriptView,
    selectedBlockId,
    selectedFragment,
    selectedTimelineGapId,
    setInspectorTab,
    setLocalizationLocale,
    setPreviewMode,
    setScriptView,
    setSelectedBlockId,
    setSelectedTimelineGapId,
    setStaleVoiceBlocks,
    setStructureDrawerOpen,
    setTimelinePreferences,
    setTimelinePreviewMs,
    terminates,
    timelineFragment,
    timelinePreferences,
    timelinePreviewMs,
    timelineSourceFragment,
  } = model;
  return (
    <main className="galgame-block-panel">
      {selectedFragment ? (
        <>
          <header className="galgame-block-toolbar">
            <button
              type="button"
              className="galgame-structure-drawer-toggle"
              aria-label="打开剧本结构"
              onClick={() => setStructureDrawerOpen(true)}
            >
              <BookOpenText aria-hidden />
            </button>
            <nav
              className="galgame-script-view-switch"
              aria-label="剧本编辑视图"
            >
              <button
                type="button"
                aria-label="卡片"
                title="卡片"
                className={scriptView === "blocks" ? "active" : ""}
                onClick={() => {
                  setScriptView("blocks");
                  setTimelinePreviewMs(null);
                  setSelectedTimelineGapId(undefined);
                }}
              >
                <BookOpenText aria-hidden /> <span>卡片</span>
              </button>
              <button
                type="button"
                aria-label="JSON"
                title="JSON OP"
                className={scriptView === "json" ? "active" : ""}
                onClick={() => {
                  setScriptView("json");
                  setTimelinePreviewMs(null);
                  setSelectedTimelineGapId(undefined);
                }}
              >
                <Braces aria-hidden /> <span>JSON</span>
              </button>
            </nav>
            <div className="galgame-fragment-context">
              <input
                aria-label="Fragment 名称"
                value={selectedFragment.title}
                onChange={(event) =>
                  replaceDocument(
                    updateFragment(
                      document,
                      selectedFragment.id,
                      (fragment) => ({
                        ...fragment,
                        title: event.target.value,
                      }),
                    ),
                  )
                }
              />
              <small>
                {storyBlockBundles(selectedFragment).length} 个可见 Block
                {selectedFragment.timeline
                  ? ` · 精确演出 ${formatTimecode(selectedFragment.timeline.durationMs)}`
                  : " · 顺序执行"}
              </small>
            </div>
            <button
              type="button"
              aria-label="演出"
              title="演出时间轴"
              className={`galgame-performance-switch${scriptView === "performance" ? " active" : ""}`}
              onClick={() => {
                setScriptView("performance");
                setPreviewMode("edit");
              }}
            >
              <Clock3 aria-hidden /> <span>演出</span>
            </button>
            <button
              type="button"
              aria-label="多语言"
              title="多语言译稿校对"
              className={`galgame-performance-switch galgame-localization-switch${scriptView === "localization" ? " active" : ""}`}
              onClick={() => {
                setScriptView("localization");
                setPreviewMode("edit");
                setTimelinePreviewMs(null);
                setSelectedTimelineGapId(undefined);
              }}
            >
              <Languages aria-hidden /> <span>多语言</span>
            </button>
          </header>
          {scriptView === "performance" && timelineFragment ? (
            <StoryTimelineEditor
              document={document}
              fragment={timelineFragment}
              selectedBlockId={
                previewMode === "play"
                  ? playbackFollow?.blockId
                  : selectedBlockId
              }
              selectedGapId={
                previewMode === "edit" ? selectedTimelineGapId : undefined
              }
              onRequestAddMenu={() => {
                if (!playheadAddMenuRef.current) return;
                playheadAddMenuRef.current.open = true;
              }}
              addControl={
                previewMode === "edit" ? (
                  <TimelinePlayheadAddMenu
                    ref={playheadAddMenuRef}
                    positionMs={timelinePreviewMs ?? 0}
                    hasTerminator={terminates}
                    onAddBlock={addBlock}
                    onAddAllCharacters={addAllCharactersBlock}
                    onAddAudio={addAudioBlock}
                  />
                ) : undefined
              }
              readOnly={previewMode === "play"}
              followPositionMs={
                previewMode === "play" ? playbackFollow?.positionMs : undefined
              }
              estimated={!timelineSourceFragment?.timeline}
              onSelectBlock={(blockId) => {
                setSelectedTimelineGapId(undefined);
                setSelectedBlockId(blockId);
                setInspectorTab("properties");
              }}
              onSelectGap={(gapId) => {
                setSelectedBlockId(undefined);
                setSelectedTimelineGapId(gapId);
                setInspectorTab("properties");
              }}
              onFragment={(fragment) => {
                if (previewMode === "play" || !selectedFragment) return;
                replaceDocument(
                  updateFragment(document, selectedFragment.id, () => fragment),
                );
              }}
              onPreviewPosition={previewTimelinePosition}
              preferences={timelinePreferences}
              onPreferencesChange={setTimelinePreferences}
            />
          ) : scriptView === "localization" ? (
            <StoryLocalizationWorkspace
              document={document}
              chapter={chapter}
              fragment={selectedFragment}
              targetLocale={localizationLocale}
              selectedBlockId={selectedBlockId}
              onTargetLocaleChange={setLocalizationLocale}
              onSelectBlock={(blockId) => {
                setSelectedTimelineGapId(undefined);
                setSelectedBlockId(blockId);
                setInspectorTab("properties");
              }}
              onDocument={replaceDocument}
            />
          ) : scriptView === "json" ? (
            <StoryJsonView fragment={selectedFragment} />
          ) : (
            <StoryBlockEditor
              document={document}
              chapter={chapter}
              fragment={selectedFragment}
              selectedBlockId={selectedBlockId}
              onSelectBlock={(blockId) => {
                setSelectedTimelineGapId(undefined);
                setSelectedBlockId(blockId);
                setInspectorTab("properties");
              }}
              onEditProperties={() => {
                setInspectorTab("properties");
                requestAnimationFrame(() => {
                  globalThis.document
                    .querySelector<HTMLElement>(
                      ".galgame-inspector-body .galgame-block-inspector input:not(:disabled), .galgame-inspector-body .galgame-block-inspector textarea:not(:disabled), .galgame-inspector-body .galgame-block-inspector [role='group'] button:not(:disabled)",
                    )
                    ?.focus();
                });
              }}
              onBlock={(block) =>
                replaceDocument(
                  updateBlock(
                    document,
                    selectedFragment.id,
                    block.id,
                    () => block,
                  ),
                )
              }
              onAddBlock={addBlock}
              onAddAllCharacters={addAllCharactersBlock}
              onAddAudio={addAudioBlock}
              onContinueDialogue={(source, beforeBundleId) => {
                const block = continuingDialogueBlock(source);
                pendingCardFocusRef.current = block.id;
                insertPreparedBlock(block, beforeBundleId);
              }}
              onDeleteBlock={(blockId) => deleteSelected(blockId)}
              onVoiceStale={(blockId) =>
                setStaleVoiceBlocks((current) => new Set(current).add(blockId))
              }
            />
          )}
        </>
      ) : null}
    </main>
  );
}
