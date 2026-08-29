import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  batchUploadGalgameProjectAssets,
  deleteGalgameProjectAsset,
  getGalgameAssetOverview,
  getGalgamePackageManifest,
  getGalgameProjectAssets,
  patchGalgameProjectAsset,
  previewGalgameAssetImport,
  scanGalgameAssetMetadata,
  type GalgameAssetCategory,
  type GalgameProjectAsset,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  galgameQueryKeys,
  invalidateGalgameAssetQueries,
} from "@features/galgame-workshop/queryKeys";
import {
  ASSET_TOOLBAR_HEIGHT,
  KIND_META,
  MIN_BROWSER_HEIGHT,
  MIN_SUMMARY_HEIGHT,
  SUMMARY_HEIGHT_KEY,
  SUMMARY_RESIZER_HEIGHT,
  assetError,
  cleanPath,
  directoryTree,
  displayKind,
  loadSummaryHeight,
  matchesStatus,
  type AssetDisplayKind,
  type AssetItem,
  type AssetSelection,
  type AssetStatus,
} from "@features/galgame-workshop/editor/assetOverviewModel";

export function useAssetOverviewController({
  projectId,
  document,
  onLocate,
  onNotice,
  onRepairMissingAsset,
}: {
  projectId: string;
  document: GalgameStoryProject;
  onLocate: (
    chapterId: string | undefined,
    fragmentId: string,
    blockId: string,
  ) => void;
  onNotice: (message: string) => void;
  onRepairMissingAsset: (
    storyAssetId: string,
    replacementFileId: string,
  ) => Promise<boolean>;
}) {
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const workbenchRef = useRef<HTMLElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const summaryResizeCleanupRef = useRef<(() => void) | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AssetStatus>("all");
  const [kind, setKind] = useState<AssetDisplayKind | "all">("all");
  const [directory, setDirectory] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [summaryHeight, setSummaryHeight] = useState<number | null>(
    loadSummaryHeight,
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selection, setSelection] = useState<AssetSelection>();
  const [expandedDirectories, setExpandedDirectories] = useState(
    () => new Set([""]),
  );
  const [deleteCandidate, setDeleteCandidate] = useState<AssetItem>();
  const [importOpen, setImportOpen] = useState(false);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importCategory, setImportCategory] =
    useState<GalgameAssetCategory>("other");
  const [repairReplacement, setRepairReplacement] = useState("");
  const [repairPending, setRepairPending] = useState(false);
  const [editDraft, setEditDraft] = useState({
    display_name: "",
    virtualPath: "",
    category: "other" as GalgameAssetCategory,
    packagingPolicy: "auto" as "auto" | "include" | "exclude",
  });

  const maximumSummaryHeight = useCallback(() => {
    const workbenchHeight =
      workbenchRef.current?.getBoundingClientRect().height ?? 720;
    return Math.max(
      MIN_SUMMARY_HEIGHT,
      Math.floor(
        workbenchHeight -
          ASSET_TOOLBAR_HEIGHT -
          SUMMARY_RESIZER_HEIGHT -
          MIN_BROWSER_HEIGHT,
      ),
    );
  }, []);

  const clampSummaryHeight = useCallback(
    (value: number) =>
      Math.round(
        Math.min(Math.max(value, MIN_SUMMARY_HEIGHT), maximumSummaryHeight()),
      ),
    [maximumSummaryHeight],
  );

  useEffect(() => {
    try {
      if (summaryHeight === null) localStorage.removeItem(SUMMARY_HEIGHT_KEY);
      else localStorage.setItem(SUMMARY_HEIGHT_KEY, String(summaryHeight));
    } catch {
      // Layout preferences are best-effort when storage is unavailable.
    }
  }, [summaryHeight]);

  useEffect(() => {
    const clampRememberedHeight = () =>
      setSummaryHeight((current) =>
        current === null ? null : clampSummaryHeight(current),
      );
    window.addEventListener("resize", clampRememberedHeight);
    return () => window.removeEventListener("resize", clampRememberedHeight);
  }, [clampSummaryHeight]);

  useEffect(
    () => () => {
      summaryResizeCleanupRef.current?.();
    },
    [],
  );

  const startSummaryResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || window.innerWidth <= 900) return;
    event.preventDefault();
    summaryResizeCleanupRef.current?.();
    const startY = event.clientY;
    const startHeight =
      summaryRef.current?.getBoundingClientRect().height ??
      summaryHeight ??
      MIN_SUMMARY_HEIGHT;
    globalThis.document.body.classList.add("galgame-assets-summary-resizing");

    const move = (pointer: PointerEvent) =>
      setSummaryHeight(
        clampSummaryHeight(startHeight + pointer.clientY - startY),
      );
    const finish = () => {
      globalThis.document.body.classList.remove(
        "galgame-assets-summary-resizing",
      );
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      summaryResizeCleanupRef.current = undefined;
    };
    summaryResizeCleanupRef.current = finish;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const resizeSummaryWithKeyboard = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const currentHeight =
      summaryHeight ??
      summaryRef.current?.getBoundingClientRect().height ??
      MIN_SUMMARY_HEIGHT;
    setSummaryHeight(
      clampSummaryHeight(
        currentHeight + (event.key === "ArrowDown" ? 16 : -16),
      ),
    );
  };

  const overview = useQuery({
    queryKey: galgameQueryKeys.assetOverview(projectId),
    queryFn: () => getGalgameAssetOverview(projectId),
    staleTime: 30_000,
  });
  const files = useQuery({
    queryKey: galgameQueryKeys.projectAssets(projectId),
    queryFn: () => getGalgameProjectAssets(projectId),
    enabled: selection?.kind === "missing",
    staleTime: 30_000,
  });
  const manifest = useQuery({
    queryKey: galgameQueryKeys.packageManifest(projectId),
    queryFn: () => getGalgamePackageManifest(projectId),
    enabled: overview.isSuccess,
    staleTime: 30_000,
  });
  const items = useMemo(
    () => overview.data?.items ?? [],
    [overview.data?.items],
  );

  const invalidateAssets = async () => {
    await invalidateGalgameAssetQueries(client, projectId);
  };

  const tree = useMemo(() => directoryTree(items), [items]);
  const kindCounts = useMemo(
    () =>
      items.reduce<Record<AssetDisplayKind, number>>(
        (result, item) => {
          result[displayKind(item)] += 1;
          return result;
        },
        {
          image: 0,
          audio: 0,
          video: 0,
          font: 0,
          document: 0,
          particle: 0,
          ui: 0,
          transition: 0,
          other: 0,
        },
      ),
    [items],
  );
  const statusCounts = useMemo(
    () => ({
      all: items.length,
      referenced: items.filter((item) => item.reference_count > 0).length,
      orphaned: items.filter((item) => item.orphaned).length,
      include: items.filter((item) => item.packagingPolicy === "include")
        .length,
      exclude: items.filter((item) => item.packagingPolicy === "exclude")
        .length,
    }),
    [items],
  );
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (kind !== "all" && displayKind(item) !== kind) return false;
      if (!matchesStatus(item, status)) return false;
      const path = cleanPath(item.virtualPath);
      if (directory && path !== directory && !path.startsWith(`${directory}/`))
        return false;
      if (
        needle &&
        ![
          item.display_name,
          item.virtualPath,
          item.checksumSha256,
          item.transcript,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase().includes(needle))
      )
        return false;
      return true;
    });
  }, [directory, items, kind, search, status]);
  const selected =
    selection?.kind === "asset"
      ? items.find((item) => item.id === selection.id)
      : undefined;
  const selectedMissing =
    selection?.kind === "missing"
      ? overview.data?.missing_items.find(
          (item) => item.story_asset_id === selection.id,
        )
      : undefined;

  useEffect(() => {
    if (
      selection?.kind === "asset" &&
      !filtered.some((item) => item.id === selection.id)
    )
      setSelection(undefined);
    if (
      selection?.kind === "missing" &&
      !overview.data?.missing_items.some(
        (item) => item.story_asset_id === selection.id,
      )
    )
      setSelection(undefined);
  }, [filtered, overview.data?.missing_items, selection]);

  useEffect(() => {
    if (!selected) return;
    setEditDraft({
      display_name: selected.display_name,
      virtualPath: selected.virtualPath ?? "",
      category: selected.category ?? "other",
      packagingPolicy: selected.packagingPolicy ?? "auto",
    });
  }, [selected]);

  useEffect(() => setRepairReplacement(""), [selectedMissing]);

  const typeStats = useMemo(
    () =>
      (Object.keys(KIND_META) as AssetDisplayKind[])
        .map((itemKind) => {
          const matching = items.filter(
            (item) => displayKind(item) === itemKind,
          );
          return {
            kind: itemKind,
            count: matching.length,
            bytes: matching.reduce((sum, item) => sum + item.byte_size, 0),
          };
        })
        .filter((entry) => entry.count > 0),
    [items],
  );
  const largest = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]));
    const ordered = (overview.data?.largestAssetIds ?? [])
      .map((id) => byId.get(id))
      .filter((item): item is AssetItem => Boolean(item));
    return ordered.length
      ? ordered.slice(0, 5)
      : [...items].sort((a, b) => b.byte_size - a.byte_size).slice(0, 5);
  }, [items, overview.data?.largestAssetIds]);
  const topBytes = largest.reduce((sum, item) => sum + item.byte_size, 0);
  const totalBytes = overview.data?.totalBytes ?? 0;
  const packageBytes = overview.data?.estimatedPackageBytes ?? 0;
  const savedBytes = Math.max(0, totalBytes - packageBytes);
  const packageIds = new Set(
    (manifest.data?.items ?? []).map((item) => item.assetId),
  );
  const skippedCount = items.filter((item) => !packageIds.has(item.id)).length;
  const reduction = totalBytes
    ? Math.round((savedBytes / totalBytes) * 100)
    : 0;

  const refresh = useMutation({
    mutationFn: () => scanGalgameAssetMetadata(projectId),
    onSuccess: async () => {
      await invalidateAssets();
      onNotice("资源元数据、引用与打包状态已刷新。");
    },
    onError: (error) => onNotice(assetError(error)),
  });
  const patch = useMutation({
    mutationFn: ({ asset }: { asset: AssetItem }) =>
      patchGalgameProjectAsset(
        projectId,
        asset as GalgameProjectAsset,
        editDraft,
      ),
    onSuccess: async () => {
      await invalidateAssets();
      onNotice("资源信息已保存。");
    },
    onError: async (error) => {
      await invalidateAssets();
      onNotice(assetError(error));
    },
  });
  const remove = useMutation({
    mutationFn: (asset: AssetItem) =>
      deleteGalgameProjectAsset(projectId, asset as GalgameProjectAsset),
    onSuccess: async () => {
      setSelection(undefined);
      setDeleteCandidate(undefined);
      await invalidateAssets();
      onNotice("游离资源已删除。");
    },
    onError: async (error) => {
      setDeleteCandidate(undefined);
      await invalidateAssets();
      onNotice(assetError(error));
    },
  });
  const importPreview = useMutation({
    mutationFn: () =>
      previewGalgameAssetImport(
        projectId,
        importFiles.map((file) => file.name),
        importCategory,
      ),
    onError: (error) => onNotice(assetError(error)),
  });
  const importUpload = useMutation({
    mutationFn: () =>
      batchUploadGalgameProjectAssets(projectId, importFiles, importCategory),
    onSuccess: async (result) => {
      await invalidateAssets();
      const first = result.items[0];
      if (first) setSelection({ kind: "asset", id: first.id });
      setImportOpen(false);
      setImportFiles([]);
      importPreview.reset();
      onNotice(`已导入 ${result.items.length} 个资源。`);
    },
    onError: (error) => onNotice(assetError(error)),
  });

  const storyAsset = selectedMissing
    ? document.assets?.find(
        (item) => item.id === selectedMissing.story_asset_id,
      )
    : undefined;
  const replacementFiles = (files.data?.items ?? []).filter(
    (file) => !storyAsset || file.media_kind === storyAsset.type,
  );

  return {
    projectId,
    document,
    onLocate,
    onNotice,
    onRepairMissingAsset,
    fileInput,
    workbenchRef,
    summaryRef,
    search,
    setSearch,
    status,
    setStatus,
    kind,
    setKind,
    directory,
    setDirectory,
    view,
    setView,
    summaryOpen,
    setSummaryOpen,
    summaryHeight,
    setSummaryHeight,
    filtersOpen,
    setFiltersOpen,
    selection,
    setSelection,
    expandedDirectories,
    setExpandedDirectories,
    deleteCandidate,
    setDeleteCandidate,
    importOpen,
    setImportOpen,
    importFiles,
    setImportFiles,
    importCategory,
    setImportCategory,
    repairReplacement,
    setRepairReplacement,
    repairPending,
    setRepairPending,
    editDraft,
    setEditDraft,
    maximumSummaryHeight,
    clampSummaryHeight,
    startSummaryResize,
    resizeSummaryWithKeyboard,
    overview,
    files,
    manifest,
    items,
    invalidateAssets,
    tree,
    kindCounts,
    statusCounts,
    filtered,
    selected,
    selectedMissing,
    typeStats,
    largest,
    topBytes,
    totalBytes,
    packageBytes,
    savedBytes,
    packageIds,
    skippedCount,
    reduction,
    refresh,
    patch,
    remove,
    importPreview,
    importUpload,
    storyAsset,
    replacementFiles,
  };
}
