/* eslint-disable react-refresh/only-export-components */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@platform/api/client";
import {
  applyGalgamePortraitUpgrade,
  getGalgameStoryDocument,
  getGalgameStoryReport,
  getGalgameWorkshopProject,
  matchGalgameVoiceDialogue,
  patchGalgameWorkshopProject,
  putGalgameStoryDocument,
  repairGalgameMissingAsset,
  type GalgameStoryBlock,
  type GalgameStoryChapter,
  type GalgameStoryDocument,
  type GalgameStoryFragment,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  DEFAULT_TARGET_LOCALE,
  pruneStoryLocalizations,
} from "@features/galgame-workshop/editor/localization";
import {
  deleteStoryBlockBundle,
  insertStoryBlock,
  moveStoryBlockBundle,
  storyBlockBundles,
} from "@features/galgame-workshop/editor/blockFlow";
import {
  loadTimelinePreferences,
  storeTimelinePreferences,
  type TimelinePreferences,
} from "@features/galgame-workshop/editor/timelinePreferences";
import {
  loadStageViewportPreferences,
  storeStageViewportPreferences,
} from "@features/galgame-workshop/editor/stageViewportPreferences";
import {
  DEFAULT_SCRIPT_LAYOUT,
  loadScriptLayout,
  normalizeScriptLayout,
  storeScriptLayout,
  type ScriptLayoutPreferences,
} from "@features/galgame-workshop/editor/scriptLayoutPreferences";
import {
  completeStoryDocument,
  chapterById,
  entryChapter,
  fragmentById,
  isTerminator,
  makeBlock,
  makeAudioBlock,
  referencedBy,
  stableId,
  type BlockKind,
  type AssetSection,
  type EditorWorkspace,
  updateChapter,
  updateFragment,
} from "@features/galgame-workshop/editor/model";
import type { StoryPlayerHandle } from "@features/galgame-workshop/editor/StoryPlayer";
import {
  DEFAULT_CHARACTER_TRANSITION,
  emptyStageState,
  replayStageAtTime,
  replayStageToBlock,
} from "@features/galgame-workshop/editor/stage";
import {
  appendBlockToTimeline,
  projectFragmentTimeline,
  timelineGaps,
} from "@features/galgame-workshop/editor/timeline";
import { type StorySearchTarget } from "@features/galgame-workshop/editor/GlobalStorySearch";
import {
  type GalgameStoryReportIssue,
  type StoryRoute,
} from "@features/galgame-workshop/editor/RouteReport";
import "@features/galgame-workshop/galgame-workshop.css";
import "@features/galgame-workshop/galgame-script-workbench.css";
import "@features/galgame-workshop/galgame-json-view.css";
const STORY_KEY = (projectId: string) =>
  ["galgame-workshop-story", projectId] as const;
const REPORT_KEY = (projectId: string) =>
  ["galgame-workshop-story-report", projectId] as const;
const PROJECT_KEY = (projectId: string) =>
  ["galgame-workshop-project", projectId] as const;

type SaveState = "saved" | "saving" | "error" | "conflict";
type InspectorTab = "properties" | "appearance" | "report";
type ScriptView = "blocks" | "json" | "performance" | "localization";

const SCRIPT_VIEW_KEY = "future_props_galgame_editor_script_view";
const selectedBlockKey = (projectId: string, fragmentId: string) =>
  `future_props_galgame_selected_block:${projectId}:${fragmentId}`;
function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function loadScriptView(): ScriptView {
  const stored = localStorage.getItem(SCRIPT_VIEW_KEY);
  return stored === "json" ||
    stored === "performance" ||
    stored === "localization"
    ? stored
    : "blocks";
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.problem.code === "revision_conflict")
    return "故事已在其他页面更新，请选择要保留的版本。";
  return error instanceof Error ? error.message : "保存失败，请稍后重试。";
}

export function useGalgameWorkshopEditorController({
  projectId,
  onOverview,
}: {
  projectId: string;
  onOverview: () => void;
}) {
  const client = useQueryClient();
  const revisionRef = useRef(0);
  const documentRef = useRef<GalgameStoryProject | undefined>(undefined);
  const saveQueue = useRef(Promise.resolve());
  const autoSave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conflictRef = useRef(false);
  const initialized = useRef(false);
  const playerRef = useRef<StoryPlayerHandle>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const editorGridRef = useRef<HTMLDivElement>(null);
  const playheadAddMenuRef = useRef<HTMLDetailsElement>(null);
  const resizeCleanupRef = useRef<(() => void) | undefined>(undefined);
  const pendingCardFocusRef = useRef<string | undefined>(undefined);
  const [workspace, setWorkspace] = useState<EditorWorkspace>("script");
  const [commandOpen, setCommandOpen] = useState(false);
  const [titleSaving, setTitleSaving] = useState(false);
  const [assetSection, setAssetSection] = useState<AssetSection>("overview");
  const [scriptView, setScriptView] = useState<ScriptView>(loadScriptView);
  const [localizationLocale, setLocalizationLocale] = useState(
    DEFAULT_TARGET_LOCALE,
  );
  const [visualSection, setVisualSection] = useState<"scenes" | "cgs">(
    "scenes",
  );
  const [focusedVisual, setFocusedVisual] = useState<{
    kind: "scene" | "cg";
    id: string;
  }>();
  const [previewMode, setPreviewMode] = useState<"edit" | "play">("edit");
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const [previewStart, setPreviewStart] = useState<{
    chapterId: string;
    fragmentId: string;
    blockIndex?: number;
  }>();
  const [scriptLayout, setScriptLayout] =
    useState<ScriptLayoutPreferences>(loadScriptLayout);
  const [playbackFollow, setPlaybackFollow] = useState<{
    chapterId: string;
    fragmentId: string;
    positionMs: number;
    blockId?: string;
  }>();
  const [timelinePreviewMs, setTimelinePreviewMs] = useState<number | null>(
    null,
  );
  const [timelinePreferences, setTimelinePreferences] =
    useState<TimelinePreferences>(loadTimelinePreferences);
  const [stageViewportPreferences, setStageViewportPreferences] = useState(
    loadStageViewportPreferences,
  );
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("properties");
  const [document, setDocument] = useState<GalgameStoryProject>();
  const [selectedChapterId, setSelectedChapterId] = useState("chapter-1");
  const [selectedFragmentId, setSelectedFragmentId] = useState("main");
  const [selectedBlockId, setSelectedBlockId] = useState<string>();
  const [selectedTimelineGapId, setSelectedTimelineGapId] = useState<string>();
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveMessage, setSaveMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState<GalgameStoryDocument>();
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [videoExportOpen, setVideoExportOpen] = useState(false);
  const [staleVoiceBlocks, setStaleVoiceBlocks] = useState<Set<string>>(
    () => new Set(),
  );
  const [focusedCharacterId, setFocusedCharacterId] = useState<string>();
  const [structureQuery, setStructureQuery] = useState("");
  const [expandedChapterId, setExpandedChapterId] = useState<string>();
  const [structureDrawerOpen, setStructureDrawerOpen] = useState(false);

  useEffect(() => {
    storeTimelinePreferences(timelinePreferences);
  }, [timelinePreferences]);

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, []);

  useEffect(() => {
    localStorage.setItem(SCRIPT_VIEW_KEY, scriptView);
  }, [scriptView]);

  useEffect(() => {
    const blockId = pendingCardFocusRef.current;
    if (!blockId) return;
    const card = globalThis.document.querySelector<HTMLElement>(
      `[data-block-id="${blockId}"]`,
    );
    if (!card) return;
    const textarea = card.querySelector<HTMLTextAreaElement>("textarea");
    if (textarea) {
      pendingCardFocusRef.current = undefined;
      textarea.focus();
      return;
    }
    card.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
    );
    requestAnimationFrame(() => {
      const editor = card.querySelector<HTMLTextAreaElement>("textarea");
      if (!editor) return;
      pendingCardFocusRef.current = undefined;
      editor.focus();
    });
  }, [document]);

  useEffect(() => {
    storeStageViewportPreferences(stageViewportPreferences);
  }, [stageViewportPreferences]);

  useEffect(() => {
    storeScriptLayout(scriptLayout);
  }, [scriptLayout]);

  useEffect(() => {
    if (!selectedBlockId || !selectedFragmentId) return;
    localStorage.setItem(
      selectedBlockKey(projectId, selectedFragmentId),
      selectedBlockId,
    );
  }, [projectId, selectedBlockId, selectedFragmentId]);

  useEffect(() => {
    if (!document) return;
    const targetChapter =
      chapterById(document, selectedChapterId) ?? entryChapter(document);
    const targetFragment = targetChapter
      ? (fragmentById(targetChapter, selectedFragmentId) ??
        targetChapter.fragments?.[0])
      : undefined;
    if (!targetFragment?.blocks?.length) return;
    if (targetFragment.blocks.some((block) => block.id === selectedBlockId))
      return;
    const remembered = localStorage.getItem(
      selectedBlockKey(projectId, targetFragment.id),
    );
    const next =
      targetFragment.blocks.find((block) => block.id === remembered)?.id ??
      targetFragment.blocks[0].id;
    setSelectedBlockId(next);
  }, [
    document,
    projectId,
    selectedBlockId,
    selectedChapterId,
    selectedFragmentId,
  ]);

  const projectQuery = useQuery({
    queryKey: PROJECT_KEY(projectId),
    queryFn: () => getGalgameWorkshopProject(projectId),
  });
  const storyQuery = useQuery({
    queryKey: STORY_KEY(projectId),
    queryFn: () => getGalgameStoryDocument(projectId),
  });
  const { refetch: refetchStory } = storyQuery;
  const reportQuery = useQuery({
    queryKey: REPORT_KEY(projectId),
    queryFn: () => getGalgameStoryReport(projectId),
  });

  useEffect(() => {
    if (!storyQuery.data) return;
    const next = completeStoryDocument(storyQuery.data.document);
    if (initialized.current) {
      if (storyQuery.data.revision <= revisionRef.current) return;
      if (saveState !== "saved" || conflictRef.current) {
        conflictRef.current = true;
        setConflict(storyQuery.data);
        setSaveState("conflict");
        setNotice(
          `服务器已有 revision ${storyQuery.data.revision}，本地改动未被覆盖。`,
        );
        return;
      }
      const nextChapter =
        chapterById(next, selectedChapterId) ?? entryChapter(next);
      const preservedFragment = nextChapter?.fragments?.find(
        (fragment) => fragment.id === selectedFragmentId,
      );
      const entryFragment = nextChapter?.fragments?.find(
        (fragment) => fragment.id === nextChapter.entryFragmentId,
      );
      const targetFragment =
        preservedFragment ?? entryFragment ?? nextChapter?.fragments?.[0];
      const preservedBlock = targetFragment?.blocks?.find(
        (block) => block.id === selectedBlockId,
      );
      revisionRef.current = storyQuery.data.revision;
      documentRef.current = next;
      setDocument(next);
      setSelectedChapterId(nextChapter?.id ?? "chapter-1");
      setSelectedFragmentId(targetFragment?.id ?? "main");
      setSelectedBlockId(selectedBlockId ? preservedBlock?.id : undefined);
      if (
        selectedTimelineGapId &&
        (!targetFragment ||
          !timelineGaps(targetFragment).some(
            (gap) => gap.id === selectedTimelineGapId,
          ))
      )
        setSelectedTimelineGapId(undefined);
      setNotice(`已载入服务器 revision ${storyQuery.data.revision}。`);
      return;
    }
    const initialChapter = entryChapter(next);
    const entry = initialChapter?.entryFragmentId ?? "main";
    initialized.current = true;
    revisionRef.current = storyQuery.data.revision;
    documentRef.current = next;
    setDocument(next);
    setSelectedChapterId(initialChapter?.id ?? "chapter-1");
    setSelectedFragmentId(entry);
    setSelectedBlockId(undefined);
  }, [
    saveState,
    selectedBlockId,
    selectedChapterId,
    selectedFragmentId,
    selectedTimelineGapId,
    storyQuery.data,
  ]);

  useEffect(() => {
    const refreshOnFocus = () => void refetchStory();
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [refetchStory]);

  useEffect(
    () => () => {
      if (autoSave.current) clearTimeout(autoSave.current);
      resizeCleanupRef.current?.();
    },
    [],
  );

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (saveState === "saved") return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [saveState]);

  const enqueueSave = useCallback(
    (snapshot: GalgameStoryProject) => {
      const copy = structuredClone(snapshot);
      let saved = false;
      const operation = saveQueue.current.then(async () => {
        if (conflictRef.current) return false;
        setSaveState("saving");
        setSaveMessage("");
        try {
          const updated = await putGalgameStoryDocument(
            projectId,
            copy,
            revisionRef.current,
          );
          revisionRef.current = updated.revision;
          client.setQueryData(STORY_KEY(projectId), updated);
          setSaveState("saved");
          void client.invalidateQueries({ queryKey: REPORT_KEY(projectId) });
          void client.invalidateQueries({ queryKey: PROJECT_KEY(projectId) });
          void client.invalidateQueries({
            queryKey: ["galgame-workshop-projects"],
          });
          saved = true;
          return true;
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            const current = error.problem.current as
              GalgameStoryDocument | undefined;
            if (current) {
              conflictRef.current = true;
              setConflict(current);
              setSaveState("conflict");
              return false;
            }
          }
          setSaveState("error");
          setSaveMessage(errorMessage(error));
          return false;
        }
      });
      saveQueue.current = operation.then(() => undefined);
      return operation.then(() => saved);
    },
    [client, projectId],
  );

  const replaceDocument = useCallback(
    (next: GalgameStoryProject) => {
      const normalized = pruneStoryLocalizations(next);
      documentRef.current = normalized;
      setDocument(normalized);
      setSaveState("saving");
      if (autoSave.current) clearTimeout(autoSave.current);
      autoSave.current = setTimeout(
        () => enqueueSave(documentRef.current!),
        650,
      );
    },
    [enqueueSave],
  );

  const commitDocument = useCallback(
    async (next: GalgameStoryProject) => {
      if (autoSave.current) clearTimeout(autoSave.current);
      documentRef.current = next;
      setDocument(next);
      setSaveState("saving");
      return enqueueSave(next);
    },
    [enqueueSave],
  );
  const autoMatchDialogueVoice = useCallback(
    async (blockId: string) => {
      const current = documentRef.current;
      if (!current || !(await commitDocument(current))) return false;
      try {
        const result = await matchGalgameVoiceDialogue(
          projectId,
          revisionRef.current,
          undefined,
          [blockId],
        );
        const latest = await getGalgameStoryDocument(projectId);
        const next = completeStoryDocument(latest.document);
        revisionRef.current = latest.revision;
        documentRef.current = next;
        setDocument(next);
        client.setQueryData(STORY_KEY(projectId), latest);
        setSaveState("saved");
        void client.invalidateQueries({ queryKey: REPORT_KEY(projectId) });
        if (result.matches.length) {
          setNotice("已为当前对白自动匹配语音。");
          return true;
        }
        setNotice("未找到适合当前对白的语音。");
        return false;
      } catch (error) {
        setNotice(errorMessage(error));
        return false;
      }
    },
    [client, commitDocument, projectId],
  );
  const upgradePortraitSizes = useCallback(async () => {
    const current = documentRef.current;
    if (!current || !(await commitDocument(current))) return false;
    try {
      const updated = await applyGalgamePortraitUpgrade(
        projectId,
        revisionRef.current,
      );
      const next = completeStoryDocument(updated.document);
      revisionRef.current = updated.revision;
      documentRef.current = next;
      setDocument(next);
      client.setQueryData(STORY_KEY(projectId), updated);
      void client.invalidateQueries({ queryKey: REPORT_KEY(projectId) });
      setNotice("已按素材尺寸升级立绘高度，并保存了可恢复快照。");
      return true;
    } catch (error) {
      setNotice(errorMessage(error));
      return false;
    }
  }, [client, commitDocument, projectId]);
  const repairMissingAsset = useCallback(
    async (storyAssetId: string, replacementFileId: string) => {
      const current = documentRef.current;
      if (!current || !(await commitDocument(current))) return false;
      try {
        const updated = await repairGalgameMissingAsset(
          projectId,
          revisionRef.current,
          storyAssetId,
          replacementFileId,
        );
        const next = completeStoryDocument(updated.document);
        revisionRef.current = updated.revision;
        documentRef.current = next;
        setDocument(next);
        client.setQueryData(STORY_KEY(projectId), updated);
        void client.invalidateQueries({ queryKey: REPORT_KEY(projectId) });
        void client.invalidateQueries({
          queryKey: ["galgame-asset-overview", projectId],
        });
        void client.invalidateQueries({
          queryKey: ["galgame-package-manifest", projectId],
        });
        setSaveState("saved");
        setNotice("缺失素材已重新绑定并保存。");
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          const currentDocument = error.problem.current as
            GalgameStoryDocument | undefined;
          if (currentDocument) {
            conflictRef.current = true;
            setConflict(currentDocument);
            setSaveState("conflict");
          }
        }
        setNotice(errorMessage(error));
        return false;
      }
    },
    [client, commitDocument, projectId],
  );
  const previewTimelinePosition = useCallback((milliseconds: number | null) => {
    setTimelinePreviewMs(milliseconds);
  }, []);

  if (storyQuery.isLoading || projectQuery.isLoading || !document)
    return { status: "loading" as const };
  if (storyQuery.isError || projectQuery.isError)
    return { status: "error" as const };

  const chapter =
    chapterById(document, selectedChapterId) ?? entryChapter(document)!;
  const fragments = chapter.fragments ?? [];
  const selectedFragment =
    fragmentById(chapter, selectedFragmentId) ?? fragments[0];
  const projectedSelectedFragment = selectedFragment
    ? projectFragmentTimeline(selectedFragment)
    : undefined;
  const playbackSourceChapter = playbackFollow
    ? chapterById(document, playbackFollow.chapterId)
    : undefined;
  const playbackSourceFragment =
    playbackFollow && playbackSourceChapter
      ? fragmentById(playbackSourceChapter, playbackFollow.fragmentId)
      : undefined;
  const timelineSourceFragment =
    previewMode === "play" && playbackSourceFragment
      ? playbackSourceFragment
      : selectedFragment;
  const timelineFragment = timelineSourceFragment
    ? projectFragmentTimeline(timelineSourceFragment)
    : undefined;
  const rememberedSelectedBlockId = selectedFragment
    ? localStorage.getItem(selectedBlockKey(projectId, selectedFragment.id))
    : undefined;
  const selectedBlock =
    selectedFragment?.blocks?.find((block) => block.id === selectedBlockId) ??
    selectedFragment?.blocks?.find(
      (block) => block.id === rememberedSelectedBlockId,
    ) ??
    selectedFragment?.blocks?.[0];
  const selectedTimelineGap = projectedSelectedFragment
    ? timelineGaps(projectedSelectedFragment).find(
        (gap) => gap.id === selectedTimelineGapId,
      )
    : undefined;
  const report = reportQuery.data;
  const savedDocument = completeStoryDocument(
    storyQuery.data?.document ?? document,
  );
  const reportRefreshing = Boolean(
    reportQuery.isFetching ||
    (report && report.story_revision !== storyQuery.data?.revision),
  );
  const reportIssueCount = report
    ? report.errors.length + report.warnings.length
    : 0;
  const selectedIndex = selectedFragment?.blocks?.findIndex(
    (block) => block.id === selectedBlock?.id,
  );
  const lastBlock = selectedFragment?.blocks?.at(-1);
  const terminates = lastBlock ? isTerminator(lastBlock) : false;
  const editableCgBlockId =
    selectedBlock?.type === "showCg" &&
    (selectedBlock.displayMode ?? "fullscreen") === "overlay"
      ? selectedBlock.id
      : undefined;

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

  const updateProjectTitle = async (title: string) => {
    if (!projectQuery.data) return;
    setTitleSaving(true);
    try {
      const updated = await patchGalgameWorkshopProject(projectQuery.data, {
        title,
      });
      client.setQueryData(PROJECT_KEY(projectId), updated);
      void client.invalidateQueries({
        queryKey: ["galgame-workshop-projects"],
      });
      setNotice("项目名称已保存。");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setTitleSaving(false);
    }
  };

  const startStageResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      stageViewportPreferences.collapsed ||
      event.button !== 0 ||
      window.innerWidth <= 980
    ) {
      return;
    }
    event.preventDefault();
    resizeCleanupRef.current?.();
    const move = (pointer: PointerEvent) => {
      const grid = editorGridRef.current;
      const bounds = grid?.getBoundingClientRect();
      if (!grid || !bounds) return;
      setScriptLayout((current) =>
        normalizeScriptLayout({
          ...current,
          previewSplitRatio:
            Math.round(
              clamp(
                ((pointer.clientY - bounds.top) / bounds.height) * 100,
                42,
                72,
              ) * 100,
            ) / 100,
        }),
      );
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      resizeCleanupRef.current = undefined;
    };
    resizeCleanupRef.current = finish;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const setStageCollapsed = (collapsed: boolean) => {
    setStageViewportPreferences((current) => ({ ...current, collapsed }));
  };

  const startSidebarResize = (
    side: "left" | "right",
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeCleanupRef.current?.();
    globalThis.document.body.classList.add("galgame-sidebar-resizing");

    const move = (pointer: PointerEvent) => {
      const bounds = editorGridRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const available = Math.max(1, bounds.width - 12);
      const pointerRatio =
        ((pointer.clientX - bounds.left - (side === "right" ? 6 : 0)) /
          available) *
        100;
      setScriptLayout((current) =>
        normalizeScriptLayout(
          side === "left"
            ? { ...current, leftRatio: pointerRatio }
            : scriptView === "performance" || scriptView === "localization"
              ? {
                  ...current,
                  performanceCenterRatio: pointerRatio - current.leftRatio,
                }
              : {
                  ...current,
                  centerRatio: pointerRatio - current.leftRatio,
                },
        ),
      );
    };
    const finish = () => {
      globalThis.document.body.classList.remove("galgame-sidebar-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      resizeCleanupRef.current = undefined;
    };
    resizeCleanupRef.current = finish;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const resizeSidebarWithKeyboard = (
    side: "left" | "right",
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 0.5 : -0.5;
    setScriptLayout((current) =>
      normalizeScriptLayout(
        side === "left"
          ? { ...current, leftRatio: current.leftRatio + delta }
          : scriptView === "performance" || scriptView === "localization"
            ? {
                ...current,
                performanceCenterRatio: current.performanceCenterRatio + delta,
              }
            : { ...current, centerRatio: current.centerRatio + delta },
      ),
    );
  };

  const resetSidebarWidth = (side: "left" | "right") =>
    setScriptLayout((current) =>
      normalizeScriptLayout(
        side === "left"
          ? { ...current, leftRatio: DEFAULT_SCRIPT_LAYOUT.leftRatio }
          : scriptView === "performance" || scriptView === "localization"
            ? {
                ...current,
                performanceCenterRatio:
                  DEFAULT_SCRIPT_LAYOUT.performanceCenterRatio,
              }
            : { ...current, centerRatio: DEFAULT_SCRIPT_LAYOUT.centerRatio },
      ),
    );

  const effectiveCenterRatio =
    scriptView === "performance" || scriptView === "localization"
      ? scriptLayout.performanceCenterRatio
      : scriptLayout.centerRatio;
  const editorGridStyle = {
    "--galgame-script-left-ratio": scriptLayout.leftRatio,
    "--galgame-script-center-ratio": effectiveCenterRatio,
    "--galgame-stage-split": `${scriptLayout.previewSplitRatio}%`,
  } as CSSProperties;

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
