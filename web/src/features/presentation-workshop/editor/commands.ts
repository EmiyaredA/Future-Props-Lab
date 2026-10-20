import type { PresentationAction } from "../PresentationMenu";

export type CommandId =
  | "save"
  | "undo"
  | "redo"
  | "duplicate"
  | "remove"
  | "selectAll"
  | "lock"
  | "unlock"
  | "front"
  | "forward"
  | "backward"
  | "back"
  | "left"
  | "right"
  | "up"
  | "down";

export type EditorCommand = PresentationAction & { id: CommandId };
type Handler = (amount?: number) => void;
const definitions: Record<CommandId, [string, string?]> = {
  save: ["保存文稿", "Ctrl/⌘ S"],
  undo: ["撤销", "Ctrl/⌘ Z"],
  redo: ["重做", "Ctrl/⌘ Shift Z"],
  duplicate: ["复制所选元素", "Ctrl/⌘ D"],
  remove: ["删除所选元素", "Delete"],
  selectAll: ["全选元素", "Ctrl/⌘ A"],
  lock: ["锁定所选元素"],
  unlock: ["解锁所选元素"],
  front: ["置于顶层"],
  forward: ["上移一层"],
  backward: ["下移一层"],
  back: ["置于底层"],
  left: ["向左微调", "←"],
  right: ["向右微调", "→"],
  up: ["向上微调", "↑"],
  down: ["向下微调", "↓"],
};

/** Every command checks the same current permissions, including non-menu callers. */
export function editorCommands({
  readOnly,
  blocked,
  selected,
  movable,
  canUndo,
  canRedo,
  handlers,
}: {
  readOnly: boolean;
  blocked: boolean;
  selected: number;
  movable: number;
  canUndo: boolean;
  canRedo: boolean;
  handlers: Record<CommandId, Handler>;
}) {
  const get = (id: CommandId): EditorCommand => {
    const requiresSelection = !["save", "undo", "redo", "selectAll"].includes(
      id,
    );
    const reason = readOnly
      ? "文稿为只读"
      : blocked
        ? "请先结束当前操作"
        : id === "undo" && !canUndo
          ? "没有可撤销的操作"
          : id === "redo" && !canRedo
            ? "没有可重做的操作"
            : requiresSelection && !selected
              ? "请先选择元素"
              : requiresSelection && id !== "unlock" && !movable
                ? "请先解锁元素"
                : undefined;
    return {
      id,
      label: definitions[id][0],
      shortcut: definitions[id][1],
      disabled: !!reason,
      description: reason,
      danger: id === "remove",
      onSelect: () => {
        if (!reason) handlers[id]();
      },
    };
  };
  return {
    get,
    run: (id: CommandId, amount?: number) => {
      if (!get(id).disabled) handlers[id](amount);
    },
  };
}
