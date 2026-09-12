import { CustomSelect } from "@shared/ui/CustomSelect";
import { textPresets, type TextPreset } from "./textModel";
import {
  canEditAsset,
  assetPreparationLabel,
  assetUnavailableReason,
} from "./assetReadiness";
import { type DragEvent, type FormEvent, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage } from "@platform/api/errors";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  Folder,
  FolderInput,
  FolderPlus,
  Image,
  Library,
  Music2,
  Pencil,
  Trash2,
  Type,
  Upload,
  Video,
  X,
} from "lucide-react";
import {
  deleteVideoEditorAsset,
  importVideoEditorAssets,
  listVideoEditorImportSources,
  uploadVideoEditorAsset,
} from "./api";
import {
  completeAssetOrganization,
  deleteFolderFromOrganization,
  moveAssetInOrganization,
  moveFolderBefore,
  shiftAssetInOrganization,
  shiftFolderInOrganization,
} from "./assetOrganization";
import { videoEditorQueryKeys } from "./queryKeys";
import type {
  VideoEditorAsset,
  VideoEditorAssetFolder,
  VideoEditorAssetOrganization,
} from "./types";
import "./video-editor-assets.css";

const ORGANIZE_ASSET_TYPE = "application/x-video-editor-organize-asset";
const TIMELINE_ASSET_TYPE = "application/x-video-editor-asset";
const FOLDER_TYPE = "application/x-video-editor-folder";

const iconFor = (kind: string) =>
  kind === "video"
    ? Video
    : kind === "audio"
      ? Music2
      : kind === "image"
        ? Image
        : Type;

export function VideoEditorAssetPanel({
  projectId,
  assets,
  organization,
  disabled = false,
  onAdd,
  onAddGenerated,
  onOrganizationChange,
  onTimelineAssetDrag,
}: {
  onTimelineAssetDrag?: (asset?: VideoEditorAsset) => void;
  projectId: string;
  assets: VideoEditorAsset[];
  organization?: VideoEditorAssetOrganization;
  disabled?: boolean;
  onAdd: (asset: VideoEditorAsset) => void;
  onAddGenerated: (kind: "text" | "color", preset?: TextPreset) => void;
  onOrganizationChange: (next: VideoEditorAssetOrganization) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const [showImport, setShowImport] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<VideoEditorAsset>();
  const [deleteError, setDeleteError] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string>();
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [assetMenuId, setAssetMenuId] = useState<string>();
  const [uploadProgress, setUploadProgress] = useState({
    completed: 0,
    total: 0,
    filename: "",
  });
  const arranged = completeAssetOrganization(organization, assets);
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const sources = useQuery({
    queryKey: videoEditorQueryKeys.importSources,
    queryFn: listVideoEditorImportSources,
    enabled: showImport,
  });
  const refresh = () =>
    void client.invalidateQueries({
      queryKey: videoEditorQueryKeys.assets(projectId),
    });
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const failures: { filename: string; message: string }[] = [];
      let succeeded = 0;
      for (const [index, file] of files.entries()) {
        setUploadProgress({
          completed: index,
          total: files.length,
          filename: file.name,
        });
        try {
          await uploadVideoEditorAsset(projectId, file);
          succeeded += 1;
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
      return { succeeded, failures };
    },
    retry: false,
  });
  const importAssets = useMutation({
    mutationFn: () => importVideoEditorAssets(projectId, chosen),
    onSuccess: () => {
      setChosen([]);
      setShowImport(false);
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

  const renderAsset = (assetId: string, folderId: string | null) => {
    const asset = assetsById.get(assetId);
    if (!asset) return null;
    const Icon = iconFor(asset.mediaKind);
    const ready = canEditAsset(asset);
    const processing = ["queued", "processing"].includes(
      asset.processingStatus,
    );
    const list = folderId
      ? (arranged.folders.find((folder) => folder.id === folderId)?.assetIds ??
        [])
      : arranged.rootAssetIds;
    const index = list.indexOf(asset.id);
    return (
      <div
        key={asset.id}
        className="ve-asset-wrap"
        title={ready ? undefined : assetUnavailableReason(asset)}
        draggable={!disabled}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "copyMove";
          event.dataTransfer.setData(ORGANIZE_ASSET_TYPE, asset.id);
          event.dataTransfer.setData(TIMELINE_ASSET_TYPE, asset.id);
          onTimelineAssetDrag?.(asset);
        }}
        onDragEnd={() => onTimelineAssetDrag?.()}
        onDragOver={allowAssetDrop}
        onDrop={(event) => dropAsset(event, folderId, asset.id)}
      >
        <div className="ve-asset">
          <button
            type="button"
            className="ve-asset-main"
            disabled={!ready || disabled}
            aria-label={`双击将“${asset.displayName}”添加到时间轴`}
            onDoubleClick={() => onAdd(asset)}
          >
            {asset.thumbnailUrl ? (
              <img src={asset.thumbnailUrl} alt="" />
            ) : (
              <span>
                <Icon aria-hidden />
              </span>
            )}
            <span className="ve-asset-copy">
              <strong>{asset.displayName}</strong>
              <small>{assetPreparationLabel(asset)}</small>
            </span>
          </button>
          <div className="ve-asset-controls">
            <button
              type="button"
              disabled={!ready || disabled}
              aria-label={`将“${asset.displayName}”添加到时间轴`}
              title={ready ? "添加到时间轴" : assetUnavailableReason(asset)}
              onClick={() => onAdd(asset)}
            >
              <FilePlus2 aria-hidden />
            </button>
            <button
              type="button"
              disabled={disabled}
              aria-expanded={assetMenuId === asset.id}
              aria-label={`整理素材“${asset.displayName}”`}
              title="整理素材"
              onClick={() =>
                setAssetMenuId((current) =>
                  current === asset.id ? undefined : asset.id,
                )
              }
            >
              <FolderInput aria-hidden />
            </button>
            <button
              type="button"
              className="ve-asset-delete"
              disabled={processing || disabled}
              aria-label={`删除素材“${asset.displayName}”`}
              title={processing ? "素材处理中，完成后可删除" : "删除素材"}
              onClick={() => {
                setDeleteError("");
                setDeleting(asset);
              }}
            >
              <Trash2 aria-hidden />
            </button>
          </div>
        </div>
        {assetMenuId === asset.id ? (
          <div className="ve-asset-organize-menu" role="menu">
            <div>
              <button
                role="menuitem"
                disabled={index === 0}
                onClick={() => {
                  onOrganizationChange(
                    shiftAssetInOrganization(arranged, asset.id, -1),
                  );
                  setAssetMenuId(undefined);
                }}
              >
                <ArrowUp aria-hidden /> 上移
              </button>
              <button
                role="menuitem"
                disabled={index === list.length - 1}
                onClick={() => {
                  onOrganizationChange(
                    shiftAssetInOrganization(arranged, asset.id, 1),
                  );
                  setAssetMenuId(undefined);
                }}
              >
                <ArrowDown aria-hidden /> 下移
              </button>
            </div>
            <strong>移动到</strong>
            <button
              role="menuitem"
              disabled={folderId === null}
              onClick={() => {
                onOrganizationChange(
                  moveAssetInOrganization(arranged, asset.id, null),
                );
                setAssetMenuId(undefined);
              }}
            >
              未分类
            </button>
            {arranged.folders.map((folder) => (
              <button
                key={folder.id}
                role="menuitem"
                disabled={folder.id === folderId}
                onClick={() => {
                  onOrganizationChange(
                    moveAssetInOrganization(arranged, asset.id, folder.id),
                  );
                  setAssetMenuId(undefined);
                }}
              >
                {folder.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
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

  return (
    <aside className="ve-assets-panel">
      <header>
        <strong>素材</strong>
        <div>
          <button
            type="button"
            disabled={disabled || creatingFolder}
            aria-label="新建素材文件夹"
            title="新建文件夹"
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
      <div className="ve-asset-actions">
        <button
          disabled={disabled || upload.isPending}
          onClick={() => input.current?.click()}
          title="选择一个或多个素材上传"
        >
          <Upload aria-hidden />{" "}
          {upload.isPending
            ? `上传中 ${uploadProgress.completed}/${uploadProgress.total}`
            : "上传"}
        </button>
        <button onClick={() => setShowImport(true)}>
          <Library aria-hidden /> 导入快照
        </button>
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
              upload.mutate(files);
            }
            event.target.value = "";
          }}
        />
      </div>
      {upload.isPending || upload.data ? (
        <div className="ve-upload-feedback">
          <p role="status">
            {upload.isPending
              ? `正在上传 ${uploadProgress.completed}/${uploadProgress.total}：${uploadProgress.filename}`
              : `上传完成：成功 ${upload.data!.succeeded} 个${upload.data!.failures.length ? `，失败 ${upload.data!.failures.length} 个` : ""}`}
          </p>
          {!upload.isPending && upload.data?.failures.length ? (
            <ul role="alert">
              {upload.data.failures.map((failure, index) => (
                <li key={index}>
                  {failure.filename}：{failure.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
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
        <button onClick={() => onAddGenerated("color")}>
          <span className="ve-black-swatch" /> 纯色黑幕
        </button>
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
                  <div className="ve-folder-controls">
                    <button
                      type="button"
                      disabled={disabled || folderIndex === 0}
                      aria-label={`上移文件夹“${folder.name}”`}
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
                      title="删除文件夹，素材将移到未分类"
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
          <button
            type="button"
            className="ve-root-assets-toggle"
            aria-expanded={!collapsed.has("root")}
            onClick={() => toggleCollapsed("root")}
            onDragOver={allowAssetDrop}
            onDrop={(event) => dropAsset(event, null)}
          >
            {collapsed.has("root") ? (
              <ChevronRight aria-hidden />
            ) : (
              <ChevronDown aria-hidden />
            )}
            <strong>未分类</strong>
            <small>{arranged.rootAssetIds.length}</small>
          </button>
          {!collapsed.has("root") ? (
            <div className="ve-folder-assets">
              {arranged.rootAssetIds.map((assetId) =>
                renderAsset(assetId, null),
              )}
              {!arranged.rootAssetIds.length ? <p>拖入素材</p> : null}
            </div>
          ) : null}
        </section>
      </div>
      {showImport ? (
        <div className="ve-dialog-backdrop">
          <section
            className="ve-dialog ve-import-dialog"
            role="dialog"
            aria-modal="true"
          >
            <h2>从其他应用复制素材</h2>
            <p>导入后生成独立物理快照，源项目删除也不会影响剪辑。</p>
            <div>
              {(sources.data?.items ?? []).map((asset) => (
                <button
                  key={asset.id}
                  className={chosen.includes(asset.id) ? "selected" : ""}
                  onClick={() =>
                    setChosen((items) =>
                      items.includes(asset.id)
                        ? items.filter((id) => id !== asset.id)
                        : [...items, asset.id],
                    )
                  }
                >
                  <span>{chosen.includes(asset.id) ? "✓" : ""}</span>
                  <div>
                    <strong>{asset.displayName}</strong>
                    <small>{asset.sourceApplication}</small>
                  </div>
                </button>
              ))}
            </div>
            <footer>
              <button onClick={() => setShowImport(false)}>取消</button>
              <button
                className="primary"
                disabled={!chosen.length}
                onClick={() => importAssets.mutate()}
              >
                复制 {chosen.length || ""} 项
              </button>
            </footer>
          </section>
        </div>
      ) : null}
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
