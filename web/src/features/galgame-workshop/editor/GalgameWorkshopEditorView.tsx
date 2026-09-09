import { CompactPanelTabs } from "@shared/ui/CompactPanelTabs";
import "../styles/compact-workspaces.css";
import { Suspense, useState } from "react";
import {
  ArrowLeft,
  Film,
  GitBranch,
  MapPinned,
  Palette,
  RefreshCcw,
  Save,
  Search,
  Settings2,
} from "lucide-react";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import { canMoveStoryBlockBundle } from "@features/galgame-workshop/editor/blockFlow";
import {
  DEFAULT_SCRIPT_LAYOUT,
  normalizeScriptLayout,
} from "@features/galgame-workshop/editor/scriptLayoutPreferences";
import {
  completeStoryDocument,
  chapterById,
  entryChapter,
  fragmentById,
  updateBlock,
} from "@features/galgame-workshop/editor/model";
import { GalgameEditorVideoExportDialog } from "@features/galgame-workshop/editor/GalgameEditorVideoExportDialog";
import { StoryConflictBanner } from "@features/galgame-workshop/editor/StoryConflictBanner";
import { RouteReportInspector } from "@features/galgame-workshop/editor/RouteReport";
import { FragmentOverviewInspector } from "@features/galgame-workshop/editor/EditorShared";
import "@features/galgame-workshop/galgameStyles";
import "@features/galgame-workshop/galgame-json-view.css";
import type { EditorPageViewModel } from "@features/galgame-workshop/editor/editorViewModel";
import {
  EditorFastPreviewOverlay,
  EditorFastPreviewRunMenu,
} from "@features/galgame-workshop/editor/EditorFastPreviewOverlay";
import { useEditorSegmentPreviewController } from "@features/galgame-workshop/editor/useEditorSegmentPreviewController";
import {
  AssetCenter,
  BlockInspector,
  DialogueStyleInspector,
  NarrativeMapWorkspace,
  PersonalizationWorkspace,
  ProjectSettingsWorkspace,
  STORY_KEY,
  StoryPlayer,
  TimelineGapInspector,
  WORKSPACES,
} from "@features/galgame-workshop/editor/editorWorkspaceModules";
import { GalgameEditorStatusAndSearch } from "./GalgameEditorStatusAndSearch";
import { GalgameEditorScriptWorkspace } from "./GalgameEditorScriptWorkspace";
import { GalgameEditorStructurePanel } from "./GalgameEditorStructurePanel";

export function GalgameWorkshopEditorView({
  model,
}: {
  model: EditorPageViewModel;
}) {
  const [mobilePanel, setMobilePanel] = useState("script");
  const segmentPreview = useEditorSegmentPreviewController(model);
  if (model.status === "loading")
    return (
      <div className="workshop-state galgame-editor-state">
        <RefreshCcw className="spinning" aria-hidden />
        <strong>正在打开剧本编辑器</strong>
      </div>
    );
  if (model.status === "error")
    return (
      <div className="workshop-state galgame-editor-state">
        <strong>剧本编辑器暂时无法打开</strong>
        <button onClick={() => window.location.reload()}>重新加载</button>
      </div>
    );
  const {
    projectId,
    onOverview,
    client,
    revisionRef,
    documentRef,
    conflictRef,
    playerRef,
    previewRef,
    editorGridRef,
    workspace,
    setWorkspace,
    setCommandOpen,
    titleSaving,
    assetSection,
    setAssetSection,
    scriptView,
    localizationLocale,
    visualSection,
    setVisualSection,
    focusedVisual,
    setFocusedVisual,
    previewMode,
    setPreviewMode,
    previewReloadKey,
    setPreviewReloadKey,
    previewStart,
    scriptLayout,
    setScriptLayout,
    playbackFollow,
    setPlaybackFollow,
    timelinePreviewMs,
    setTimelinePreviewMs,
    timelinePreferences,
    stageViewportPreferences,
    setStageViewportPreferences,
    inspectorTab,
    setInspectorTab,
    document,
    setDocument,
    setSelectedChapterId,
    setSelectedFragmentId,
    selectedBlockId,
    setSelectedBlockId,
    setSelectedTimelineGapId,
    saveState,
    setSaveState,
    saveMessage,
    notice,
    setNotice,
    conflict,
    setConflict,
    confirmOverwrite,
    setConfirmOverwrite,
    setReportOpen,
    videoExportOpen,
    setVideoExportOpen,
    staleVoiceBlocks,
    setStaleVoiceBlocks,
    focusedCharacterId,
    setFocusedCharacterId,
    projectQuery,
    refetchStory,
    reportQuery,
    enqueueSave,
    replaceDocument,
    commitDocument,
    autoMatchDialogueVoice,
    upgradePortraitSizes,
    repairMissingAsset,
    chapter,
    selectedFragment,
    projectedSelectedFragment,
    selectedBlock,
    selectedTimelineGap,
    report,
    savedDocument,
    reportRefreshing,
    reportIssueCount,
    selectedIndex,
    editableCgBlockId,
    selectFragment,
    moveSelected,
    deleteSelected,
    locateIssue,
    locateRoute,
    updateProjectTitle,
    startStageResize,
    setStageCollapsed,
    startSidebarResize,
    resizeSidebarWithKeyboard,
    resetSidebarWidth,
    effectiveCenterRatio,
    editorGridStyle,
  } = model;
  if (segmentPreview.fastPreview)
    return (
      <EditorFastPreviewOverlay
        session={segmentPreview.fastPreview}
        model={model}
        onClose={() => segmentPreview.setFastPreview(undefined)}
        onRenderRange={segmentPreview.renderSegment}
      />
    );
  return (
    <Suspense
      fallback={<div className="page-loading">正在加载编辑器模块…</div>}
    >
      <section className="galgame-editor-page" data-mobile-panel={mobilePanel}>
        <header className="galgame-editor-header">
          <div className="galgame-editor-project">
            <button
              type="button"
              className="galgame-editor-back"
              aria-label="返回工程概览"
              onClick={onOverview}
            >
              <ArrowLeft aria-hidden />
            </button>
            <img
              src="/brand/galgame-workshop-mark-cutout.png"
              alt=""
              aria-hidden
            />
            <span>
              <strong>{projectQuery.data?.title}</strong>
              <small>Galgame Workshop · Story 1.4</small>
            </span>
          </div>
          <button
            type="button"
            className="galgame-global-search"
            onClick={() => setCommandOpen(true)}
          >
            <Search aria-hidden />
            <span>搜索台词、指令、资源…</span>
            <kbd>{navigator.platform.includes("Mac") ? "⌘K" : "Ctrl K"}</kbd>
          </button>
          <div className="galgame-editor-actions">
            <ThemeToggle compact />
            <button
              type="button"
              className="galgame-editor-refresh"
              aria-label="刷新服务器剧本版本"
              title="刷新服务器剧本版本"
              onClick={() => void refetchStory()}
            >
              <RefreshCcw aria-hidden />
            </button>
            <div
              className={`galgame-save-state ${saveState}`}
              aria-live="polite"
            >
              <Save aria-hidden />
              {saveState === "saved"
                ? "已保存"
                : saveState === "saving"
                  ? "保存中"
                  : saveState === "conflict"
                    ? "存在冲突"
                    : "保存失败"}
            </div>
            <button
              type="button"
              className="galgame-editor-video-export"
              onClick={() => {
                segmentPreview.clearVideoExportSeed();
                setPreviewMode("edit");
                setVideoExportOpen(true);
              }}
            >
              <Film aria-hidden /> 导出视频
            </button>
            <EditorFastPreviewRunMenu
              model={model}
              onLaunch={segmentPreview.setFastPreview}
              onConfigureRange={segmentPreview.openSegmentPreview}
            />
          </div>
        </header>
        <nav className="galgame-editor-tabs" aria-label="创作工作区">
          {WORKSPACES.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={workspace === item.id ? "active" : ""}
                onClick={() => setWorkspace(item.id)}
              >
                <Icon aria-hidden /> {item.label}
              </button>
            );
          })}
        </nav>

        {notice ? (
          <div className="galgame-inline-notice" role="status">
            {notice}
            <button type="button" onClick={() => setNotice("")}>
              关闭
            </button>
          </div>
        ) : null}
        {saveMessage ? (
          <div className="galgame-inline-notice danger" role="alert">
            {saveMessage}
          </div>
        ) : null}

        {workspace === "script" && (
          <CompactPanelTabs
            label="剧本面板"
            value={mobilePanel}
            onChange={setMobilePanel}
            options={[
              { value: "script", label: "剧本" },
              { value: "structure", label: "结构" },
              { value: "preview", label: "预览与属性" },
            ]}
          />
        )}
        {workspace === "script" ? (
          <div
            ref={editorGridRef}
            className="galgame-editor-grid galgame-script-workbench"
            data-stage-collapsed={
              stageViewportPreferences.collapsed ? "true" : "false"
            }
            data-script-view={scriptView}
            style={editorGridStyle}
          >
            <GalgameEditorStructurePanel model={model} />

            <div
              className="galgame-panel-resizer"
              role="separator"
              tabIndex={0}
              aria-label="调整故事结构栏宽度"
              aria-orientation="vertical"
              aria-valuemin={12}
              aria-valuemax={24}
              aria-valuenow={Math.round(scriptLayout.leftRatio)}
              title="拖动调整宽度，双击恢复默认"
              onPointerDown={(event) => startSidebarResize("left", event)}
              onKeyDown={(event) => resizeSidebarWithKeyboard("left", event)}
              onDoubleClick={() => resetSidebarWidth("left")}
            />

            <GalgameEditorScriptWorkspace
              model={model}
              onOpenStructure={() => setMobilePanel("structure")}
            />

            <div
              className={`galgame-stage-resizer${stageViewportPreferences.collapsed ? " is-disabled" : ""}`}
              role="separator"
              tabIndex={0}
              aria-label={
                stageViewportPreferences.collapsed
                  ? "舞台已折叠，按 Enter 展开"
                  : "调整舞台与剧情时间轴高度"
              }
              aria-orientation="horizontal"
              aria-valuemin={24}
              aria-valuemax={72}
              aria-valuenow={Math.round(scriptLayout.previewSplitRatio)}
              aria-disabled={stageViewportPreferences.collapsed}
              title={
                stageViewportPreferences.collapsed
                  ? "舞台已折叠，点击展开"
                  : "拖动调整预览高度，双击恢复 60%"
              }
              onPointerDown={(event) => {
                if (stageViewportPreferences.collapsed) {
                  event.preventDefault();
                  setStageCollapsed(false);
                  return;
                }
                startStageResize(event);
              }}
              onDoubleClick={() => {
                if (stageViewportPreferences.collapsed) {
                  setStageCollapsed(false);
                  return;
                }
                setScriptLayout((current) => ({
                  ...current,
                  previewSplitRatio: DEFAULT_SCRIPT_LAYOUT.previewSplitRatio,
                }));
              }}
              onKeyDown={(event) => {
                if (
                  stageViewportPreferences.collapsed &&
                  (event.key === "Enter" || event.key === " ")
                ) {
                  event.preventDefault();
                  setStageCollapsed(false);
                  return;
                }
                if (stageViewportPreferences.collapsed) return;
                if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
                  return;
                event.preventDefault();
                setScriptLayout((current) =>
                  normalizeScriptLayout({
                    ...current,
                    previewSplitRatio:
                      current.previewSplitRatio +
                      (event.key === "ArrowDown" ? 2 : -2),
                  }),
                );
              }}
            />

            <div
              className="galgame-panel-resizer"
              role="separator"
              tabIndex={0}
              aria-label="调整预览检查栏宽度"
              aria-orientation="vertical"
              aria-valuemin={22}
              aria-valuemax={Math.round(
                (scriptView === "performance" || scriptView === "localization"
                  ? 78
                  : 62) - scriptLayout.leftRatio,
              )}
              aria-valuenow={Math.round(effectiveCenterRatio)}
              title="拖动调整宽度，双击恢复默认"
              onPointerDown={(event) => startSidebarResize("right", event)}
              onKeyDown={(event) => resizeSidebarWithKeyboard("right", event)}
              onDoubleClick={() => resetSidebarWidth("right")}
            />

            <aside className="galgame-preview-panel">
              <div
                ref={previewRef}
                tabIndex={-1}
                className="galgame-preview-focus"
              >
                <StoryPlayer
                  key={previewReloadKey}
                  ref={playerRef}
                  document={document}
                  locale={
                    scriptView === "localization"
                      ? localizationLocale
                      : undefined
                  }
                  includeStaleTranslations={scriptView === "localization"}
                  startCursor={previewStart}
                  mode={previewMode}
                  collapsed={stageViewportPreferences.collapsed}
                  onCollapsedChange={setStageCollapsed}
                  viewportPreferences={stageViewportPreferences}
                  onViewportPreferencesChange={setStageViewportPreferences}
                  workbenchHeader
                  headerModeControl={
                    <nav className="galgame-preview-mode" aria-label="预览模式">
                      <button
                        type="button"
                        className={previewMode === "edit" ? "active" : ""}
                        onClick={() => setPreviewMode("edit")}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className={previewMode === "play" ? "active" : ""}
                        onClick={() => {
                          setPreviewMode("play");
                          setPlaybackFollow(undefined);
                          setTimelinePreviewMs(null);
                        }}
                      >
                        试玩
                      </button>
                      <button
                        type="button"
                        aria-label="定位所选 Block"
                        title="定位所选 Block"
                        disabled={!selectedBlockId}
                        onClick={() =>
                          selectedBlockId
                            ? globalThis.document
                                .querySelector(
                                  `[data-block-id="${selectedBlockId}"]`,
                                )
                                ?.scrollIntoView({ block: "center" })
                            : undefined
                        }
                      >
                        <MapPinned aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label="重载舞台预览"
                        title="重载舞台预览"
                        onClick={() =>
                          setPreviewReloadKey((value) => value + 1)
                        }
                      >
                        <RefreshCcw aria-hidden />
                      </button>
                    </nav>
                  }
                  editFragment={selectedFragment}
                  editTimelinePositionMs={
                    previewMode === "edit" ? timelinePreviewMs : null
                  }
                  editBlockIndex={
                    selectedIndex != null && selectedIndex >= 0
                      ? selectedIndex
                      : undefined
                  }
                  editableCgBlockId={editableCgBlockId}
                  onCgOverlayChange={(overlay) => {
                    if (
                      !selectedBlock ||
                      selectedBlock.type !== "showCg" ||
                      !selectedFragment
                    )
                      return;
                    replaceDocument(
                      updateBlock(
                        document,
                        selectedFragment.id,
                        selectedBlock.id,
                        (current) =>
                          current.type === "showCg"
                            ? { ...current, overlay }
                            : current,
                      ),
                    );
                  }}
                  onPlaybackPosition={setPlaybackFollow}
                />
              </div>
              <nav className="galgame-inspector-tabs" aria-label="Block 检查器">
                <strong>检查器</strong>
                <button
                  type="button"
                  title="属性"
                  className={inspectorTab === "properties" ? "active" : ""}
                  onClick={() => setInspectorTab("properties")}
                >
                  <Settings2 aria-hidden /> <span>属性</span>
                </button>
                <button
                  type="button"
                  title="样式"
                  className={inspectorTab === "appearance" ? "active" : ""}
                  onClick={() => setInspectorTab("appearance")}
                >
                  <Palette aria-hidden /> <span>样式</span>
                </button>
                <button
                  type="button"
                  title="线路检查"
                  className={inspectorTab === "report" ? "active" : ""}
                  onClick={() => setInspectorTab("report")}
                >
                  <GitBranch aria-hidden /> <span>检查</span>
                  {reportIssueCount > 0 ? (
                    <span className="galgame-inspector-count">
                      {reportIssueCount}
                    </span>
                  ) : null}
                </button>
              </nav>
              <div className="galgame-inspector-body">
                <Suspense
                  fallback={
                    <div className="galgame-inspector-empty">
                      正在加载属性编辑器…
                    </div>
                  }
                >
                  {inspectorTab === "properties" ? (
                    selectedTimelineGap && selectedFragment ? (
                      <TimelineGapInspector
                        gap={selectedTimelineGap}
                        fragment={projectedSelectedFragment ?? selectedFragment}
                        document={document}
                        onDocument={replaceDocument}
                      />
                    ) : selectedBlock ? (
                      <BlockInspector
                        projectId={projectId}
                        block={selectedBlock}
                        document={document}
                        chapter={chapter}
                        fragmentId={selectedFragment?.id ?? ""}
                        onDocument={replaceDocument}
                        onNotice={setNotice}
                        onAutoMatchVoice={autoMatchDialogueVoice}
                        voiceStale={Boolean(
                          selectedBlock &&
                          staleVoiceBlocks.has(selectedBlock.id),
                        )}
                        onVoiceStale={() =>
                          selectedBlockId &&
                          setStaleVoiceBlocks((current) =>
                            new Set(current).add(selectedBlockId),
                          )
                        }
                        onVoiceFresh={() =>
                          selectedBlockId &&
                          setStaleVoiceBlocks((current) => {
                            const next = new Set(current);
                            next.delete(selectedBlockId);
                            return next;
                          })
                        }
                        timelinePreferences={timelinePreferences}
                        onMoveUp={() => moveSelected(-1, selectedBlock.id)}
                        onMoveDown={() => moveSelected(1, selectedBlock.id)}
                        onDelete={() => deleteSelected(selectedBlock.id)}
                        canMoveUp={Boolean(
                          scriptView !== "performance" && selectedFragment
                            ? canMoveStoryBlockBundle(
                                selectedFragment,
                                selectedBlock.id,
                                -1,
                              )
                            : selectedIndex != null && selectedIndex > 0,
                        )}
                        canMoveDown={Boolean(
                          scriptView !== "performance" && selectedFragment
                            ? canMoveStoryBlockBundle(
                                selectedFragment,
                                selectedBlock.id,
                                1,
                              )
                            : selectedIndex != null &&
                                selectedIndex >= 0 &&
                                selectedIndex <
                                  (selectedFragment?.blocks?.length ?? 0) - 1,
                        )}
                      />
                    ) : selectedFragment && projectedSelectedFragment ? (
                      <FragmentOverviewInspector
                        fragment={selectedFragment}
                        durationMs={
                          projectedSelectedFragment.timeline?.durationMs ?? 0
                        }
                        isEntry={
                          chapter.entryFragmentId === selectedFragment.id
                        }
                        estimated={!selectedFragment.timeline}
                      />
                    ) : (
                      <div className="galgame-inspector-empty">
                        <Settings2 aria-hidden />
                        <strong>未选择 Fragment</strong>
                      </div>
                    )
                  ) : inspectorTab === "appearance" ? (
                    <DialogueStyleInspector
                      projectId={projectId}
                      document={document}
                      onDocument={replaceDocument}
                    />
                  ) : (
                    <RouteReportInspector
                      report={report}
                      document={savedDocument}
                      error={reportQuery.error}
                      refreshing={reportRefreshing}
                      saving={saveState === "saving"}
                      onIssue={locateIssue}
                      onRoute={locateRoute}
                      onOpen={() => setReportOpen(true)}
                      onRefresh={() => void reportQuery.refetch()}
                    />
                  )}
                </Suspense>
              </div>
            </aside>
          </div>
        ) : workspace === "assets" ? (
          <AssetCenter
            projectId={projectId}
            document={document}
            storyRevision={revisionRef.current}
            section={assetSection}
            visualSection={visualSection}
            focusVisual={focusedVisual}
            onFocusVisualHandled={() => setFocusedVisual(undefined)}
            focusCharacterId={focusedCharacterId}
            onSection={setAssetSection}
            onVisualSection={setVisualSection}
            onDocument={replaceDocument}
            onCommitDocument={commitDocument}
            onRepairMissingAsset={repairMissingAsset}
            onUpgradePortraitSizes={upgradePortraitSizes}
            onNotice={setNotice}
            onCharacter={(characterId) => {
              setFocusedCharacterId(characterId);
              setAssetSection("characters");
            }}
            onLocate={(chapterId, fragmentId, blockId) => {
              const targetChapter =
                (chapterId ? chapterById(document, chapterId) : undefined) ??
                document.chapters?.find((item) =>
                  item.fragments?.some(
                    (fragment) => fragment.id === fragmentId,
                  ),
                );
              if (targetChapter) {
                setSelectedChapterId(targetChapter.id);
                const fragment = fragmentById(targetChapter, fragmentId);
                if (fragment) selectFragment(fragment);
              }
              setSelectedBlockId(blockId);
              setWorkspace("script");
              setInspectorTab("properties");
            }}
          />
        ) : workspace === "narrative" ? (
          <NarrativeMapWorkspace
            document={document}
            onDocument={replaceDocument}
            onLocate={(chapterId, fragmentId, blockId) => {
              const targetChapter = chapterById(document, chapterId);
              const targetFragment = targetChapter
                ? fragmentById(targetChapter, fragmentId)
                : undefined;
              if (targetChapter) setSelectedChapterId(targetChapter.id);
              if (targetFragment) setSelectedFragmentId(targetFragment.id);
              setSelectedBlockId(blockId ?? targetFragment?.blocks?.[0]?.id);
              setSelectedTimelineGapId(undefined);
              setWorkspace("script");
              setInspectorTab("properties");
            }}
          />
        ) : workspace === "personalization" ? (
          <PersonalizationWorkspace
            projectId={projectId}
            document={document}
            onDocument={replaceDocument}
          />
        ) : (
          <ProjectSettingsWorkspace
            title={projectQuery.data?.title ?? ""}
            document={document}
            savingTitle={titleSaving}
            onTitle={updateProjectTitle}
            onDocument={replaceDocument}
          />
        )}
        <GalgameEditorStatusAndSearch model={model} />

        <StoryConflictBanner
          open={Boolean(conflict)}
          onLoadServer={() => {
            if (!conflict) return;
            const next = completeStoryDocument(conflict.document);
            const nextChapter = entryChapter(next);
            const nextFragment = nextChapter?.fragments?.find(
              (fragment) => fragment.id === nextChapter.entryFragmentId,
            );
            revisionRef.current = conflict.revision;
            documentRef.current = next;
            conflictRef.current = false;
            client.setQueryData(STORY_KEY(projectId), conflict);
            setDocument(next);
            setSelectedChapterId(nextChapter?.id ?? "chapter-1");
            setSelectedFragmentId(
              nextFragment?.id ?? nextChapter?.fragments?.[0]?.id ?? "main",
            );
            setSelectedBlockId(undefined);
            setConflict(undefined);
            setSaveState("saved");
          }}
          onOverwrite={() => setConfirmOverwrite(true)}
        />
        <ConfirmDialog
          open={confirmOverwrite && Boolean(conflict)}
          title="用本地草稿覆盖服务器版本？"
          description="这会以服务器最新 revision 为基准保存当前本地草稿，服务器上的故事内容将被替换。"
          confirmLabel="确认覆盖"
          onCancel={() => setConfirmOverwrite(false)}
          onConfirm={() => {
            if (!conflict) return;
            revisionRef.current = conflict.revision;
            conflictRef.current = false;
            setConflict(undefined);
            setConfirmOverwrite(false);
            enqueueSave(documentRef.current!);
          }}
        />
        <GalgameEditorVideoExportDialog
          open={videoExportOpen}
          projectId={projectId}
          storyRevision={revisionRef.current}
          document={document}
          currentContext={[
            playbackFollow,
            selectedFragment?.id,
            timelinePreviewMs,
          ]}
          initialClipRange={segmentPreview.videoExportSeed}
          onClose={() => {
            setVideoExportOpen(false);
            segmentPreview.clearVideoExportSeed();
          }}
        />
        {segmentPreview.dialog}
      </section>
    </Suspense>
  );
}
