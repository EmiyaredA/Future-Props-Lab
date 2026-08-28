import {
  type GalgameStoryBlock,
  type GalgameStoryChapter,
  type GalgameStoryFragment,
} from "@features/galgame-workshop/api";
import {
  deleteStoryBlockBundle,
  insertStoryBlock,
  moveStoryBlockBundle,
  storyBlockBundles,
} from "@features/galgame-workshop/editor/blockFlow";
import {
  chapterById,
  fragmentById,
  makeBlock,
  makeAudioBlock,
  referencedBy,
  stableId,
  type BlockKind,
  updateChapter,
  updateFragment,
} from "@features/galgame-workshop/editor/model";
import {
  DEFAULT_CHARACTER_TRANSITION,
  emptyStageState,
  replayStageAtTime,
  replayStageToBlock,
} from "@features/galgame-workshop/editor/stage";
import {
  appendBlockToTimeline,
  projectFragmentTimeline,
} from "@features/galgame-workshop/editor/timeline";
import { type StorySearchTarget } from "@features/galgame-workshop/editor/GlobalStorySearch";
import {
  type GalgameStoryReportIssue,
  type StoryRoute,
} from "@features/galgame-workshop/editor/RouteReport";
import "@features/galgame-workshop/galgameStyles";
import "@features/galgame-workshop/galgame-json-view.css";
import { createGalgameEditorLayout } from "./createGalgameEditorLayout";
import { useGalgameWorkshopEditorBase } from "./useGalgameWorkshopEditorBase";
export function useGalgameWorkshopEditorController({
  projectId,
  onOverview,
}: {
  projectId: string;
  onOverview: () => void;
}) {
  const base = useGalgameWorkshopEditorBase({ projectId });
  if (base.status !== "ready") return base;
  const {
    assetSection,
    autoMatchDialogueVoice,
    chapter,
    client,
    commandOpen,
    commitDocument,
    commitDialogueEdit,
    commitStageExpressionEdit,
    confirmOverwrite,
    conflict,
    conflictRef,
    document,
    documentRef,
    editableCgBlockId,
    editorGridRef,
    enqueueSave,
    expandedChapterId,
    focusedCharacterId,
    focusedVisual,
    fragments,
    inspectorTab,
    localizationLocale,
    notice,
    pendingCardFocusRef,
    playbackFollow,
    playerRef,
    playheadAddMenuRef,
    previewMode,
    previewRef,
    previewReloadKey,
    previewStart,
    previewTimelinePosition,
    projectQuery,
    projectedSelectedFragment,
    refetchStory,
    repairMissingAsset,
    replaceDocument,
    report,
    reportIssueCount,
    reportOpen,
    reportQuery,
    reportRefreshing,
    revisionRef,
    saveMessage,
    saveState,
    savedDocument,
    scriptLayout,
    scriptView,
    selectedBlock,
    selectedBlockId,
    selectedFragment,
    selectedIndex,
    selectedTimelineGap,
    selectedTimelineGapId,
    setAssetSection,
    setCommandOpen,
    setConfirmOverwrite,
    setConflict,
    setDocument,
    setExpandedChapterId,
    setFocusedCharacterId,
    setFocusedVisual,
    setInspectorTab,
    setLocalizationLocale,
    setNotice,
    setPlaybackFollow,
    setPreviewMode,
    setPreviewReloadKey,
    setPreviewStart,
    setReportOpen,
    setSaveState,
    setScriptLayout,
    setScriptView,
    setSelectedBlockId,
    setSelectedChapterId,
    setSelectedFragmentId,
    setSelectedTimelineGapId,
    setStageViewportPreferences,
    setStaleVoiceBlocks,
    setStructureDrawerOpen,
    setStructureQuery,
    setTimelinePreferences,
    setTimelinePreviewMs,
    setVideoExportOpen,
    setVisualSection,
    setWorkspace,
    stageViewportPreferences,
    staleVoiceBlocks,
    structureDrawerOpen,
    structureQuery,
    terminates,
    timelineFragment,
    timelinePreferences,
    timelinePreviewMs,
    timelineSourceFragment,
    titleSaving,
    updateProjectTitle,
    upgradePortraitSizes,
    videoExportOpen,
    visualSection,
    workspace,
  } = base;
  const selectFragment = (fragment: GalgameStoryFragment) => {
    setSelectedFragmentId(fragment.id);
    setSelectedTimelineGapId(undefined);
    setSelectedBlockId(undefined);
    setTimelinePreviewMs(null);
    setStructureDrawerOpen(false);
  };
  const selectChapter = (nextChapter: GalgameStoryChapter) => {
    const fragment =
      nextChapter.fragments?.find(
        (item) => item.id === nextChapter.entryFragmentId,
      ) ?? nextChapter.fragments?.[0];
    setSelectedChapterId(nextChapter.id);
    setSelectedFragmentId(fragment?.id ?? "main");
    setSelectedBlockId(undefined);
    setSelectedTimelineGapId(undefined);
    setTimelinePreviewMs(null);
    setStructureDrawerOpen(false);
  };
  const addChapter = () => {
    const id = stableId();
    const fragmentId = stableId();
    const nextChapter: GalgameStoryChapter = {
      id,
      title: `第 ${(document.chapters?.length ?? 0) + 1} 章`,
      order:
        Math.max(0, ...(document.chapters ?? []).map((item) => item.order)) + 1,
      entryFragmentId: fragmentId,
      disabled: false,
      fragments: [{ id: fragmentId, title: "开始", blocks: [] }],
    };
    replaceDocument({
      ...document,
      chapters: [...(document.chapters ?? []), nextChapter],
    });
    selectChapter(nextChapter);
  };
  const deleteChapter = (target: GalgameStoryChapter) => {
    if (target.id === document.entryChapterId) {
      setNotice("入口章节不能删除，请先设置其他入口章。");
      return;
    }
    if ((document.chapters?.length ?? 0) <= 1) {
      setNotice("工程至少需要保留一个章节。");
      return;
    }
    const fragmentIds = new Set(
      (target.fragments ?? []).map((fragment) => fragment.id),
    );
    const externalReferences = (document.chapters ?? [])
      .filter((item) => item.id !== target.id)
      .flatMap((item) => item.fragments ?? [])
      .flatMap((fragment) =>
        (fragment.blocks ?? []).flatMap((block) => {
          if (
            block.type === "branch" &&
            block.choices.some((choice) =>
              fragmentIds.has(choice.targetFragmentId),
            )
          )
            return [`Fragment“${fragment.title}”的分支`];
          if (
            block.type === "callFragment" &&
            fragmentIds.has(block.targetFragmentId)
          )
            return [`Fragment“${fragment.title}”的调用`];
          if (
            block.type === "if" &&
            (fragmentIds.has(block.thenFragmentId) ||
              (block.elseFragmentId && fragmentIds.has(block.elseFragmentId)))
          )
            return [`Fragment“${fragment.title}”的条件`];
          return [];
        }),
      );
    if (externalReferences.length) {
      setNotice(`无法删除：${[...new Set(externalReferences)].join("、")}`);
      return;
    }
    const remaining = (document.chapters ?? [])
      .filter((item) => item.id !== target.id)
      .map((item, index) => ({ ...item, order: index + 1 }));
    replaceDocument({ ...document, chapters: remaining });
    selectChapter(remaining[0]);
  };
  const moveChapter = (target: GalgameStoryChapter, direction: -1 | 1) => {
    const chapters = [...(document.chapters ?? [])].sort(
      (left, right) => left.order - right.order,
    );
    const index = chapters.findIndex((item) => item.id === target.id);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= chapters.length) return;
    [chapters[index], chapters[destination]] = [
      chapters[destination],
      chapters[index],
    ];
    replaceDocument({
      ...document,
      chapters: chapters.map((item, itemIndex) => ({
        ...item,
        order: itemIndex + 1,
      })),
    });
  };
  const duplicateChapter = (target: GalgameStoryChapter) => {
    const fragmentIds = new Map(
      (target.fragments ?? []).map((fragment) => [fragment.id, stableId()]),
    );
    const remapBlock = (block: GalgameStoryBlock): GalgameStoryBlock => {
      const next = { ...structuredClone(block), id: stableId() };
      if (next.type === "branch")
        return {
          ...next,
          choices: next.choices.map((choice) => ({
            ...choice,
            targetFragmentId:
              fragmentIds.get(choice.targetFragmentId) ??
              choice.targetFragmentId,
          })),
        };
      if (next.type === "callFragment")
        return {
          ...next,
          targetFragmentId:
            fragmentIds.get(next.targetFragmentId) ?? next.targetFragmentId,
        };
      if (next.type === "if")
        return {
          ...next,
          thenFragmentId:
            fragmentIds.get(next.thenFragmentId) ?? next.thenFragmentId,
          elseFragmentId: next.elseFragmentId
            ? (fragmentIds.get(next.elseFragmentId) ?? next.elseFragmentId)
            : null,
        };
      return next;
    };
    const nextChapter: GalgameStoryChapter = {
      ...structuredClone(target),
      id: stableId(),
      title: `${target.title} 副本`,
      order: (document.chapters?.length ?? 0) + 1,
      disabled: false,
      entryFragmentId:
        fragmentIds.get(target.entryFragmentId) ?? target.entryFragmentId,
      fragments: (target.fragments ?? []).map((fragment) => ({
        ...structuredClone(fragment),
        id: fragmentIds.get(fragment.id)!,
        blocks: (fragment.blocks ?? []).map(remapBlock),
      })),
    };
    replaceDocument({
      ...document,
      chapters: [...(document.chapters ?? []), nextChapter],
    });
    selectChapter(nextChapter);
  };
  const addFragment = () => {
    const id = stableId();
    replaceDocument(
      updateChapter(document, chapter.id, (current) => ({
        ...current,
        fragments: [
          ...(current.fragments ?? []),
          {
            id,
            title: `Fragment ${(current.fragments?.length ?? 0) + 1}`,
            blocks: [],
          },
        ],
      })),
    );
    setSelectedFragmentId(id);
    setSelectedTimelineGapId(undefined);
    setSelectedBlockId(undefined);
  };
  const deleteFragment = (fragment: GalgameStoryFragment) => {
    const references = referencedBy(document, "fragment", fragment.id);
    if (references.length) {
      setNotice(`无法删除：${references.join("、")}`);
      return;
    }
    if (fragments.length <= 1) {
      setNotice("章节至少需要保留一个 Fragment。");
      return;
    }
    const remaining = fragments.filter((item) => item.id !== fragment.id);
    replaceDocument(
      updateChapter(document, chapter.id, (current) => ({
        ...current,
        fragments: remaining,
      })),
    );
    selectFragment(remaining[0]);
  };
  const duplicateFragment = (fragment: GalgameStoryFragment) => {
    const nextId = stableId();
    const nextFragment: GalgameStoryFragment = {
      ...structuredClone(fragment),
      id: nextId,
      title: `${fragment.title} 副本`,
      blocks: (fragment.blocks ?? []).map((block) => {
        const next = { ...structuredClone(block), id: stableId() };
        if (next.type === "branch")
          return {
            ...next,
            choices: next.choices.map((choice) => ({
              ...choice,
              targetFragmentId:
                choice.targetFragmentId === fragment.id
                  ? nextId
                  : choice.targetFragmentId,
            })),
          };
        if (next.type === "callFragment")
          return {
            ...next,
            targetFragmentId:
              next.targetFragmentId === fragment.id
                ? nextId
                : next.targetFragmentId,
          };
        if (next.type === "if")
          return {
            ...next,
            thenFragmentId:
              next.thenFragmentId === fragment.id
                ? nextId
                : next.thenFragmentId,
            elseFragmentId:
              next.elseFragmentId === fragment.id
                ? nextId
                : next.elseFragmentId,
          };
        return next;
      }),
    };
    replaceDocument(
      updateChapter(document, chapter.id, (current) => ({
        ...current,
        fragments: [...(current.fragments ?? []), nextFragment],
      })),
    );
    selectFragment(nextFragment);
  };
  const moveFragment = (fragment: GalgameStoryFragment, direction: -1 | 1) => {
    const items = [...fragments];
    const index = items.findIndex((item) => item.id === fragment.id);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= items.length) return;
    [items[index], items[destination]] = [items[destination], items[index]];
    replaceDocument(
      updateChapter(document, chapter.id, (current) => ({
        ...current,
        fragments: items,
      })),
    );
  };
  const insertPreparedBlock = (
    block: GalgameStoryBlock,
    beforeBundleId?: string,
  ) => {
    if (!selectedFragment) return;
    replaceDocument(
      updateFragment(document, selectedFragment.id, (fragment) =>
        scriptView !== "performance"
          ? insertStoryBlock(fragment, block, beforeBundleId)
          : appendBlockToTimeline(
              projectFragmentTimeline(fragment),
              block,
              timelinePreviewMs ?? 0,
            ),
      ),
    );
    setSelectedBlockId(block.id);
    setSelectedTimelineGapId(undefined);
    setInspectorTab("properties");
  };
  const addBlock = (kind: BlockKind, beforeBundleId?: string) => {
    if (!selectedFragment) return;
    const blocks = selectedFragment.blocks ?? [];
    const beforeIndex = beforeBundleId
      ? blocks.findIndex((candidate) => candidate.id === beforeBundleId)
      : blocks.length;
    const presentationStage =
      scriptView === "performance"
        ? replayStageAtTime(document, selectedFragment, timelinePreviewMs ?? 0)
            .stage
        : beforeIndex > 0
          ? replayStageToBlock(document, selectedFragment, beforeIndex - 1)
          : emptyStageState();
    const block = makeBlock(
      kind,
      document,
      chapter,
      selectedFragment,
      presentationStage,
    );
    if (!block) {
      if (kind === "showCg") {
        setNotice("请先在画面工作区创建 CG 并绑定默认差分。");
        setFocusedVisual(undefined);
        setVisualSection("cgs");
        setAssetSection("scenes");
        setWorkspace("assets");
        return;
      }
      setNotice(
        kind === "branch"
          ? "分支需要先准备至少两个其他 Fragment。"
          : kind === "dialogue" ||
              kind === "showCharacter" ||
              kind === "removeCharacter"
            ? "请先创建角色。"
            : "请先创建场景。",
      );
      return;
    }
    if (block.type === "dialogue" || block.type === "narration")
      pendingCardFocusRef.current = block.id;
    insertPreparedBlock(block, beforeBundleId);
  };
  const addAllCharactersBlock = (beforeBundleId?: string) => {
    if (!selectedFragment) return;
    const block: GalgameStoryBlock = {
      id: stableId(),
      type: "removeCharacter",
      characterId: null,
      all: true,
      transition: DEFAULT_CHARACTER_TRANSITION,
    };
    insertPreparedBlock(block, beforeBundleId);
  };
  const addAudioBlock = (
    action: "play" | "stop",
    channel: "bgm" | "ambient" | "sfx",
    beforeBundleId?: string,
  ) => {
    if (!selectedFragment) return;
    const block = makeAudioBlock(document, action, channel);
    if (!block) {
      setNotice(
        `请先在声音工作区添加${
          { bgm: "背景音乐", ambient: "环境音", sfx: "音效" }[channel]
        }素材。`,
      );
      setAssetSection(channel === "bgm" ? "bgm" : "sfx");
      setWorkspace("assets");
      return;
    }
    insertPreparedBlock(block, beforeBundleId);
  };
  const moveSelected = (direction: -1 | 1, requestedBlockId?: string) => {
    const blockId = requestedBlockId ?? selectedBlockId;
    if (!selectedFragment || !blockId) return;
    replaceDocument(
      updateFragment(document, selectedFragment.id, (fragment) => {
        if (scriptView !== "performance")
          return moveStoryBlockBundle(fragment, blockId, direction);
        const blocks = fragment.blocks ?? [];
        const index = blocks.findIndex((block) => block.id === blockId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= blocks.length) return fragment;
        const reordered = [...blocks];
        [reordered[index], reordered[target]] = [
          reordered[target],
          reordered[index],
        ];
        return { ...fragment, blocks: reordered };
      }),
    );
  };
  const deleteSelected = (requestedBlockId?: string) => {
    const blockId = requestedBlockId ?? selectedBlockId;
    if (!selectedFragment || !blockId) return;
    const blocks = selectedFragment.blocks ?? [];
    const index = blocks.findIndex((block) => block.id === blockId);
    const bundleIndex = storyBlockBundles(selectedFragment).findIndex(
      (bundle) => bundle.blocks.some((block) => block.id === blockId),
    );
    const nextFragment =
      scriptView !== "performance"
        ? deleteStoryBlockBundle(selectedFragment, blockId)
        : {
            ...selectedFragment,
            blocks: blocks.filter((block) => block.id !== blockId),
          };
    replaceDocument(
      updateFragment(document, selectedFragment.id, () => nextFragment),
    );
    const nextBundles = storyBlockBundles(nextFragment);
    const nextSelection =
      scriptView !== "performance"
        ? nextBundles[
            Math.min(Math.max(0, bundleIndex), nextBundles.length - 1)
          ]?.primaryBlock.id
        : nextFragment.blocks?.[Math.min(index, nextFragment.blocks.length - 1)]
            ?.id;
    setSelectedBlockId(nextSelection);
    setSelectedTimelineGapId(undefined);
  };
  const locateIssue = (issue: GalgameStoryReportIssue) => {
    const issueChapter = issue.chapter_id
      ? chapterById(document, issue.chapter_id)
      : undefined;
    if (issueChapter) {
      selectChapter(issueChapter);
      setExpandedChapterId(issueChapter.id);
    }
    if (issue.fragment_id) {
      const fragment = fragmentById(issueChapter ?? chapter, issue.fragment_id);
      if (fragment) selectFragment(fragment);
    }
    if (issue.block_id) {
      setSelectedTimelineGapId(undefined);
      setSelectedBlockId(issue.block_id);
    }
    setWorkspace("script");
    setInspectorTab(issue.block_id ? "properties" : "report");
  };
  const locateRoute = (route: StoryRoute) => {
    const routeChapter = document.chapters?.find(
      (candidate) => candidate.id === route.chapterId,
    );
    const fragment = routeChapter?.fragments?.find(
      (candidate) => candidate.id === route.sourceId,
    );
    if (fragment) {
      setSelectedChapterId(routeChapter?.id ?? chapter.id);
      setExpandedChapterId(routeChapter?.id ?? chapter.id);
      setSelectedFragmentId(fragment.id);
      setSelectedTimelineGapId(undefined);
      setSelectedBlockId(route.blockId);
    }
    setWorkspace("script");
    setInspectorTab("properties");
  };
  const startPreview = (scope: "project" | "chapter" | "block" = "project") => {
    const cursor =
      scope === "project"
        ? undefined
        : scope === "chapter"
          ? {
              chapterId: chapter.id,
              fragmentId: chapter.entryFragmentId,
            }
          : selectedFragment
            ? {
                chapterId: chapter.id,
                fragmentId: selectedFragment.id,
                blockIndex: Math.max(0, selectedIndex ?? 0),
              }
            : undefined;
    setPreviewStart(cursor);
    setWorkspace("script");
    setPreviewMode("play");
    requestAnimationFrame(() => {
      playerRef.current?.restart();
      previewRef.current?.focus();
    });
  };

  const locateSearchTarget = (target: StorySearchTarget) => {
    if (target.kind === "story") {
      const targetChapter = chapterById(document, target.chapterId);
      const targetFragment = targetChapter
        ? fragmentById(targetChapter, target.fragmentId)
        : undefined;
      if (targetChapter) setSelectedChapterId(targetChapter.id);
      if (targetChapter) setExpandedChapterId(targetChapter.id);
      if (targetFragment) setSelectedFragmentId(targetFragment.id);
      setSelectedBlockId(target.blockId ?? targetFragment?.blocks?.[0]?.id);
      setSelectedTimelineGapId(undefined);
      setWorkspace("script");
      return;
    }
    setWorkspace("assets");
    if (target.kind === "character") {
      setFocusedCharacterId(target.characterId);
      setAssetSection("characters");
    } else if (target.kind === "scene") {
      setAssetSection("scenes");
      setVisualSection("scenes");
      setFocusedVisual({ kind: "scene", id: target.sceneId });
    } else if (target.kind === "cg") {
      setAssetSection("scenes");
      setVisualSection("cgs");
      setFocusedVisual({ kind: "cg", id: target.cgId });
    } else {
      setAssetSection("overview");
    }
  };

  const {
    startStageResize,
    setStageCollapsed,
    startSidebarResize,
    resizeSidebarWithKeyboard,
    resetSidebarWidth,
    effectiveCenterRatio,
    editorGridStyle,
  } = createGalgameEditorLayout(base);
  return {
    status: "ready" as const,
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
    commitDialogueEdit,
    commitStageExpressionEdit,
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
    startPreview,
    locateSearchTarget,
    updateProjectTitle,
    startStageResize,
    setStageCollapsed,
    startSidebarResize,
    resizeSidebarWithKeyboard,
    resetSidebarWidth,
    effectiveCenterRatio,
    editorGridStyle,
  };
}
