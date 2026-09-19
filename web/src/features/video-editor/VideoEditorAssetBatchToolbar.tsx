import { useState } from "react";
import type { VideoEditorAssetFolder } from "./types";

export function VideoEditorAssetBatchSelectionHeader({
  count,
  total,
  onSelectAll,
  onClearSelection,
  onExit,
}: {
  count: number;
  total: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onExit: () => void;
}) {
  const allSelected = total > 0 && count === total;
  return (
    <div className="ve-batch-selection-head">
      <span>已选择 {count} 项</span>
      <button
        type="button"
        disabled={!total}
        onClick={allSelected ? onClearSelection : onSelectAll}
      >
        {allSelected ? "取消全选" : "全选"}
      </button>
      <button type="button" onClick={onExit}>
        退出多选
      </button>
    </div>
  );
}

export function VideoEditorAssetBatchToolbar({
  folderId,
  folders,
  count,
  busy,
  message,
  onAdd,
  onMove,
  onDelete,
}: {
  folderId: string | "root";
  folders: VideoEditorAssetFolder[];
  count: number;
  busy: boolean;
  message: string;
  onAdd: () => void;
  onMove: (folderId: string | null) => void;
  onDelete: () => void;
}) {
  const [moveOpen, setMoveOpen] = useState(false);
  const inRoot = folderId === "root";
  return (
    <div className="ve-batch-toolbar">
      {message ? <p role="status">{message}</p> : null}
      <div>
        <button type="button" disabled={!count || busy} onClick={onAdd}>
          添加到时间轴
        </button>
        <button
          type="button"
          disabled={!count || busy}
          aria-expanded={moveOpen}
          onClick={() => setMoveOpen((value) => !value)}
        >
          移动到文件夹
        </button>
        <button
          type="button"
          className="danger"
          disabled={!count || busy}
          onClick={onDelete}
        >
          删除
        </button>
      </div>
      {moveOpen ? (
        <div className="ve-batch-move-menu" role="menu">
          <button
            role="menuitem"
            disabled={inRoot}
            onClick={() => {
              onMove(null);
              setMoveOpen(false);
            }}
          >
            未分类
          </button>
          {folders
            .filter((folder) => folder.id !== folderId)
            .map((folder) => (
              <button
                role="menuitem"
                key={folder.id}
                onClick={() => {
                  onMove(folder.id);
                  setMoveOpen(false);
                }}
              >
                {folder.name}
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}
