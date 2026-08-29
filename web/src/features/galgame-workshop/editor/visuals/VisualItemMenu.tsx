import { createPortal } from "react-dom";
import {
  Check,
  Copy,
  Eye,
  FolderOpen,
  Pencil,
  Trash2,
  Undo2,
} from "lucide-react";
import type { useVisualWorkspaceController } from "@features/galgame-workshop/editor/useVisualWorkspaceController";

type VisualWorkspaceViewModel = ReturnType<typeof useVisualWorkspaceController>;

export function VisualItemMenu({ model }: { model: VisualWorkspaceViewModel }) {
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
  } = model;
  return (
    <>
      {itemMenu && (menuScene || menuCg)
        ? createPortal(
            <div
              ref={menuRef}
              id="galgame-visual-item-menu"
              className="galgame-visual-item-menu"
              role="menu"
              aria-label={`${menuScene?.name ?? menuCg?.name} 操作`}
              style={{ left: itemMenu.left, top: itemMenu.top }}
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
            globalThis.document.body,
          )
        : null}
    </>
  );
}
