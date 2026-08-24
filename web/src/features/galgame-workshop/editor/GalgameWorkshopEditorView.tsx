import { Suspense, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpenText,
  Braces,
  ChevronDown,
  Clock3,
  Copy,
  Film,
  GitBranch,
  Languages,
  MapPinned,
  MoreHorizontal,
  Palette,
  Plus,
  Play,
  RefreshCcw,
  Save,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import { TimelinePlayheadAddMenu } from "@features/galgame-workshop/editor/TimelinePlayheadAddMenu";
import { StoryJsonView } from "@features/galgame-workshop/editor/StoryJsonView";
import { StoryLocalizationWorkspace } from "@features/galgame-workshop/editor/StoryLocalizationWorkspace";
import {
  canMoveStoryBlockBundle,
  continuingDialogueBlock,
  storyBlockBundles,
} from "@features/galgame-workshop/editor/blockFlow";
import {
  DEFAULT_SCRIPT_LAYOUT,
  normalizeScriptLayout,
} from "@features/galgame-workshop/editor/scriptLayoutPreferences";
import {
  completeStoryDocument,
  chapterById,
  entryChapter,
  fragmentById,
  referencedBy,
  stableId,
  updateChapter,
  updateBlock,
  updateFragment,
} from "@features/galgame-workshop/editor/model";
import { formatTimecode } from "@features/galgame-workshop/editor/timeline";
import { GalgameEditorVideoExportDialog } from "@features/galgame-workshop/editor/GalgameEditorVideoExportDialog";
import { StoryConflictBanner } from "@features/galgame-workshop/editor/StoryConflictBanner";
import { GlobalStorySearch } from "@features/galgame-workshop/editor/GlobalStorySearch";
import {
  RouteReportDialog,
  RouteReportInspector,
} from "@features/galgame-workshop/editor/RouteReport";
import {
  ChapterCast,
  Field,
  FragmentOverviewInspector,
} from "@features/galgame-workshop/editor/EditorShared";
import "@features/galgame-workshop/galgameStyles";
import "@features/galgame-workshop/galgame-json-view.css";
import type { EditorPageViewModel } from "@features/galgame-workshop/editor/editorViewModel";
import {
  EditorFastPreviewOverlay,
  EditorFastPreviewRunMenu,
} from "@features/galgame-workshop/editor/EditorFastPreviewOverlay";
import type { EditorFastPreviewSession } from "@features/galgame-workshop/editor/editorFastPreviewSession";
import {
  AssetCenter,
  BlockInspector,
  DialogueStyleInspector,
  NarrativeMapWorkspace,
  PersonalizationWorkspace,
  ProjectSettingsWorkspace,
  STORY_KEY,
  StoryBlockEditor,
  StoryPlayer,
  StoryTimelineEditor,
  TimelineGapInspector,
  WORKSPACES,
} from "@features/galgame-workshop/editor/editorWorkspaceModules";

export function GalgameWorkshopEditorView({
  model,
}: {
  model: EditorPageViewModel;
}) {
  const [fastPreview, setFastPreview] = useState<EditorFastPreviewSession>();
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
    playheadAddMenuRef,
    pendingCardFocusRef,
    workspace,
    setWorkspace,
    commandOpen,
    setCommandOpen,
    titleSaving,
    assetSection,
    setAssetSection,
    scriptView,
    setScriptView,
    localizationLocale,
    setLocalizationLocale,
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
    setTimelinePreferences,
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
    selectedTimelineGapId,
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
    reportOpen,
    setReportOpen,
    videoExportOpen,
    setVideoExportOpen,
    staleVoiceBlocks,
    setStaleVoiceBlocks,
    focusedCharacterId,
    setFocusedCharacterId,
    structureQuery,
    setStructureQuery,
    expandedChapterId,
    setExpandedChapterId,
    structureDrawerOpen,
    setStructureDrawerOpen,
    projectQuery,
    refetchStory,
    reportQuery,
    enqueueSave,
    replaceDocument,
    commitDocument,
    autoMatchDialogueVoice,
    upgradePortraitSizes,
    repairMissingAsset,
    previewTimelinePosition,
    chapter,
    fragments,
    selectedFragment,
    projectedSelectedFragment,
    timelineSourceFragment,
    timelineFragment,
    selectedBlock,
    selectedTimelineGap,
    report,
    savedDocument,
    reportRefreshing,
    reportIssueCount,
    selectedIndex,
    terminates,
    editableCgBlockId,
    selectFragment,
    selectChapter,
    addChapter,
    deleteChapter,
    moveChapter,
    duplicateChapter,
    addFragment,
    deleteFragment,
    duplicateFragment,
    moveFragment,
    insertPreparedBlock,
    addBlock,
    addAllCharactersBlock,
    addAudioBlock,
    moveSelected,
    deleteSelected,
    locateIssue,
    locateRoute,
    locateSearchTarget,
    updateProjectTitle,
    startStageResize,
    setStageCollapsed,
    startSidebarResize,
    resizeSidebarWithKeyboard,
    resetSidebarWidth,
    effectiveCenterRatio,
    editorGridStyle,
  } = model;
  if (fastPreview)
    return (
      <EditorFastPreviewOverlay
        session={fastPreview}
        model={model}
        onClose={() => setFastPreview(undefined)}
      />
    );
  return (
    <Suspense
      fallback={<div className="page-loading">正在加载编辑器模块…</div>}
    >
      <section className="galgame-editor-page">
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
                setPreviewMode("edit");
                setVideoExportOpen(true);
              }}
            >
              <Film aria-hidden /> 导出视频
            </button>
            <EditorFastPreviewRunMenu model={model} onLaunch={setFastPreview} />
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
            <aside
              className={`galgame-fragment-panel${structureDrawerOpen ? " is-drawer-open" : ""}`}
            >
              <div className="galgame-panel-heading">
                <span>
                  <small>剧本结构</small>
                </span>
                <button
                  type="button"
                  aria-label="新建章节"
                  onClick={addChapter}
                >
                  <Plus aria-hidden /> 章节
                </button>
              </div>
              <label className="galgame-structure-search-field">
                <Search aria-hidden />
                <input
                  className="galgame-structure-search"
                  aria-label="搜索章节或 Fragment"
                  placeholder="搜索章节 / 片段"
                  value={structureQuery}
                  onChange={(event) => setStructureQuery(event.target.value)}
                />
              </label>
              {entryChapter(document) ? (
                <button
                  type="button"
                  className="galgame-entry-fragment"
                  onClick={() => selectChapter(entryChapter(document)!)}
                >
                  <Play aria-hidden />
                  <strong>开始</strong>
                </button>
              ) : null}
              <details className="galgame-story-settings">
                <summary>
                  <Settings2 aria-hidden /> 故事设置 <ChevronDown aria-hidden />
                </summary>
                <Field label="故事简介">
                  <textarea
                    value={document.synopsis}
                    placeholder="用几句话说明故事核心…"
                    onChange={(event) =>
                      replaceDocument({
                        ...document,
                        synopsis: event.target.value,
                      })
                    }
                  />
                </Field>
                <div className="galgame-story-variables">
                  <span>项目变量</span>
                  {(document.variables ?? []).map((variable) => (
                    <div key={variable.id}>
                      <input
                        aria-label={`${variable.name}名称`}
                        value={variable.name}
                        onChange={(event) =>
                          replaceDocument({
                            ...document,
                            variables: (document.variables ?? []).map((item) =>
                              item.id === variable.id
                                ? { ...item, name: event.target.value }
                                : item,
                            ),
                          })
                        }
                      />
                      <code>{variable.type}</code>
                      <button
                        type="button"
                        aria-label={`删除变量 ${variable.name}`}
                        disabled={
                          referencedBy(document, "variable", variable.id)
                            .length > 0
                        }
                        onClick={() =>
                          replaceDocument({
                            ...document,
                            variables: (document.variables ?? []).filter(
                              (item) => item.id !== variable.id,
                            ),
                          })
                        }
                      >
                        <Trash2 aria-hidden />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      replaceDocument({
                        ...document,
                        variables: [
                          ...(document.variables ?? []),
                          {
                            id: stableId(),
                            name: `变量 ${(document.variables?.length ?? 0) + 1}`,
                            type: "boolean",
                            defaultValue: false,
                            persistence: "session",
                            description: "",
                          },
                        ],
                      })
                    }
                  >
                    <Plus aria-hidden /> 添加变量
                  </button>
                </div>
                <Field label="章节名称">
                  <input
                    value={chapter.title}
                    onChange={(event) =>
                      replaceDocument(
                        updateChapter(document, chapter.id, (current) => ({
                          ...current,
                          title: event.target.value,
                        })),
                      )
                    }
                  />
                </Field>
              </details>
              <div className="galgame-chapter-tree">
                {[...(document.chapters ?? [])]
                  .sort((left, right) => left.order - right.order)
                  .filter(
                    (item) =>
                      !structureQuery.trim() ||
                      item.title.includes(structureQuery.trim()) ||
                      item.fragments?.some((fragment) =>
                        fragment.title.includes(structureQuery.trim()),
                      ),
                  )
                  .map((item, chapterIndex) => {
                    const branchCount = (item.fragments ?? []).reduce(
                      (total, fragment) =>
                        total +
                        (fragment.blocks ?? []).filter(
                          (block) => block.type === "branch",
                        ).length,
                      0,
                    );
                    const expanded = expandedChapterId === item.id;
                    return (
                      <div
                        key={item.id}
                        className={item.id === chapter.id ? "active" : ""}
                      >
                        <div className="galgame-chapter-row">
                          <button
                            type="button"
                            className="galgame-chapter-main"
                            onClick={() => selectChapter(item)}
                          >
                            <span className="galgame-chapter-number">
                              {String(chapterIndex + 1).padStart(2, "0")}
                            </span>
                            <span className="galgame-chapter-copy">
                              <span>
                                <strong>{item.title}</strong>
                                {document.entryChapterId === item.id ? (
                                  <i>入口章</i>
                                ) : null}
                                {item.disabled ? <i>已禁用</i> : null}
                              </span>
                              <small>
                                <ChapterCast
                                  document={document}
                                  chapter={item}
                                />
                                {branchCount > 0 ? (
                                  <em>
                                    <GitBranch aria-hidden /> {branchCount}
                                  </em>
                                ) : null}
                                {item.fragments?.length ?? 0} 片段
                              </small>
                            </span>
                          </button>
                          <button
                            type="button"
                            className="galgame-chapter-expand"
                            aria-label={`${expanded ? "收起" : "展开"}${item.title}片段`}
                            aria-expanded={expanded}
                            onClick={() =>
                              setExpandedChapterId(
                                expanded ? undefined : item.id,
                              )
                            }
                          >
                            <ChevronDown aria-hidden />
                          </button>
                        </div>
                        {expanded ? (
                          <div className="galgame-fragment-list">
                            {(item.fragments ?? [])
                              .filter(
                                (fragment) =>
                                  !structureQuery.trim() ||
                                  fragment.title.includes(
                                    structureQuery.trim(),
                                  ),
                              )
                              .map((fragment) => (
                                <button
                                  key={fragment.id}
                                  type="button"
                                  className={
                                    selectedFragment?.id === fragment.id
                                      ? "active"
                                      : ""
                                  }
                                  onClick={() => selectFragment(fragment)}
                                >
                                  <span>
                                    <GitBranch aria-hidden />
                                    <strong>{fragment.title}</strong>
                                  </span>
                                  <span>
                                    {item.entryFragmentId === fragment.id ? (
                                      <em>入口</em>
                                    ) : null}
                                    <small>
                                      {fragment.blocks?.length ?? 0}
                                    </small>
                                  </span>
                                </button>
                              ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
              </div>
              <div className="galgame-structure-actions">
                <button type="button" onClick={addFragment}>
                  <Plus aria-hidden /> Fragment
                </button>
                <details className="galgame-structure-actions-menu">
                  <summary aria-label="章节与片段操作">
                    <MoreHorizontal aria-hidden />
                  </summary>
                  <div>
                    <button
                      type="button"
                      aria-label="章节上移"
                      disabled={chapter.order <= 1}
                      onClick={() => moveChapter(chapter, -1)}
                    >
                      <ArrowUp aria-hidden /> 章节上移
                    </button>
                    <button
                      type="button"
                      aria-label="章节下移"
                      disabled={
                        chapter.order >=
                        Math.max(1, document.chapters?.length ?? 1)
                      }
                      onClick={() => moveChapter(chapter, 1)}
                    >
                      <ArrowDown aria-hidden /> 章节下移
                    </button>
                    <button
                      type="button"
                      aria-label="复制章节"
                      onClick={() => duplicateChapter(chapter)}
                    >
                      <Copy aria-hidden /> 复制章节
                    </button>
                    <button
                      type="button"
                      disabled={document.entryChapterId === chapter.id}
                      onClick={() =>
                        replaceDocument(
                          updateChapter(
                            { ...document, entryChapterId: chapter.id },
                            chapter.id,
                            (current) => ({ ...current, disabled: false }),
                          ),
                        )
                      }
                    >
                      设为入口章
                    </button>
                    <button
                      type="button"
                      disabled={document.entryChapterId === chapter.id}
                      onClick={() =>
                        replaceDocument(
                          updateChapter(document, chapter.id, (current) => ({
                            ...current,
                            disabled: !current.disabled,
                          })),
                        )
                      }
                    >
                      {chapter.disabled ? "启用" : "禁用"}
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => deleteChapter(chapter)}
                    >
                      删除章
                    </button>
                  </div>
                </details>
              </div>
              {selectedFragment ? (
                <details className="galgame-fragment-actions">
                  <summary>当前片段 · {selectedFragment.title}</summary>
                  <div>
                    <input
                      aria-label="结构树 Fragment 名称"
                      value={selectedFragment.title}
                      onChange={(event) =>
                        replaceDocument(
                          updateFragment(
                            document,
                            selectedFragment.id,
                            (current) => ({
                              ...current,
                              title: event.target.value,
                            }),
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      aria-label="Fragment 上移"
                      disabled={fragments[0]?.id === selectedFragment.id}
                      onClick={() => moveFragment(selectedFragment, -1)}
                    >
                      <ArrowUp aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label="Fragment 下移"
                      disabled={fragments.at(-1)?.id === selectedFragment.id}
                      onClick={() => moveFragment(selectedFragment, 1)}
                    >
                      <ArrowDown aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label="复制 Fragment"
                      onClick={() => duplicateFragment(selectedFragment)}
                    >
                      <Copy aria-hidden />
                    </button>
                    <button
                      type="button"
                      disabled={chapter.entryFragmentId === selectedFragment.id}
                      onClick={() =>
                        replaceDocument(
                          updateChapter(document, chapter.id, (current) => ({
                            ...current,
                            entryFragmentId: selectedFragment.id,
                          })),
                        )
                      }
                    >
                      设为入口
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => deleteFragment(selectedFragment)}
                    >
                      删除
                    </button>
                  </div>
                </details>
              ) : null}
              <footer>
                <span /> {fragments.length} 个 Fragment · 自动保存已开启
              </footer>
            </aside>

            <button
              type="button"
              className={`galgame-structure-drawer-backdrop${structureDrawerOpen ? " is-open" : ""}`}
              aria-label="关闭剧本结构"
              onClick={() => setStructureDrawerOpen(false)}
            />

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
                        {storyBlockBundles(selectedFragment).length} 个可见
                        Block
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
                        previewMode === "edit"
                          ? selectedTimelineGapId
                          : undefined
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
                        previewMode === "play"
                          ? playbackFollow?.positionMs
                          : undefined
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
                          updateFragment(
                            document,
                            selectedFragment.id,
                            () => fragment,
                          ),
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
                        setStaleVoiceBlocks((current) =>
                          new Set(current).add(blockId),
                        )
                      }
                    />
                  )}
                </>
              ) : null}
            </main>

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
        <footer className="galgame-editor-statusbar">
          <span className={saveState}>
            <i />
            自动保存
            {saveState === "saved"
              ? "已开启"
              : saveState === "saving"
                ? "中"
                : "需处理"}
          </span>
          <span>
            {WORKSPACES.find((item) => item.id === workspace)?.label}
            {workspace === "script"
              ? ` / ${chapter.title} / ${selectedFragment?.title ?? ""}`
              : ""}
          </span>
          <span className={reportIssueCount ? "warning" : "healthy"}>
            {reportIssueCount ? `${reportIssueCount} 个线路问题` : "线路正常"}
          </span>
          <a
            href="https://docs.avg-engine.com/manual/overview/editor"
            target="_blank"
            rel="noreferrer"
          >
            帮助文档
          </a>
          <span>Story {document.schemaVersion}</span>
        </footer>
        <GlobalStorySearch
          open={commandOpen}
          document={document}
          onClose={() => setCommandOpen(false)}
          onSelect={locateSearchTarget}
        />

        <RouteReportDialog
          open={reportOpen}
          report={report}
          document={savedDocument}
          error={reportQuery.error}
          refreshing={reportRefreshing}
          saving={saveState === "saving"}
          onClose={() => setReportOpen(false)}
          onIssue={(issue) => {
            setReportOpen(false);
            locateIssue(issue);
          }}
          onRoute={(route) => {
            setReportOpen(false);
            locateRoute(route);
          }}
          onRefresh={() => void reportQuery.refetch()}
        />

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
          onClose={() => setVideoExportOpen(false)}
        />
      </section>
    </Suspense>
  );
}
