import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { useTransferProgress } from "@platform/api/useTransferProgress";
import { LoadingState } from "@shared/ui/LoadingState";
import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Copy,
  Download,
  Eye,
  FolderOpen,
  LoaderCircle,
  Pencil,
  Trash2,
  Undo2,
} from "lucide-react";
import type { useVisualWorkspaceController } from "@features/galgame-workshop/editor/useVisualWorkspaceController";
import { visualMenuPosition } from "@features/galgame-workshop/editor/visuals/model";
import { fetchApiDownload } from "@platform/api/client";

type VisualWorkspaceViewModel = ReturnType<typeof useVisualWorkspaceController>;

export function VisualItemMenu({ model }: { model: VisualWorkspaceViewModel }) {
  const { run: runTransfer, progress: activeTransferProgress } =
    useTransferProgress();

  const {
    itemMenu,
    menuScene,
    menuCg,
    menuRef,
    selectVisual,
    setItemMenu,
    beginRename,
    moveScene,
    groups,
    duplicateVisual,
    menuReferences,
    removeVisual,
    selection,
    selectedLayer,
    selectedVariant,
    assetsById,
    onNotice,
  } = model;
  const [position, setPosition] = useState<{
    key: string;
    left: number;
    top: number;
  }>();
  const [downloadingFileId, setDownloadingFileId] = useState<string>();
  const menuKey = itemMenu ? `${itemMenu.item.kind}:${itemMenu.item.id}` : "";
  const menuAssetId = menuScene
    ? (selection?.kind === "scene" && selection.id === menuScene.id
        ? selectedLayer
        : menuScene.layers?.[0]
      )?.assetId
    : menuCg
      ? (selection?.kind === "cg" && selection.id === menuCg.id
          ? selectedVariant
          : ((menuCg.variants ?? []).find(
              (variant) => variant.id === menuCg.defaultVariantId,
            ) ?? menuCg.variants?.[0])
        )?.assetId
      : undefined;
  const menuFileId = assetsById.get(menuAssetId ?? "")?.fileId;

  useLayoutEffect(() => {
    if (!itemMenu || !menuRef.current) return;
    const next = visualMenuPosition(
      itemMenu.trigger.getBoundingClientRect(),
      menuRef.current.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPosition({ key: menuKey, ...next });
  }, [itemMenu, menuKey, menuRef]);

  const downloadImage = async () => {
    if (!menuFileId || downloadingFileId) return;
    const downloadMenuKey = menuKey;
    setDownloadingFileId(menuFileId);
    try {
      const download = await runTransfer((onProgress) =>
        fetchApiDownload(
          `/v1/files/${encodeURIComponent(menuFileId)}/download`,
          { onProgress },
        ),
      );
      const url = URL.createObjectURL(download.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        download.filename ??
        `${(menuScene?.name ?? menuCg?.name ?? "图片").replace(/[\\/]/g, "-")}.png`;
      try {
        anchor.click();
      } finally {
        URL.revokeObjectURL(url);
      }
      setItemMenu((current) =>
        current && `${current.item.kind}:${current.item.id}` === downloadMenuKey
          ? undefined
          : current,
      );
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "下载失败，请重试。");
    } finally {
      setDownloadingFileId(undefined);
    }
  };

  return (
    <>
      <TransferFeedback progress={activeTransferProgress} />

      {itemMenu && (menuScene || menuCg)
        ? createPortal(
            <div
              ref={menuRef}
              id="galgame-visual-item-menu"
              className="galgame-visual-item-menu"
              role="menu"
              aria-label={`${menuScene?.name ?? menuCg?.name} 操作`}
              style={
                position?.key === menuKey
                  ? { left: position.left, top: position.top }
                  : { left: 0, top: 0, visibility: "hidden" }
              }
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  selectVisual(itemMenu.item);
                  setItemMenu(undefined);
                }}
              >
                <Eye aria-hidden />
                打开{menuScene ? "场景" : " CG"}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!menuFileId || Boolean(downloadingFileId)}
                title={menuFileId ? undefined : "当前资源没有可下载的图片。"}
                onClick={() => void downloadImage()}
              >
                {downloadingFileId ? (
                  <LoaderCircle aria-hidden />
                ) : (
                  <Download aria-hidden />
                )}
                {downloadingFileId ? (
                  <LoadingState variant="inline" label="下载中…" />
                ) : (
                  "下载图片"
                )}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => beginRename(itemMenu.item)}
              >
                <Pencil aria-hidden />
                重命名
              </button>

              {menuScene ? (
                <>
                  <i aria-hidden />
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!menuScene.groupId}
                    onClick={() => {
                      moveScene(menuScene.id, undefined, null);
                      setItemMenu(undefined);
                    }}
                  >
                    <Undo2 aria-hidden />
                    移出分组
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!menuScene.groupId}
                    onClick={() => {
                      moveScene(menuScene.id, undefined, null);
                      setItemMenu(undefined);
                    }}
                  >
                    {!menuScene.groupId ? (
                      <Check aria-hidden />
                    ) : (
                      <FolderOpen aria-hidden />
                    )}
                    移动到 场景
                  </button>
                  {groups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      role="menuitem"
                      disabled={menuScene.groupId === group.id}
                      onClick={() => {
                        moveScene(menuScene.id, undefined, group.id);
                        setItemMenu(undefined);
                      }}
                    >
                      {menuScene.groupId === group.id ? (
                        <Check aria-hidden />
                      ) : (
                        <FolderOpen aria-hidden />
                      )}
                      移动到 {group.name}
                    </button>
                  ))}
                </>
              ) : null}

              <i aria-hidden />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  duplicateVisual(itemMenu.item);
                  setItemMenu(undefined);
                }}
              >
                <Copy aria-hidden />
                复制{menuScene ? "场景" : " CG"}
              </button>
              <i aria-hidden />
              <button
                type="button"
                className="danger"
                role="menuitem"
                disabled={menuReferences.length > 0}
                title={
                  menuReferences.length
                    ? menuScene
                      ? "场景仍被 Scene Block 引用，无法删除。"
                      : "CG 仍被显示 CG Block 引用，无法删除。"
                    : undefined
                }
                onClick={() => {
                  removeVisual(itemMenu.item);
                  setItemMenu(undefined);
                }}
              >
                <Trash2 aria-hidden />
                删除{menuScene ? "场景" : " CG"}
              </button>
            </div>,
            itemMenu.trigger.closest(".galgame-editor-page") ??
              globalThis.document.body,
          )
        : null}
    </>
  );
}
