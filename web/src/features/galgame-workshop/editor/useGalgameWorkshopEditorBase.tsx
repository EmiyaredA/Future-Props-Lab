import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@platform/api/client";
import { publishResourceRevision } from "@platform/sync/resourceBroadcast";
import {
  applyGalgamePortraitUpgrade,
  getGalgameStoryDocument,
  getGalgameStoryReport,
  getGalgameWorkshopProject,
  matchGalgameVoiceDialogue,
  patchGalgameStoryDialogue,
  patchGalgameStoryEdits,
  patchGalgameStoryStageExpression,
  patchGalgameWorkshopProject,
  putGalgameStoryDocument,
  repairGalgameMissingAsset,
  type GalgameStoryDocument,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  DEFAULT_TARGET_LOCALE,
  pruneStoryLocalizations,
} from "@features/galgame-workshop/editor/localization";
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
  loadScriptLayout,
  storeScriptLayout,
  type ScriptLayoutPreferences,
} from "@features/galgame-workshop/editor/scriptLayoutPreferences";
import {
  completeStoryDocument,
  chapterById,
  entryChapter,
  fragmentById,
  isTerminator,
  type AssetSection,
  type EditorWorkspace,
} from "@features/galgame-workshop/editor/model";
import type { FastPreviewDialogueEdit } from "@features/galgame-workshop/editor/fastPreviewDialogueEdit";
import type { FastPreviewStoryEdit } from "@features/galgame-workshop/editor/fastPreviewEdits";
import { invalidateGalgameAssetQueries } from "@features/galgame-workshop/queryKeys";
import type { FastPreviewStageExpressionEdit } from "@features/galgame-workshop/editor/fastPreviewStageExpressionEdit";
import type { StoryPlayerHandle } from "@features/galgame-workshop/editor/StoryPlayer";
import {
  projectFragmentTimeline,
  timelineGaps,
} from "@features/galgame-workshop/editor/timeline";
import { galgameQueryKeys } from "@features/galgame-workshop/queryKeys";
const STORY_KEY = galgameQueryKeys.story;
const REPORT_KEY = galgameQueryKeys.storyReport;
const PROJECT_KEY = galgameQueryKeys.project;

type SaveState = "saved" | "saving" | "error" | "conflict";
type InspectorTab = "properties" | "appearance" | "report";
type ScriptView = "blocks" | "json" | "performance" | "localization";

const SCRIPT_VIEW_KEY = "future_props_galgame_editor_script_view";
const selectedBlockKey = (projectId: string, fragmentId: string) =>
  `future_props_galgame_selected_block:${projectId}:${fragmentId}`;
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

export function useGalgameWorkshopEditorBase({
  projectId,
}: {
  projectId: string;
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
          publishResourceRevision({
            kind: "galgame-story",
            id: projectId,
            revision: updated.revision,
          });
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
      autoSave.current = setTimeout(() => {
        autoSave.current = undefined;
        void enqueueSave(documentRef.current!);
      }, 650);
    },
    [enqueueSave],
  );

  const commitDocument = useCallback(
    async (next: GalgameStoryProject) => {
      if (autoSave.current) {
        clearTimeout(autoSave.current);
        autoSave.current = undefined;
      }
      documentRef.current = next;
      setDocument(next);
      setSaveState("saving");
      return enqueueSave(next);
    },
    [enqueueSave],
  );
  const commitFastPreviewEdit = useCallback(
    async (
      next: GalgameStoryProject,
      edit:
        | FastPreviewDialogueEdit
        | FastPreviewStageExpressionEdit
        | FastPreviewStoryEdit[],
    ) => {
      const pendingDocument = documentRef.current;
      const scheduledFullSave = Boolean(autoSave.current);
      if (autoSave.current) {
        clearTimeout(autoSave.current);
        autoSave.current = undefined;
      }
      if (
        (scheduledFullSave || saveState === "error") &&
        pendingDocument &&
        !(await enqueueSave(pendingDocument))
      )
        return undefined;
      documentRef.current = next;
      setDocument(next);
      setSaveState("saving");
      const operation = saveQueue.current.then(async () => {
        if (conflictRef.current) return undefined;
        setSaveMessage("");
        try {
          const updated = Array.isArray(edit)
            ? await patchGalgameStoryEdits(projectId, edit, revisionRef.current)
            : "text" in edit
              ? await patchGalgameStoryDialogue(
                  projectId,
                  edit,
                  revisionRef.current,
                )
              : await patchGalgameStoryStageExpression(
                  projectId,
                  edit,
                  revisionRef.current,
                );
          const committedDocument =
            "document" in updated
              ? completeStoryDocument(updated.document)
              : next;
          revisionRef.current = updated.revision;
          documentRef.current = committedDocument;
          setDocument(committedDocument);
          client.setQueryData<GalgameStoryDocument>(STORY_KEY(projectId), {
            project_id: updated.project_id,
            document: committedDocument,
            revision: updated.revision,
            updated_at: updated.updated_at,
          });
          setSaveState("saved");
          void client.invalidateQueries({ queryKey: REPORT_KEY(projectId) });
          void client.invalidateQueries({ queryKey: PROJECT_KEY(projectId) });
          void client.invalidateQueries({
            queryKey: ["galgame-workshop-projects"],
          });
          return updated;
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            const current = error.problem.current as
              GalgameStoryDocument | undefined;
            if (current) {
              conflictRef.current = true;
              setConflict(current);
              setSaveState("conflict");
              return undefined;
            }
          }
          setSaveState("error");
          setSaveMessage(errorMessage(error));
          return undefined;
        }
      });
      saveQueue.current = operation.then(() => undefined);
      return operation;
    },
    [client, enqueueSave, projectId, saveState],
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
        void invalidateGalgameAssetQueries(client, projectId);
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

  return {
    status: "ready" as const,
    assetSection,
    autoMatchDialogueVoice,
    chapter,
    client,
    commandOpen,
    commitDocument,
    commitDialogueEdit: commitFastPreviewEdit,
    commitStageExpressionEdit: commitFastPreviewEdit,
    commitBatchEdits: commitFastPreviewEdit,
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
    resizeCleanupRef,
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
    setStructureQuery,
    setTimelinePreferences,
    setTimelinePreviewMs,
    setVideoExportOpen,
    setVisualSection,
    setWorkspace,
    stageViewportPreferences,
    staleVoiceBlocks,
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
  };
}

export type GalgameWorkshopEditorBase = Extract<
  ReturnType<typeof useGalgameWorkshopEditorBase>,
  { status: "ready" }
>;
