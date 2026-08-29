import { Images, MapPinned, MoreHorizontal } from "lucide-react";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import type { useVisualWorkspaceController } from "@features/galgame-workshop/editor/useVisualWorkspaceController";
import type { VisualSelection } from "@features/galgame-workshop/editor/visuals/model";

type VisualWorkspaceViewModel = ReturnType<typeof useVisualWorkspaceController>;

export function VisualBrowserItem({
  model,
  item,
}: {
  model: VisualWorkspaceViewModel;
  item: VisualSelection;
}) {
  const {
    scenes,
    cgs,
    assetsById,
    selection,
    renaming,
    renameInputRef,
    renameDraft,
    setRenameDraft,
    commitRename,
    setRenaming,
    itemMenu,
    draggedItem,
    moveScene,
    moveCg,
    selectVisual,
    openItemMenu,
  } = model;
  const scene =
    item.kind === "scene"
      ? scenes.find((candidate) => candidate.id === item.id)
      : undefined;
  const cg =
    item.kind === "cg"
      ? cgs.find((candidate) => candidate.id === item.id)
      : undefined;
  if (!scene && !cg) return null;
  const sceneLayer = scene?.layers?.[0];
  const cgVariant = cg?.variants?.find(
    (variant) => variant.id === cg.defaultVariantId,
  );
  const asset = assetsById.get(sceneLayer?.assetId ?? cgVariant?.assetId ?? "");
  const selected = selection?.kind === item.kind && selection.id === item.id;
  const isRenaming = renaming?.kind === item.kind && renaming.id === item.id;
  const menuOpen =
    itemMenu?.item.kind === item.kind && itemMenu.item.id === item.id;
  const name = scene?.name ?? cg?.name ?? "";

  return (
    <div
      className={`galgame-visual-browser-item${selected ? " active" : ""}`}
      draggable={!isRenaming}
      onDragStart={(event) => {
        if (
          (event.target as HTMLElement).closest(
            ".galgame-visual-browser-menu-trigger",
          )
        ) {
          event.preventDefault();
          return;
        }
        draggedItem.current = item;
        event.dataTransfer.setData("text/visual-id", item.id);
      }}
      onDragEnd={() => {
        draggedItem.current = undefined;
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const dragged = draggedItem.current;
        if (!dragged || dragged.kind !== item.kind) return;
        if (item.kind === "scene")
          moveScene(dragged.id, item.id, scene?.groupId ?? null);
        else moveCg(dragged.id, item.id);
        draggedItem.current = undefined;
      }}
    >
      {isRenaming ? (
        <div className="galgame-visual-browser-open is-renaming">
          <span>
            <StoryAssetImage
              fileId={asset?.fileId}
              alt=""
              fallback={
                item.kind === "scene" ? (
                  <MapPinned aria-hidden />
                ) : (
                  <Images aria-hidden />
                )
              }
            />
          </span>
          <em>
            <input
              ref={renameInputRef}
              aria-label={`重命名${item.kind === "scene" ? "场景" : "CG"}`}
              value={renameDraft}
              maxLength={120}
              onChange={(event) => setRenameDraft(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitRename();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setRenaming(undefined);
                }
              }}
            />
            <small>
              {item.kind === "scene"
                ? `${scene?.layers?.length ?? 0} 层`
                : `${cg?.variants?.length ?? 0} 个差分`}
            </small>
          </em>
        </div>
      ) : (
        <button
          type="button"
          className="galgame-visual-browser-open"
          onClick={() => selectVisual(item)}
        >
          <span>
            <StoryAssetImage
              fileId={asset?.fileId}
              alt=""
              fallback={
                item.kind === "scene" ? (
                  <MapPinned aria-hidden />
                ) : (
                  <Images aria-hidden />
                )
              }
            />
          </span>
          <em>
            <strong>{name}</strong>
            <small>
              {item.kind === "scene"
                ? `${scene?.layers?.length ?? 0} 层`
                : `${cg?.variants?.length ?? 0} 个差分`}
            </small>
          </em>
        </button>
      )}
      <button
        type="button"
        className="galgame-visual-browser-menu-trigger"
        aria-label={`更多操作 ${name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? "galgame-visual-item-menu" : undefined}
        draggable={false}
        onClick={(event) => openItemMenu(event.currentTarget, item)}
      >
        <MoreHorizontal aria-hidden />
      </button>
    </div>
  );
}
