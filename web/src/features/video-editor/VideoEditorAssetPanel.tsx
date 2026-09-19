import { CustomSelect } from "@shared/ui/CustomSelect";
import { textPresets, type TextPreset } from "./textModel";
import { canEditAsset } from "./assetReadiness";
import {
  type DragEvent,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage } from "@platform/api/errors";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckSquare2,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Pencil,
  Trash2,
  Type,
  X,
} from "lucide-react";
import {
  createVideoEditorAssetBake,
  deleteVideoEditorAsset,
  getVideoEditorAssetBake,
  getVideoEditorTimeline,
  listVideoEditorAssets,
  applyVideoEditorOperations,
  importVideoEditorAssets,
  listVideoEditorImportSources,
  patchVideoEditorAsset,
  uploadVideoEditorAsset,
} from "./api";
import {
  completeAssetOrganization,
  deleteFolderFromOrganization,
  moveAssetInOrganization,
  moveAssetsInOrganization,
  moveFolderBefore,
  shiftFolderInOrganization,
} from "./assetOrganization";
import { videoEditorQueryKeys } from "./queryKeys";
import { VideoEditorAssetAddMenu } from "./VideoEditorAssetAddMenu";
import {
  VideoEditorAssetBatchSelectionHeader,
  VideoEditorAssetBatchToolbar,
} from "./VideoEditorAssetBatchToolbar";
import { VideoEditorAssetDefaultChromaDialog } from "./VideoEditorAssetDefaultChromaDialog";
import { VideoEditorAssetImportDialog } from "./VideoEditorAssetImportDialog";
import { VideoEditorAssetRow } from "./VideoEditorAssetRow";
import type { ChromaKey } from "./chromaPresets";
import {
  VideoEditorAssetUploadFeedback,
  type PendingFolderPlacement,
} from "./VideoEditorAssetUploadFeedback";
import type {
  VideoEditorAsset,
  VideoEditorAssetFolder,
  VideoEditorAssetOrganization,
} from "./types";
import "./video-editor-assets.css";

const ORGANIZE_ASSET_TYPE = "application/x-video-editor-organize-asset";
const TIMELINE_ASSET_TYPE = "application/x-video-editor-asset";
const FOLDER_TYPE = "application/x-video-editor-folder";
export const ROOT_BATCH_ID = "root";

export function VideoEditorAssetPanel({
  projectId,
  assets,
  organization,
  disabled = false,
  previewingAssetId,
  onPreview,
  onAdd,
  onAddBatch,
  onAddGenerated,
  onOrganizationChange,
  onTimelineAssetDrag,
}: {
  onTimelineAssetDrag?: (asset?: VideoEditorAsset) => void;
  projectId: string;
  assets: VideoEditorAsset[];
  organization?: VideoEditorAssetOrganization;
  disabled?: boolean;
  previewingAssetId?: string;
  onPreview?: (asset: VideoEditorAsset) => void;
  onAdd: (asset: VideoEditorAsset) => void;
  onAddBatch: (assets: VideoEditorAsset[]) => Promise<void>;
  onAddGenerated: (kind: "text" | "color", preset?: TextPreset) => void;
  onOrganizationChange: (next: VideoEditorAssetOrganization) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const uploadFolderId = useRef<string | undefined>(undefined);
  const importFolderId = useRef<string | undefined>(undefined);
  const client = useQueryClient();
  const [showImport, setShowImport] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [addMenuTarget, setAddMenuTarget] = useState<string>();
  const [deleting, setDeleting] = useState<VideoEditorAsset>();
  const [deleteError, setDeleteError] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string>();
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [assetMenuId, setAssetMenuId] = useState<string>();
  const [batchFolderId, setBatchFolderId] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [defaultChromaOpen, setDefaultChromaOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchMessage, setBatchMessage] = useState("");
  const [pendingPlacements, setPendingPlacements] = useState<
    PendingFolderPlacement[]
  >([]);
  const [uploadProgress, setUploadProgress] = useState({
    completed: 0,
    total: 0,
    filename: "",
  });
  const arranged = completeAssetOrganization(organization, assets);
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const batchAssetIds =
    batchFolderId === ROOT_BATCH_ID
      ? arranged.rootAssetIds
      : (arranged.folders.find((folder) => folder.id === batchFolderId)
          ?.assetIds ?? []);
  const batchFolderAssetIds = batchAssetIds.join("\u0000");
  const batchFolderExists =
    batchFolderId === ROOT_BATCH_ID ||
    arranged.folders.some((folder) => folder.id === batchFolderId);
  useEffect(() => {
    const valid = new Set(
      batchFolderAssetIds ? batchFolderAssetIds.split("\u0000") : [],
    );
    setSelectedIds((current) => {
      const next = current.filter((id) => valid.has(id));
      return next.length === current.length ? current : next;
    });
    if (batchFolderId && !batchFolderExists) setBatchFolderId(undefined);
  }, [batchFolderAssetIds, batchFolderExists, batchFolderId]);
  const sources = useQuery({
    queryKey: videoEditorQueryKeys.importSources,
    queryFn: listVideoEditorImportSources,
    enabled: showImport,
  });
  const refresh = () =>
    void client.invalidateQueries({
      queryKey: videoEditorQueryKeys.assets(projectId),
    });
  const placeInFolder = async (folderId: string, ids: string[]) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const [timeline, latestAssets] = await Promise.all([
          getVideoEditorTimeline(projectId),
          listVideoEditorAssets(projectId),
        ]);
        const complete = completeAssetOrganization(
          timeline.document.assetOrganization,
          latestAssets.items,
        );
        if (!complete.folders.some((folder) => folder.id === folderId))
          throw new Error("目标文件夹已不存在");
        const next = moveAssetsInOrganization(complete, ids, folderId);
        const saved = await applyVideoEditorOperations(
          projectId,
          timeline.revision,
          [{ type: "setAssetOrganization", organization: next }],
        );
        client.setQueryData(videoEditorQueryKeys.timeline(projectId), saved);
        return;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
  };
  const upload = useMutation({
    mutationFn: async ({
      files,
      folderId,
    }: {
      files: File[];
      folderId?: string;
    }) => {
      const failures: { filename: string; message: string }[] = [];
      let succeeded = 0;
      const uploadedIds: string[] = [];
      for (const [index, file] of files.entries()) {
        setUploadProgress({
          completed: index,
          total: files.length,
          filename: file.name,
        });
        try {
          const uploaded = await uploadVideoEditorAsset(projectId, file);
          succeeded += 1;
          uploadedIds.push(uploaded.id);
          refresh();
        } catch (error) {
          failures.push({
            filename: file.name,
            message: apiErrorMessage(error, "上传失败，请重试。"),
          });
        }
        setUploadProgress({
          completed: index + 1,
          total: files.length,
          filename: file.name,
        });
      }
      if (folderId && uploadedIds.length) {
        try {
          await placeInFolder(folderId, uploadedIds);
        } catch (error) {
          setPendingPlacements((current) => [
            ...current,
            { folderId, ids: uploadedIds },
          ]);
          setBatchMessage(
            `已上传 ${uploadedIds.length} 个素材，但归入文件夹失败；素材暂在“未分类”。${apiErrorMessage(error, "请重试归类。")}`,
          );
        }
      }
      return { succeeded, failures };
    },
    retry: false,
  });
  const importAssets = useMutation({
    mutationFn: async () => {
      const imported = await importVideoEditorAssets(projectId, chosen);
      const folderId = importFolderId.current;
      if (folderId && imported.items.length) {
        try {
          await placeInFolder(
            folderId,
            imported.items.map((item) => item.id),
          );
        } catch (error) {
          setPendingPlacements((current) => [
            ...current,
            { folderId, ids: imported.items.map((item) => item.id) },
          ]);
          setBatchMessage(
            `已导入 ${imported.items.length} 个素材，但归入文件夹失败；素材暂在“未分类”。${apiErrorMessage(error, "请重试归类。")}`,
          );
        }
      }
      return imported;
    },
    onSuccess: () => {
      setChosen([]);
      setShowImport(false);
      importFolderId.current = undefined;
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (assetId: string) => deleteVideoEditorAsset(projectId, assetId),
    onSuccess: () => {
      setDeleting(undefined);
      setDeleteError("");
      refresh();
      void client.invalidateQueries({
        queryKey: videoEditorQueryKeys.timeline(projectId),
      });
    },
    onError: (error) => {
      setDeleteError(apiErrorMessage(error, "素材删除失败，请稍后重试。"));
    },
  });

  const selectedIdSet = new Set(selectedIds);
  const orderedSelectedIds = batchAssetIds.filter((id) =>
    selectedIdSet.has(id),
  );
  const selectedAssets = orderedSelectedIds
    .map((id) => assetsById.get(id))
    .filter((asset): asset is VideoEditorAsset => Boolean(asset));
  const moveSelected = async (folderId: string | null) => {
    if (!selectedIds.length) return;
    try {
      setBatchBusy(true);
      await onOrganizationChange(
        moveAssetsInOrganization(arranged, orderedSelectedIds, folderId),
      );
      setSelectedIds([]);
      setBatchMessage(`已移动 ${selectedIds.length} 个素材`);
    } catch (error) {
      setBatchMessage(apiErrorMessage(error, "移动失败"));
    } finally {
      setBatchBusy(false);
    }
  };
  const addSelected = async () => {
    if (!selectedAssets.length) return;
    const unavailable = selectedAssets.find(
      (asset) =>
        !canEditAsset(asset) ||
        !["video", "audio", "image"].includes(asset.mediaKind),
    );
    if (unavailable) {
      setBatchMessage(`“${unavailable.displayName}”尚不能添加到时间线`);
      return;
    }
    try {
      setBatchBusy(true);
      await onAddBatch(selectedAssets);
      setBatchMessage(`已添加 ${selectedAssets.length} 个素材到时间线末尾`);
      setSelectedIds([]);
    } catch (error) {
      setBatchMessage(apiErrorMessage(error, "批量添加失败"));
    } finally {
      setBatchBusy(false);
    }
  };
  const deleteSelected = async () => {
    const failed: string[] = [];
    const failedIds: string[] = [];
    setBatchBusy(true);
    for (const asset of selectedAssets) {
      if (["queued", "processing"].includes(asset.processingStatus)) {
        failedIds.push(asset.id);
        failed.push(`${asset.displayName}：素材处理中，完成后可删除`);
        continue;
      }
      try {
        await deleteVideoEditorAsset(projectId, asset.id);
      } catch (error) {
        failedIds.push(asset.id);
        failed.push(
          `${asset.displayName}：${apiErrorMessage(error, "删除失败")}`,
        );
      }
    }
    setSelectedIds(failedIds);
    setBatchMessage(
      failed.length
        ? `部分素材未删除：${failed.join("；")}`
        : `已删除 ${selectedAssets.length} 个素材`,
    );
    setConfirmBatchDelete(false);
    setBatchBusy(false);
    refresh();
    void client.invalidateQueries({
      queryKey: videoEditorQueryKeys.timeline(projectId),
    });
  };

  const applyDefaultChroma = async (chromaKey: ChromaKey | null) => {
    const targets = selectedAssets.filter(
      (asset) => asset.mediaKind === "video" || asset.mediaKind === "image",
    );
    const skipped = selectedAssets.filter(
      (asset) => asset.mediaKind !== "video" && asset.mediaKind !== "image",
    );
    if (!targets.length) {
      setBatchMessage("所选素材没有可设置默认抠像的视频或图片");
      setDefaultChromaOpen(false);
      return;
    }
    const failed: string[] = [];
    setBatchBusy(true);
    for (const asset of targets) {
      try {
        await patchVideoEditorAsset(projectId, asset.id, asset.revision ?? 0, {
          chromaKey,
        });
      } catch (error) {
        failed.push(
          `${asset.displayName}：${apiErrorMessage(error, "更新失败")}`,
        );
      }
    }
    setDefaultChromaOpen(false);
    setBatchBusy(false);
    refresh();
    const parts = [
      chromaKey === null
        ? `已清除 ${targets.length - failed.length} 个素材的默认抠像`
        : `已为 ${targets.length - failed.length} 个素材设置默认抠像`,
    ];
    if (skipped.length) parts.push(`跳过 ${skipped.length} 个不支持的素材`);
    if (failed.length) parts.push(`失败：${failed.join("；")}`);
    setBatchMessage(parts.join("。"));
  };

  const bakeSelected = async () => {
    const candidates = selectedAssets.filter(
      (asset) => asset.mediaKind === "video" || asset.mediaKind === "image",
    );
    const skippedKind = selectedAssets.filter(
      (asset) => asset.mediaKind !== "video" && asset.mediaKind !== "image",
    );
    const notReady = candidates.filter(
      (asset) => asset.processingStatus !== "ready",
    );
    const missingChroma = candidates.filter(
      (asset) =>
        asset.processingStatus === "ready" &&
        !asset.defaultEffects?.chromaKey?.enabled,
    );
    const targets = candidates.filter(
      (asset) =>
        asset.processingStatus === "ready" &&
        asset.defaultEffects?.chromaKey?.enabled,
    );
    if (!targets.length) {
      const reasons = [
        skippedKind.length ? `${skippedKind.length} 个类型不支持` : "",
        notReady.length ? `${notReady.length} 个尚未就绪` : "",
        missingChroma.length
          ? `${missingChroma.length} 个未设置启用中的默认抠像`
          : "",
      ].filter(Boolean);
      setBatchMessage(
        reasons.length
          ? `没有可烘焙的素材（${reasons.join("，")}）`
          : "没有可烘焙的素材",
      );
      return;
    }
    setBatchBusy(true);
    const failed: string[] = [];
    let completed = 0;
    for (const [index, asset] of targets.entries()) {
      setBatchMessage(`正在烘焙 ${index + 1} / ${targets.length}`);
      try {
        let task = await createVideoEditorAssetBake(
          projectId,
          asset.id,
          asset.revision ?? 0,
        );
        while (task.status === "queued" || task.status === "running") {
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
          task = await getVideoEditorAssetBake(projectId, task.id);
        }
        if (task.status !== "completed") {
          failed.push(
            `${asset.displayName}：${task.error || task.status || "烘焙失败"}`,
          );
          continue;
        }
        completed += 1;
      } catch (error) {
        failed.push(
          `${asset.displayName}：${apiErrorMessage(error, "烘焙失败")}`,
        );
      }
    }
    setBatchBusy(false);
    refresh();
    void client.invalidateQueries({
      queryKey: videoEditorQueryKeys.timeline(projectId),
    });
    const parts = [`已烘焙 ${completed} 个素材`];
    if (skippedKind.length || notReady.length || missingChroma.length) {
      parts.push(
        `跳过 ${skippedKind.length + notReady.length + missingChroma.length} 个`,
      );
    }
    if (failed.length) parts.push(`失败：${failed.slice(0, 3).join("；")}`);
    setBatchMessage(parts.join("。"));
  };

  const saveFolderName = (
    event: FormEvent,
    folder?: VideoEditorAssetFolder,
  ) => {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) {
      setFolderError("请输入文件夹名称");
      return;
    }
    const duplicate = arranged.folders.some(
      (item) =>
        item.id !== folder?.id &&
        item.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (duplicate) {
      setFolderError("文件夹名称不能重复");
      return;
    }
    onOrganizationChange(
      folder
        ? {
            ...arranged,
            folders: arranged.folders.map((item) =>
              item.id === folder.id ? { ...item, name } : item,
            ),
          }
        : {
            ...arranged,
            folders: [
              ...arranged.folders,
              { id: crypto.randomUUID(), name, assetIds: [] },
            ],
          },
    );
    setCreatingFolder(false);
    setEditingFolderId(undefined);
    setFolderName("");
    setFolderError("");
  };
  const cancelFolderEdit = () => {
    setCreatingFolder(false);
    setEditingFolderId(undefined);
    setFolderName("");
    setFolderError("");
  };
  const toggleCollapsed = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const dropAsset = (
    event: DragEvent,
    folderId: string | null,
    beforeAssetId?: string,
  ) => {
    const assetId = event.dataTransfer.getData(ORGANIZE_ASSET_TYPE);
    if (!assetId) return;
    event.preventDefault();
    event.stopPropagation();
    onOrganizationChange(
      moveAssetInOrganization(arranged, assetId, folderId, beforeAssetId),
    );
  };
  const allowAssetDrop = (event: DragEvent) => {
    if (event.dataTransfer.types.includes(ORGANIZE_ASSET_TYPE))
      event.preventDefault();
  };
  const openLocalUpload = (folderId?: string) => {
    uploadFolderId.current = folderId;
    setAddMenuTarget(undefined);
    input.current?.click();
  };
  const openImport = (folderId?: string) => {
    importFolderId.current = folderId;
    setChosen([]);
    setAddMenuTarget(undefined);
    setShowImport(true);
  };
  const toggleBatch = (target: string) => {
    setBatchFolderId((current) => (current === target ? undefined : target));
    setSelectedIds([]);
    setBatchMessage("");
  };

  const renderAsset = (assetId: string, folderId: string | null) => {
    const asset = assetsById.get(assetId);
    if (!asset) return null;
    const batchKey = folderId ?? ROOT_BATCH_ID;
    return (
      <VideoEditorAssetRow
        key={asset.id}
        asset={asset}
        folderId={folderId}
        arranged={arranged}
        batchActive={batchFolderId === batchKey}
        selected={selectedIds.includes(asset.id)}
        previewing={previewingAssetId === asset.id}
        disabled={disabled}
        organizeOpen={assetMenuId === asset.id}
        onSelect={() =>
          setSelectedIds((current) =>
            current.includes(asset.id)
              ? current.filter((id) => id !== asset.id)
              : [...current, asset.id],
          )
        }
        onPreview={() => onPreview?.(asset)}
        onAdd={() => onAdd(asset)}
        onDelete={() => {
          setDeleteError("");
          setDeleting(asset);
        }}
        onToggleOrganize={() =>
          setAssetMenuId((current) =>
            current === asset.id ? undefined : asset.id,
          )
        }
        onCloseOrganize={() => setAssetMenuId(undefined)}
        onOrganizationChange={onOrganizationChange}
        onTimelineAssetDrag={onTimelineAssetDrag}
        onDragOver={allowAssetDrop}
        onDrop={(event) => dropAsset(event, folderId, asset.id)}
        organizeType={ORGANIZE_ASSET_TYPE}
        timelineType={TIMELINE_ASSET_TYPE}
      />
    );
  };

  const renderNameForm = (folder?: VideoEditorAssetFolder) => (
    <form
      className="ve-folder-name-form"
      onSubmit={(event) => saveFolderName(event, folder)}
    >
      <input
        autoFocus
        aria-label={folder ? `重命名文件夹“${folder.name}”` : "文件夹名称"}
        maxLength={80}
        value={folderName}
        onChange={(event) => {
          setFolderName(event.target.value);
          setFolderError("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") cancelFolderEdit();
        }}
      />
      <button type="submit" disabled={disabled} aria-label="保存文件夹名称">
        <Check aria-hidden />
      </button>
      <button
        type="button"
        aria-label="取消编辑文件夹"
        onClick={cancelFolderEdit}
      >
        <X aria-hidden />
      </button>
      {folderError ? <small role="alert">{folderError}</small> : null}
    </form>
  );

  const renderAddMenu = (target: string, ariaLabel: string) => (
    <VideoEditorAssetAddMenu
      open={addMenuTarget === target}
      disabled={disabled || upload.isPending}
      ariaLabel={ariaLabel}
      onToggle={() =>
        setAddMenuTarget((current) => (current === target ? undefined : target))
      }
      onClose={() => setAddMenuTarget(undefined)}
      onLocalUpload={() =>
        openLocalUpload(target === ROOT_BATCH_ID ? undefined : target)
      }
      onImport={() => openImport(target === ROOT_BATCH_ID ? undefined : target)}
    />
  );

  return (
    <aside className="ve-assets-panel" data-popover-boundary>
      <header>
        <strong>素材</strong>
        <div>
          <button
            type="button"
            disabled={disabled || creatingFolder}
            aria-label="新建素材文件夹"
            data-tooltip="新建文件夹"
            onClick={() => {
              setCreatingFolder(true);
              setEditingFolderId(undefined);
              setFolderName("");
              setFolderError("");
            }}
          >
            <FolderPlus aria-hidden />
          </button>
          <span>{assets.length}</span>
        </div>
      </header>
      <div className="ve-assets-toolbar">
        <input
          ref={input}
          hidden
          type="file"
          multiple
          aria-label="上传素材（可多选）"
          disabled={disabled || upload.isPending}
          accept="video/*,audio/*,image/*,.ttf,.otf,.woff,.woff2"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length && !disabled && !upload.isPending) {
              setUploadProgress({
                completed: 0,
                total: files.length,
                filename: files[0]!.name,
              });
              upload.mutate({ files, folderId: uploadFolderId.current });
            }
            event.target.value = "";
          }}
        />
        <VideoEditorAssetUploadFeedback
          pending={upload.isPending}
          progress={uploadProgress}
          result={upload.data}
          placements={pendingPlacements}
          folders={arranged.folders}
          onRetry={(placement) =>
            void placeInFolder(placement.folderId, placement.ids)
              .then(() => {
                setPendingPlacements((current) =>
                  current.filter((item) => item !== placement),
                );
                setBatchMessage("已将上传素材归入文件夹");
              })
              .catch((error) =>
                setBatchMessage(apiErrorMessage(error, "归类失败，请重试")),
              )
          }
        />
        <div className="ve-generated-assets">
          <CustomSelect
            value=""
            ariaLabel="添加文字"
            disabled={disabled}
            options={[
              { value: "", label: "添加文字", disabled: true },
              ...textPresets,
            ]}
            leadingIcon={<Type aria-hidden />}
            onChange={(value) => onAddGenerated("text", value as TextPreset)}
          />
          <button type="button" onClick={() => onAddGenerated("color")}>
            <span className="ve-black-swatch" aria-hidden /> 纯色黑幕
          </button>
        </div>
      </div>
      <div className="ve-assets-list">
        {creatingFolder ? renderNameForm() : null}
        {arranged.folders.map((folder, folderIndex) => {
          const isCollapsed = collapsed.has(folder.id);
          return (
            <section className="ve-asset-group" key={folder.id}>
              {editingFolderId === folder.id ? (
                renderNameForm(folder)
              ) : (
                <div
                  className="ve-asset-folder-row"
                  onDragOver={(event) => {
                    if (
                      event.dataTransfer.types.includes(ORGANIZE_ASSET_TYPE) ||
                      event.dataTransfer.types.includes(FOLDER_TYPE)
                    )
                      event.preventDefault();
                  }}
                  onDrop={(event) => {
                    const movingFolderId =
                      event.dataTransfer.getData(FOLDER_TYPE);
                    if (movingFolderId) {
                      event.preventDefault();
                      onOrganizationChange(
                        moveFolderBefore(arranged, movingFolderId, folder.id),
                      );
                    } else dropAsset(event, folder.id);
                  }}
                >
                  <span
                    className="ve-folder-drag"
                    draggable={!disabled}
                    title="拖拽调整文件夹顺序"
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData(FOLDER_TYPE, folder.id);
                    }}
                  >
                    <Folder aria-hidden />
                  </span>
                  <button
                    type="button"
                    className="ve-folder-toggle"
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleCollapsed(folder.id)}
                  >
                    {isCollapsed ? (
                      <ChevronRight aria-hidden />
                    ) : (
                      <ChevronDown aria-hidden />
                    )}
                    <strong>{folder.name}</strong>
                    <small>{folder.assetIds.length}</small>
                  </button>
                  <div className="ve-folder-quick-actions">
                    {renderAddMenu(
                      folder.id,
                      `向文件夹“${folder.name}”添加素材`,
                    )}
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={`批量选择文件夹“${folder.name}”中的素材`}
                      data-tooltip="批量选择"
                      aria-pressed={batchFolderId === folder.id}
                      onClick={() => toggleBatch(folder.id)}
                    >
                      <CheckSquare2 aria-hidden />
                    </button>
                  </div>
                  <div className="ve-folder-controls">
                    <button
                      type="button"
                      disabled={disabled || folderIndex === 0}
                      aria-label={`上移文件夹“${folder.name}”`}
                      data-tooltip="上移"
                      onClick={() =>
                        onOrganizationChange(
                          shiftFolderInOrganization(arranged, folder.id, -1),
                        )
                      }
                    >
                      <ArrowUp aria-hidden />
                    </button>
                    <button
                      type="button"
                      disabled={
                        disabled || folderIndex === arranged.folders.length - 1
                      }
                      aria-label={`下移文件夹“${folder.name}”`}
                      data-tooltip="下移"
                      onClick={() =>
                        onOrganizationChange(
                          shiftFolderInOrganization(arranged, folder.id, 1),
                        )
                      }
                    >
                      <ArrowDown aria-hidden />
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={`重命名文件夹“${folder.name}”`}
                      data-tooltip="重命名"
                      onClick={() => {
                        setEditingFolderId(folder.id);
                        setCreatingFolder(false);
                        setFolderName(folder.name);
                        setFolderError("");
                      }}
                    >
                      <Pencil aria-hidden />
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={`删除文件夹“${folder.name}”`}
                      data-tooltip="删除文件夹"
                      onClick={() =>
                        onOrganizationChange(
                          deleteFolderFromOrganization(arranged, folder.id),
                        )
                      }
                    >
                      <Trash2 aria-hidden />
                    </button>
                  </div>
                </div>
              )}
              {!isCollapsed ? (
                <div className="ve-folder-assets">
                  {batchFolderId === folder.id ? (
                    <VideoEditorAssetBatchSelectionHeader
                      count={selectedIds.length}
                      total={folder.assetIds.length}
                      onSelectAll={() => setSelectedIds([...folder.assetIds])}
                      onClearSelection={() => setSelectedIds([])}
                      onExit={() => {
                        setBatchFolderId(undefined);
                        setSelectedIds([]);
                      }}
                    />
                  ) : null}
                  {folder.assetIds.map((assetId) =>
                    renderAsset(assetId, folder.id),
                  )}
                  {!folder.assetIds.length ? <p>拖入素材</p> : null}
                </div>
              ) : null}
            </section>
          );
        })}
        <section className="ve-asset-group ve-root-assets">
          <div
            className="ve-asset-folder-row ve-root-assets-row"
            onDragOver={allowAssetDrop}
            onDrop={(event) => dropAsset(event, null)}
          >
            <button
              type="button"
              className="ve-root-assets-toggle"
              aria-expanded={!collapsed.has(ROOT_BATCH_ID)}
              onClick={() => toggleCollapsed(ROOT_BATCH_ID)}
            >
              {collapsed.has(ROOT_BATCH_ID) ? (
                <ChevronRight aria-hidden />
              ) : (
                <ChevronDown aria-hidden />
              )}
              <strong>未分类</strong>
              <small>{arranged.rootAssetIds.length}</small>
            </button>
            <div className="ve-folder-quick-actions">
              {renderAddMenu(ROOT_BATCH_ID, "向未分类添加素材")}
              <button
                type="button"
                disabled={disabled}
                aria-label="批量选择未分类中的素材"
                data-tooltip="批量选择"
                aria-pressed={batchFolderId === ROOT_BATCH_ID}
                onClick={() => toggleBatch(ROOT_BATCH_ID)}
              >
                <CheckSquare2 aria-hidden />
              </button>
            </div>
          </div>
          {!collapsed.has(ROOT_BATCH_ID) ? (
            <div className="ve-folder-assets">
              {batchFolderId === ROOT_BATCH_ID ? (
                <VideoEditorAssetBatchSelectionHeader
                  count={selectedIds.length}
                  total={arranged.rootAssetIds.length}
                  onSelectAll={() => setSelectedIds([...arranged.rootAssetIds])}
                  onClearSelection={() => setSelectedIds([])}
                  onExit={() => {
                    setBatchFolderId(undefined);
                    setSelectedIds([]);
                  }}
                />
              ) : null}
              {arranged.rootAssetIds.map((assetId) =>
                renderAsset(assetId, null),
              )}
              {!arranged.rootAssetIds.length ? <p>拖入素材</p> : null}
            </div>
          ) : null}
        </section>
      </div>
      {batchFolderId ? (
        <VideoEditorAssetBatchToolbar
          folderId={
            batchFolderId === ROOT_BATCH_ID ? ROOT_BATCH_ID : batchFolderId
          }
          folders={arranged.folders}
          count={selectedIds.length}
          busy={batchBusy}
          message={batchMessage}
          onAdd={() => void addSelected()}
          onMove={(folderId) => void moveSelected(folderId)}
          onDelete={() => setConfirmBatchDelete(true)}
          onDefaultChroma={() => setDefaultChromaOpen(true)}
          onBake={() => void bakeSelected()}
        />
      ) : batchMessage ? (
        <p className="ve-batch-message" role="status">
          {batchMessage}
        </p>
      ) : null}
      <VideoEditorAssetDefaultChromaDialog
        open={defaultChromaOpen}
        count={
          selectedAssets.filter(
            (asset) =>
              asset.mediaKind === "video" || asset.mediaKind === "image",
          ).length
        }
        pending={batchBusy}
        onCancel={() => setDefaultChromaOpen(false)}
        onApply={(chromaKey) => void applyDefaultChroma(chromaKey)}
      />
      {showImport ? (
        <VideoEditorAssetImportDialog
          items={sources.data?.items ?? []}
          chosen={chosen}
          pending={importAssets.isPending}
          onToggle={(assetId) =>
            setChosen((items) =>
              items.includes(assetId)
                ? items.filter((id) => id !== assetId)
                : [...items, assetId],
            )
          }
          onCancel={() => {
            setShowImport(false);
            setChosen([]);
            importFolderId.current = undefined;
          }}
          onConfirm={() => importAssets.mutate()}
        />
      ) : null}
      <ConfirmDialog
        open={confirmBatchDelete}
        title={`删除选中的 ${selectedIds.length} 个素材？`}
        description="删除后无法撤销；仍被时间线引用的素材会保留并显示失败原因。"
        confirmLabel="确认删除"
        pending={batchBusy}
        onCancel={() => setConfirmBatchDelete(false)}
        onConfirm={() => void deleteSelected()}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        title={deleting ? `删除“${deleting.displayName}”？` : "删除素材？"}
        description={
          <>
            <span>删除后将清理该项目中的源文件，且无法撤销。</span>
            {deleteError ? (
              <strong className="ve-asset-delete-error" role="alert">
                {deleteError}
              </strong>
            ) : null}
          </>
        }
        confirmLabel="确认删除"
        pending={remove.isPending}
        onCancel={() => {
          setDeleting(undefined);
          setDeleteError("");
        }}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </aside>
  );
}
