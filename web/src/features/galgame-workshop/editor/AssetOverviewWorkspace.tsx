import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileText,
  Film,
  Folder,
  FolderOpen,
  Grid2X2,
  Layers3,
  List,
  LocateFixed,
  PanelLeftOpen,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { fetchApiBlob } from "@platform/api/client";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { CustomSelect } from "@shared/ui/CustomSelect";
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
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import { StoryAudioPreview } from "@features/galgame-workshop/editor/StoryAudioPreview";

import {
  ASSET_TOOLBAR_HEIGHT,
  CATEGORY_OPTIONS,
  KIND_META,
  MIN_BROWSER_HEIGHT,
  MIN_SUMMARY_HEIGHT,
  MODULES,
  STATUS_OPTIONS,
  SUMMARY_HEIGHT_KEY,
  SUMMARY_RESIZER_HEIGHT,
  assetError,
  bytes,
  cleanPath,
  directoryTree,
  displayKind,
  duration,
  loadSummaryHeight,
  matchesStatus,
  type AssetDisplayKind,
  type AssetItem,
  type AssetSelection,
  type AssetStatus,
  type DirectoryNode,
} from "@features/galgame-workshop/editor/assetOverviewModel";

function VideoPreview({ fileId, label }: { fileId: string; label: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    void fetchApiBlob(`/v1/files/${fileId}/content`)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
      })
      .catch(() => active && setUrl(""));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId]);
  return url ? (
    <video src={url} aria-label={label} controls preload="metadata" />
  ) : (
    <Film aria-hidden />
  );
}

function AssetPreview({
  item,
  compact = false,
}: {
  item: AssetItem;
  compact?: boolean;
}) {
  const kind = displayKind(item);
  const Icon = KIND_META[kind].icon;
  if (item.media_kind === "image")
    return (
      <StoryAssetImage
        fileId={item.id}
        alt={item.display_name}
        fallback={<Icon aria-hidden />}
      />
    );
  if (item.media_kind === "audio")
    return (
      <StoryAudioPreview
        fileId={item.id}
        label={item.display_name}
        compact={compact}
      />
    );
  if (item.media_kind === "video" && !compact)
    return <VideoPreview fileId={item.id} label={item.display_name} />;
  return <Icon aria-hidden />;
}

function DirectoryBranch({
  node,
  selected,
  expanded,
  depth,
  onSelect,
  onToggle,
}: {
  node: DirectoryNode;
  selected: string;
  expanded: Set<string>;
  depth: number;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}) {
  const open = expanded.has(node.path);
  const hasChildren = node.children.length > 0;
  return (
    <li>
      <div
        className={`galgame-assets-tree-row ${selected === node.path ? "active" : ""}`}
        style={{ "--tree-depth": depth } as CSSProperties}
      >
        <button
          type="button"
          className="galgame-assets-tree-toggle"
          aria-label={`${open ? "折叠" : "展开"}${node.name}`}
          disabled={!hasChildren}
          onClick={() => onToggle(node.path)}
        >
          {hasChildren ? (
            open ? (
              <ChevronDown aria-hidden />
            ) : (
              <ChevronRight aria-hidden />
            )
          ) : (
            <span />
          )}
        </button>
        <button type="button" onClick={() => onSelect(node.path)}>
          {open ? <FolderOpen aria-hidden /> : <Folder aria-hidden />}
          <span>{node.name}</span>
          <em>{node.count}</em>
        </button>
      </div>
      {open && hasChildren ? (
        <ul>
          {node.children.map((child) => (
            <DirectoryBranch
              key={child.path}
              node={child}
              selected={selected}
              expanded={expanded}
              depth={depth + 1}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function AssetOverviewWorkspace({
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
    queryKey: ["galgame-asset-overview", projectId],
    queryFn: () => getGalgameAssetOverview(projectId),
    refetchOnMount: "always",
  });
  const files = useQuery({
    queryKey: ["galgame-project-assets", projectId],
    queryFn: () => getGalgameProjectAssets(projectId),
    refetchOnMount: "always",
  });
  const manifest = useQuery({
    queryKey: ["galgame-package-manifest", projectId],
    queryFn: () => getGalgamePackageManifest(projectId),
    refetchOnMount: "always",
  });
  const items = useMemo(
    () => overview.data?.items ?? [],
    [overview.data?.items],
  );

  const invalidateAssets = async () => {
    await Promise.all([
      client.invalidateQueries({
        queryKey: ["galgame-asset-overview", projectId],
      }),
      client.invalidateQueries({
        queryKey: ["galgame-project-assets", projectId],
      }),
      client.invalidateQueries({
        queryKey: ["galgame-package-manifest", projectId],
      }),
    ]);
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

  if (overview.isLoading)
    return (
      <div className="galgame-assets-empty">正在扫描素材、引用与打包状态…</div>
    );
  if (overview.isError)
    return (
      <div className="galgame-assets-empty">
        <AlertTriangle aria-hidden />
        <strong>资源总览暂时无法读取</strong>
        <button type="button" onClick={() => void overview.refetch()}>
          重新加载
        </button>
      </div>
    );

  return (
    <div
      className={`galgame-assets-dashboard ${filtersOpen ? "filters-open" : ""}`}
    >
      <aside className="galgame-assets-filter-panel" aria-label="资源筛选">
        <header>
          <strong>资源</strong>
          <div>
            <button
              type="button"
              aria-label="导入资源"
              onClick={() => setImportOpen(true)}
            >
              <Plus aria-hidden />
            </button>
            <button
              type="button"
              aria-label="刷新资源"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              <RefreshCcw
                className={refresh.isPending ? "spinning" : ""}
                aria-hidden
              />
            </button>
            <button
              type="button"
              className="galgame-assets-filter-close"
              aria-label="关闭资源筛选"
              onClick={() => setFiltersOpen(false)}
            >
              <X aria-hidden />
            </button>
          </div>
        </header>
        <label className="galgame-assets-search">
          <Search aria-hidden />
          <input
            type="search"
            aria-label="搜索资源"
            placeholder="搜索资源"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search ? (
            <button
              type="button"
              aria-label="清除资源搜索"
              onClick={() => setSearch("")}
            >
              <X aria-hidden />
            </button>
          ) : null}
        </label>
        <nav aria-label="资源状态">
          {STATUS_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                className={status === option.value ? "active" : ""}
                onClick={() => setStatus(option.value)}
              >
                <Icon aria-hidden />
                <span>{option.label}</span>
                <em>{statusCounts[option.value]}</em>
              </button>
            );
          })}
        </nav>
        <section>
          <small>按类型</small>
          <button
            type="button"
            className={kind === "all" ? "active" : ""}
            onClick={() => setKind("all")}
          >
            <Grid2X2 aria-hidden /> <span>不限类型</span>{" "}
            <em>{items.length}</em>
          </button>
          {(Object.keys(KIND_META) as AssetDisplayKind[]).map((itemKind) => {
            const meta = KIND_META[itemKind];
            const Icon = meta.icon;
            return (
              <button
                key={itemKind}
                type="button"
                className={`${kind === itemKind ? "active" : ""} ${meta.className}`}
                onClick={() => setKind(itemKind)}
              >
                <Icon aria-hidden /> <span>{meta.label}</span>
                <em>{kindCounts[itemKind]}</em>
              </button>
            );
          })}
        </section>
        <section className="galgame-assets-directory-tree">
          <small>目录</small>
          <ul>
            <DirectoryBranch
              node={tree}
              selected={directory}
              expanded={expandedDirectories}
              depth={0}
              onSelect={setDirectory}
              onToggle={(path) =>
                setExpandedDirectories((current) => {
                  const next = new Set(current);
                  if (next.has(path)) next.delete(path);
                  else next.add(path);
                  return next;
                })
              }
            />
          </ul>
        </section>
      </aside>

      <main
        ref={workbenchRef}
        className={`galgame-assets-workbench ${summaryOpen ? "summary-open" : ""} ${summaryHeight !== null ? "summary-sized" : ""}`}
        style={
          summaryHeight === null
            ? undefined
            : ({
                "--asset-summary-height": `${summaryHeight}px`,
              } as CSSProperties)
        }
      >
        <header className="galgame-assets-toolbar">
          <div>
            <button
              type="button"
              className="galgame-assets-filter-open"
              aria-label="打开资源筛选"
              onClick={() => setFiltersOpen(true)}
            >
              <PanelLeftOpen aria-hidden />
            </button>
            <strong>资源</strong>
            <span>
              共 {items.length} 项 · {statusCounts.orphaned} 项游离 · 预计打包{" "}
              {bytes(packageBytes)}
            </span>
          </div>
          <div className="galgame-assets-toolbar-actions">
            <div
              className="galgame-assets-view-switch"
              role="group"
              aria-label="资源视图"
            >
              <button
                type="button"
                className={view === "grid" ? "active" : ""}
                aria-label="网格视图"
                onClick={() => setView("grid")}
              >
                <Grid2X2 aria-hidden />
              </button>
              <button
                type="button"
                className={view === "list" ? "active" : ""}
                aria-label="列表视图"
                onClick={() => setView("list")}
              >
                <List aria-hidden />
              </button>
            </div>
            <button
              type="button"
              aria-label="刷新元数据"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              <RefreshCcw
                className={refresh.isPending ? "spinning" : ""}
                aria-hidden
              />
            </button>
            <button
              type="button"
              aria-label="批量导入资源"
              onClick={() => setImportOpen(true)}
            >
              <Upload aria-hidden />
            </button>
            <button
              type="button"
              aria-label={summaryOpen ? "收起资源统计" : "展开资源统计"}
              onClick={() => setSummaryOpen((current) => !current)}
            >
              {summaryOpen ? (
                <ChevronUp aria-hidden />
              ) : (
                <ChevronDown aria-hidden />
              )}
            </button>
          </div>
        </header>

        {summaryOpen ? (
          <section
            ref={summaryRef}
            className="galgame-assets-summary"
            aria-label="资源统计"
          >
            <article className="galgame-assets-overview-card">
              <small>总览</small>
              <div className="galgame-assets-overview-values">
                <span>
                  <small>总素材</small>
                  <strong>{items.length}</strong>
                  <em>{bytes(totalBytes)}</em>
                </span>
                <span>
                  <small>引用 / 游离</small>
                  <strong>
                    {statusCounts.referenced} / {statusCounts.orphaned}
                  </strong>
                </span>
              </div>
              <div className="galgame-assets-package-card">
                <small>打包预测</small>
                <div>
                  <del>{bytes(totalBytes)}</del>
                  <span>→</span>
                  <strong>{bytes(packageBytes)}</strong>
                  <em>减少 {reduction}%</em>
                </div>
                <progress max={Math.max(totalBytes, 1)} value={packageBytes} />
                <footer>
                  <span>
                    <i /> 打包 {bytes(packageBytes)}
                  </span>
                  <span>
                    跳过 {bytes(savedBytes)} · {skippedCount} 项
                  </span>
                </footer>
              </div>
              {(manifest.data?.issues?.length ?? 0) > 0 ? (
                <div className="galgame-assets-issues">
                  <strong>
                    <AlertTriangle aria-hidden />{" "}
                    {manifest.data?.issues?.length} 个打包阻断项
                  </strong>
                  {manifest.data?.issues?.slice(0, 3).map((issue, index) => (
                    <button
                      key={`${issue.code}-${index}`}
                      type="button"
                      onClick={() => {
                        if (issue.assetId)
                          setSelection({ kind: "asset", id: issue.assetId });
                        else if (issue.storyAssetId)
                          setSelection({
                            kind: "missing",
                            id: issue.storyAssetId,
                          });
                      }}
                    >
                      {issue.message}
                    </button>
                  ))}
                </div>
              ) : null}
            </article>
            <article className="galgame-assets-type-card">
              <small>类型分布</small>
              {typeStats.map((entry) => {
                const meta = KIND_META[entry.kind];
                const Icon = meta.icon;
                const percent = totalBytes
                  ? Math.round((entry.bytes / totalBytes) * 100)
                  : 0;
                return (
                  <button
                    key={entry.kind}
                    type="button"
                    onClick={() => setKind(entry.kind)}
                  >
                    <Icon className={meta.className} aria-hidden />
                    <span>
                      <strong>
                        {meta.label} {entry.count}
                      </strong>
                      <progress max="100" value={percent} />
                    </span>
                    <em>{percent}%</em>
                    <small>{bytes(entry.bytes)}</small>
                  </button>
                );
              })}
            </article>
            <article className="galgame-assets-largest-card">
              <small>TOP 大户</small>
              <details>
                <summary>
                  <Layers3 aria-hidden />
                  <strong>
                    Top {largest.length} 占{" "}
                    {totalBytes
                      ? ((topBytes / totalBytes) * 100).toFixed(1)
                      : "0.0"}
                    %
                  </strong>
                  <ChevronDown aria-hidden />
                </summary>
                <div>
                  {largest.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        setSelection({ kind: "asset", id: item.id })
                      }
                    >
                      <span>{item.display_name}</span>
                      <em>{bytes(item.byte_size)}</em>
                    </button>
                  ))}
                </div>
              </details>
            </article>
            <article className="galgame-assets-module-card">
              <small>类型健康度</small>
              <div>
                {MODULES.map((module) => {
                  const matching = items.filter((item) =>
                    module.categories.includes(item.category ?? "other"),
                  );
                  const moduleBytes = matching.reduce(
                    (sum, item) => sum + item.byte_size,
                    0,
                  );
                  const orphans = matching.filter(
                    (item) => item.orphaned,
                  ).length;
                  const missing = module.categories.some(
                    (category) =>
                      overview.data?.moduleHealth?.[category] === "error",
                  );
                  const Icon = module.icon;
                  return (
                    <button
                      key={module.label}
                      type="button"
                      className={missing || orphans ? "warning" : ""}
                      onClick={() => {
                        const target = module.categories[0];
                        if (target === "font") setKind("font");
                        else if (
                          ["bgm", "ambient", "sfx", "voice"].includes(target)
                        )
                          setKind("audio");
                        else if (target === "video") setKind("video");
                        else setKind("image");
                      }}
                    >
                      <Icon aria-hidden />
                      <strong>{module.label}</strong>
                      <em>{matching.length}</em>
                      <small>{bytes(moduleBytes)}</small>
                      <progress
                        max={Math.max(totalBytes, 1)}
                        value={moduleBytes}
                      />
                    </button>
                  );
                })}
              </div>
            </article>
          </section>
        ) : null}

        {summaryOpen ? (
          <div
            className="galgame-assets-summary-resizer"
            role="separator"
            tabIndex={0}
            aria-label="调整资源统计与资源列表高度"
            aria-orientation="horizontal"
            aria-valuemin={MIN_SUMMARY_HEIGHT}
            aria-valuemax={maximumSummaryHeight()}
            aria-valuenow={summaryHeight ?? undefined}
            aria-valuetext={
              summaryHeight === null ? "自动高度" : `${summaryHeight} 像素`
            }
            title="拖动调整统计区高度，双击恢复自动高度"
            onPointerDown={startSummaryResize}
            onKeyDown={resizeSummaryWithKeyboard}
            onDoubleClick={() => setSummaryHeight(null)}
          />
        ) : null}

        <section className="galgame-assets-browser">
          <header>
            <div>
              <FolderOpen aria-hidden />
              <strong>assets{directory ? ` / ${directory}` : ""}</strong>
              <span>· {filtered.length} 项</span>
            </div>
            {search || status !== "all" || kind !== "all" || directory ? (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setStatus("all");
                  setKind("all");
                  setDirectory("");
                }}
              >
                清除筛选
              </button>
            ) : null}
          </header>
          {filtered.length ? (
            <div className={`galgame-assets-results is-${view}`}>
              {filtered.map((item) => {
                const itemKind = displayKind(item);
                const meta = KIND_META[itemKind];
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`${item.orphaned ? "orphaned" : ""} ${selection?.kind === "asset" && selection.id === item.id ? "selected" : ""}`}
                    aria-label={`${item.display_name}，${item.reference_count ? `${item.reference_count} 处引用` : "游离"}`}
                    onClick={() => setSelection({ kind: "asset", id: item.id })}
                  >
                    <span className="galgame-assets-result-preview">
                      <AssetPreview item={item} compact />
                      <small className={meta.className}>
                        {meta.label.toUpperCase()}
                      </small>
                      {item.reference_count ? (
                        <em>引用 {item.reference_count}</em>
                      ) : null}
                    </span>
                    <span className="galgame-assets-result-copy">
                      <strong>{item.display_name}</strong>
                      <small>{item.virtualPath}</small>
                    </span>
                    <span className="galgame-assets-result-type">
                      {meta.label}
                    </span>
                    <span className="galgame-assets-result-size">
                      {bytes(item.byte_size)}
                    </span>
                    <span
                      className={`galgame-assets-result-status ${item.orphaned ? "orphaned" : ""}`}
                    >
                      {item.packagingPolicy === "include"
                        ? "强制打包"
                        : item.packagingPolicy === "exclude"
                          ? "强制排除"
                          : item.reference_count
                            ? `引用 ${item.reference_count}`
                            : "游离"}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="galgame-assets-results-empty">
              <Search aria-hidden />
              <strong>没有匹配的资源</strong>
              <span>调整搜索词、类型、状态或目录后再试。</span>
            </div>
          )}
        </section>
      </main>

      <aside
        className={`galgame-assets-inspector ${selection ? "has-selection" : ""}`}
        aria-label="资源详情"
      >
        <button
          type="button"
          className="galgame-assets-inspector-close"
          aria-label="关闭资源详情"
          onClick={() => setSelection(undefined)}
        >
          <X aria-hidden />
        </button>
        {selected ? (
          <>
            <header>
              <small>资源详情</small>
              <strong>{selected.display_name}</strong>
              <span>{selected.virtualPath}</span>
            </header>
            <div className="galgame-assets-inspector-preview">
              <AssetPreview item={selected} />
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                patch.mutate({ asset: selected });
              }}
            >
              <label>
                <span>文件名</span>
                <input
                  value={editDraft.display_name}
                  onChange={(event) =>
                    setEditDraft((current) => ({
                      ...current,
                      display_name: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>虚拟路径</span>
                <input
                  value={editDraft.virtualPath}
                  onChange={(event) =>
                    setEditDraft((current) => ({
                      ...current,
                      virtualPath: event.target.value,
                    }))
                  }
                />
              </label>
              <div className="galgame-assets-inspector-fields">
                <label>
                  <span>业务分类</span>
                  <CustomSelect
                    value={editDraft.category}
                    ariaLabel="业务分类"
                    options={CATEGORY_OPTIONS}
                    onChange={(value) =>
                      setEditDraft((current) => ({
                        ...current,
                        category: value as GalgameAssetCategory,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>打包策略</span>
                  <CustomSelect
                    value={editDraft.packagingPolicy}
                    ariaLabel="打包策略"
                    options={[
                      { value: "auto", label: "自动" },
                      { value: "include", label: "强制打包" },
                      { value: "exclude", label: "强制排除" },
                    ]}
                    onChange={(value) =>
                      setEditDraft((current) => ({
                        ...current,
                        packagingPolicy: value as
                          "auto" | "include" | "exclude",
                      }))
                    }
                  />
                </label>
              </div>
              <button
                type="submit"
                disabled={
                  patch.isPending ||
                  !editDraft.display_name.trim() ||
                  !editDraft.virtualPath.trim()
                }
              >
                {patch.isPending ? "保存中…" : "保存资源信息"}
              </button>
            </form>
            <dl>
              <div>
                <dt>类型</dt>
                <dd>{selected.mime_type}</dd>
              </div>
              <div>
                <dt>大小</dt>
                <dd>{bytes(selected.byte_size)}</dd>
              </div>
              <div>
                <dt>元数据</dt>
                <dd>
                  {selected.width && selected.height
                    ? `${selected.width} × ${selected.height}`
                    : selected.durationMs
                      ? duration(selected.durationMs)
                      : "—"}
                </dd>
              </div>
              <div>
                <dt>SHA-256</dt>
                <dd title={selected.checksumSha256 ?? ""}>
                  {selected.checksumSha256 ?? "等待扫描"}
                </dd>
              </div>
            </dl>
            <section className="galgame-assets-references">
              <header>
                <strong>引用位置</strong>
                <span>{selected.reference_count}</span>
              </header>
              {(selected.references ?? []).length ? (
                (selected.references ?? []).map((reference, index) => (
                  <button
                    key={`${reference.kind}-${index}`}
                    type="button"
                    disabled={!reference.fragmentId || !reference.blockId}
                    onClick={() =>
                      reference.fragmentId &&
                      reference.blockId &&
                      onLocate(
                        reference.chapterId ?? undefined,
                        reference.fragmentId,
                        reference.blockId,
                      )
                    }
                  >
                    <LocateFixed aria-hidden /> {reference.label}
                  </button>
                ))
              ) : (
                <span>当前没有 Story 引用。</span>
              )}
            </section>
            {selected.orphaned ? (
              <button
                type="button"
                className="danger"
                onClick={() => setDeleteCandidate(selected)}
              >
                <Trash2 aria-hidden /> 删除游离文件
              </button>
            ) : null}
          </>
        ) : selectedMissing ? (
          <div className="galgame-assets-missing-inspector">
            <FileText aria-hidden />
            <small>缺失素材</small>
            <strong>{selectedMissing.story_role}</strong>
            <p>
              原文件记录 {selectedMissing.file_id}{" "}
              已不存在，请选择同媒体类型的现有资源重新绑定。
            </p>
            <label>
              <span>替换文件</span>
              <CustomSelect
                value={repairReplacement}
                ariaLabel="替换文件"
                options={[
                  { value: "", label: "选择现有文件…" },
                  ...replacementFiles.map((file) => ({
                    value: file.id,
                    label: file.virtualPath ?? file.display_name,
                  })),
                ]}
                onChange={setRepairReplacement}
              />
            </label>
            <button
              type="button"
              disabled={!repairReplacement || repairPending}
              onClick={async () => {
                if (!repairReplacement) return;
                setRepairPending(true);
                try {
                  const saved = await onRepairMissingAsset(
                    selectedMissing.story_asset_id,
                    repairReplacement,
                  );
                  if (saved) {
                    await invalidateAssets();
                    setSelection(undefined);
                  }
                } finally {
                  setRepairPending(false);
                }
              }}
            >
              {repairPending ? "正在重新绑定…" : "重新绑定并保存 Story"}
            </button>
            <section className="galgame-assets-references">
              <strong>受影响位置</strong>
              {(selectedMissing.references ?? []).map((reference, index) => (
                <button
                  key={`${reference.kind}-${index}`}
                  type="button"
                  disabled={!reference.fragmentId || !reference.blockId}
                  onClick={() =>
                    reference.fragmentId &&
                    reference.blockId &&
                    onLocate(
                      reference.chapterId ?? undefined,
                      reference.fragmentId,
                      reference.blockId,
                    )
                  }
                >
                  <LocateFixed aria-hidden /> {reference.label}
                </button>
              ))}
            </section>
          </div>
        ) : (
          <div className="galgame-assets-inspector-empty">
            <FileText aria-hidden />
            <strong>选中一个文件查看详情</strong>
            <span>查看素材引用、元数据和打包策略。</span>
          </div>
        )}
      </aside>

      {filtersOpen ? (
        <button
          type="button"
          className="galgame-assets-filter-backdrop"
          aria-label="关闭资源筛选"
          onClick={() => setFiltersOpen(false)}
        />
      ) : null}

      {importOpen ? (
        <div className="galgame-assets-import-backdrop" role="presentation">
          <section
            className="galgame-assets-import-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="asset-import-title"
          >
            <header>
              <div>
                <small>BATCH IMPORT</small>
                <h2 id="asset-import-title">批量导入资源</h2>
              </div>
              <button
                type="button"
                aria-label="关闭批量导入"
                onClick={() => setImportOpen(false)}
              >
                <X aria-hidden />
              </button>
            </header>
            <label className="galgame-assets-import-drop">
              <Upload aria-hidden />
              <strong>
                {importFiles.length
                  ? `已选择 ${importFiles.length} 个文件`
                  : "选择要导入的资源"}
              </strong>
              <span>支持一次选择多个图片、音频、视频、字体或文档文件。</span>
              <input
                ref={fileInput}
                type="file"
                multiple
                onChange={(event) => {
                  setImportFiles(Array.from(event.target.files ?? []));
                  importPreview.reset();
                }}
              />
            </label>
            <label>
              <span>业务分类</span>
              <CustomSelect
                value={importCategory}
                ariaLabel="业务分类"
                options={CATEGORY_OPTIONS}
                onChange={(value) => {
                  setImportCategory(value as GalgameAssetCategory);
                  importPreview.reset();
                }}
              />
            </label>
            {importPreview.data ? (
              <div className="galgame-assets-import-preview">
                <header>
                  <strong>导入预览</strong>
                  <span>{importPreview.data.items.length} 项</span>
                </header>
                {importPreview.data.items.map((item) => (
                  <div key={`${item.originalName}-${item.virtualPath}`}>
                    <span>
                      <strong>{item.finalName}</strong>
                      <small>{item.virtualPath}</small>
                    </span>
                    <em>{item.reasons?.join("、") || "路径可用"}</em>
                  </div>
                ))}
              </div>
            ) : null}
            <footer>
              <button type="button" onClick={() => setImportOpen(false)}>
                取消
              </button>
              <button
                type="button"
                disabled={!importFiles.length || importPreview.isPending}
                onClick={() => importPreview.mutate()}
              >
                {importPreview.isPending ? "预览中…" : "预览目标路径"}
              </button>
              <button
                type="button"
                className="primary"
                disabled={!importPreview.data || importUpload.isPending}
                onClick={() => importUpload.mutate()}
              >
                {importUpload.isPending ? "导入中…" : "确认导入"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteCandidate)}
        title="删除游离资源？"
        description="删除后文件无法从工程恢复。若扩展或自定义路径直接读取它，也会同时失效。"
        confirmLabel="删除资源"
        pending={remove.isPending}
        onCancel={() => setDeleteCandidate(undefined)}
        onConfirm={() => deleteCandidate && remove.mutate(deleteCandidate)}
      />
    </div>
  );
}
