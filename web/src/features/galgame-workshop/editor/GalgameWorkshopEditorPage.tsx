import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpenText,
  Braces,
  ChevronDown,
  Clock3,
  Copy,
  GitBranch,
  Images,
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
import { ApiError } from "@platform/api/client";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
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
import { TimelinePlayheadAddMenu } from "@features/galgame-workshop/editor/TimelinePlayheadAddMenu";
import { StoryJsonView } from "@features/galgame-workshop/editor/StoryJsonView";
import { StoryLocalizationWorkspace } from "@features/galgame-workshop/editor/StoryLocalizationWorkspace";
import {
  DEFAULT_TARGET_LOCALE,
  pruneStoryLocalizations,
} from "@features/galgame-workshop/editor/localization";
import {
  canMoveStoryBlockBundle,
  continuingDialogueBlock,
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
  updateBlock,
  updateFragment,
} from "@features/galgame-workshop/editor/model";
import type { StoryPlayerHandle } from "@features/galgame-workshop/editor/StoryPlayer";
import {
  characterTransform,
  DEFAULT_CHARACTER_TRANSFORM,
  DEFAULT_CHARACTER_TRANSITION,
  replayStageToBlock,
} from "@features/galgame-workshop/editor/stage";
import {
  appendBlockToTimeline,
  formatTimecode,
  projectFragmentTimeline,
  timelineGaps,
} from "@features/galgame-workshop/editor/timeline";
import {
  GlobalStorySearch,
  type StorySearchTarget,
} from "@features/galgame-workshop/editor/GlobalStorySearch";
import {
  RouteReportDialog,
  RouteReportInspector,
  type GalgameStoryReportIssue,
  type StoryRoute,
} from "@features/galgame-workshop/editor/RouteReport";
import {
  ChapterCast,
  Field,
  FragmentOverviewInspector,
} from "@features/galgame-workshop/editor/EditorShared";
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

const BlockInspector = lazy(() =>
  import("@features/galgame-workshop/editor/EditorInspectors").then(
    (module) => ({
      default: module.BlockInspector,
    }),
  ),
);
const TimelineGapInspector = lazy(() =>
  import("@features/galgame-workshop/editor/EditorInspectors").then(
    (module) => ({
      default: module.TimelineGapInspector,
    }),
  ),
);
const StoryTimelineEditor = lazy(() =>
  import("@features/galgame-workshop/editor/StoryTimelineEditor").then(
    (module) => ({
      default: module.StoryTimelineEditor,
    }),
  ),
);
const StoryBlockEditor = lazy(() =>
  import("@features/galgame-workshop/editor/StoryBlockEditor").then(
    (module) => ({
      default: module.StoryBlockEditor,
    }),
  ),
);
const StoryPlayer = lazy(() =>
  import("@features/galgame-workshop/editor/StoryPlayer").then((module) => ({
    default: module.StoryPlayer,
  })),
);
const AssetCenter = lazy(() =>
  import("@features/galgame-workshop/editor/AssetCenter").then((module) => ({
    default: module.AssetCenter,
  })),
);
const DialogueStyleInspector = lazy(() =>
  import("@features/galgame-workshop/editor/DialogueStyleInspector").then(
    (module) => ({ default: module.DialogueStyleInspector }),
  ),
);
const NarrativeMapWorkspace = lazy(() =>
  import("@features/galgame-workshop/editor/NarrativeMapWorkspace").then(
    (module) => ({ default: module.NarrativeMapWorkspace }),
  ),
);
const PersonalizationWorkspace = lazy(() =>
  import("@features/galgame-workshop/editor/ProjectWorkspaces").then(
    (module) => ({
      default: module.PersonalizationWorkspace,
    }),
  ),
);
const ProjectSettingsWorkspace = lazy(() =>
  import("@features/galgame-workshop/editor/ProjectWorkspaces").then(
    (module) => ({
      default: module.ProjectSettingsWorkspace,
    }),
  ),
);
const WORKSPACES: Array<{
  id: EditorWorkspace;
  label: string;
  icon: typeof BookOpenText;
}> = [
  { id: "script", label: "剧本", icon: BookOpenText },
  { id: "assets", label: "资产", icon: Images },
  { id: "narrative", label: "叙事地图", icon: GitBranch },
  { id: "personalization", label: "个性化", icon: Palette },
  { id: "settings", label: "设置", icon: Settings2 },
];

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

export function GalgameWorkshopEditorPage({
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
    return (
      <div className="workshop-state galgame-editor-state">
        <RefreshCcw className="spinning" aria-hidden />
        <strong>正在打开剧本编辑器</strong>
      </div>
    );
  if (storyQuery.isError || projectQuery.isError)
    return (
      <div className="workshop-state galgame-editor-state">
        <strong>剧本编辑器暂时无法打开</strong>
        <button onClick={() => window.location.reload()}>重新加载</button>
      </div>
    );

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
  const editableCharacterId =
    selectedBlock?.type === "showCharacter" ||
    (selectedBlock?.type === "dialogue" &&
      selectedBlock.portrait &&
      selectedBlock.portrait.mode === "stage" &&
      selectedBlock.portrait.visible !== false)
      ? selectedBlock.characterId
      : undefined;
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
    const block = makeBlock(kind, document, chapter, selectedFragment);
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
            <details className="galgame-run-menu">
              <summary
                className="galgame-preview-launch"
                role="button"
                aria-label="开始试玩"
                onClick={() => startPreview("project")}
              >
                <Play aria-hidden /> 运行 <ChevronDown aria-hidden />
              </summary>
              <div>
                <button type="button" onClick={() => startPreview("project")}>
                  从项目入口开始
                </button>
                <button type="button" onClick={() => startPreview("chapter")}>
                  从当前章节开始
                </button>
                <button
                  type="button"
                  disabled={!selectedBlock}
                  onClick={() => startPreview("block")}
                >
                  从当前 Block 开始
                </button>
              </div>
            </details>
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
                  editableCharacterId={editableCharacterId}
                  editableCgBlockId={editableCgBlockId}
                  onCharacterPosition={(x, y) => {
                    if (!selectedBlock || !selectedFragment) return;
                    replaceDocument(
                      updateBlock(
                        document,
                        selectedFragment.id,
                        selectedBlock.id,
                        (current) => {
                          if (current.type === "showCharacter")
                            return {
                              ...current,
                              transform: {
                                ...characterTransform(current.transform),
                                x,
                                y,
                              },
                            };
                          if (current.type === "dialogue" && current.portrait) {
                            const stage = replayStageToBlock(
                              document,
                              selectedFragment,
                              selectedIndex ?? 0,
                            );
                            const inherited =
                              stage.actors[current.characterId]?.transform ??
                              DEFAULT_CHARACTER_TRANSFORM;
                            return {
                              ...current,
                              portrait: {
                                ...current.portrait,
                                transform: {
                                  ...inherited,
                                  ...current.portrait.transform,
                                  x,
                                  y,
                                },
                              },
                            };
                          }
                          return current;
                        },
                      ),
                    );
                  }}
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

        {conflict ? (
          <div className="galgame-conflict" role="alert">
            <span>
              <strong>故事存在更新冲突</strong>
              本地草稿仍保留，请选择要使用的版本。
            </span>
            <button
              type="button"
              onClick={() => {
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
            >
              载入服务器版本
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => setConfirmOverwrite(true)}
            >
              用本地版本覆盖
            </button>
          </div>
        ) : null}
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
      </section>
    </Suspense>
  );
}
