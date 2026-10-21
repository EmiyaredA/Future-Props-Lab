import {
  ChevronDown,
  Code2,
  Sigma,
  Copy,
  Ellipsis,
  Workflow,
  FolderOpen,
  ImagePlus,
  Plus,
  Redo2,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { PresentationMenu, type PresentationAction } from "./PresentationMenu";
import { PresentationShapePicker } from "./PresentationShapePicker";
import { layouts } from "./templates";
import type { SlideElement } from "./types";

export function PresentationToolbar({
  readOnly,
  canAdd,
  canUndo,
  canRedo,
  busy,
  hasSelection,
  onAdd,
  onUndo,
  onRedo,
  onText,
  onCode,
  onFormula,
  onShape,
  onIcon,
  onSvg,
  onUpload,
  onLibrary,
  onCopy,
  onDelete,
  infoAction,
  sceneActions = [],
}: {
  readOnly: boolean;
  canAdd: boolean;
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
  hasSelection: boolean;
  onAdd: (layout: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onText: () => void;
  onCode?: () => void;
  onFormula?: () => void;
  onShape: (kind: SlideElement["kind"], patch?: Partial<SlideElement>) => void;
  onIcon?: (svg: string, name: string) => void;
  onSvg?: () => void;
  onUpload: () => void;
  onLibrary: () => void;
  onCopy: () => void;
  onDelete: () => void;
  infoAction?: PresentationAction;
  sceneActions?: PresentationAction[];
}) {
  if (readOnly) return null;
  return (
    <div
      className="presentation-toolbar"
      role="toolbar"
      aria-label="幻灯片工具栏"
    >
      {window.futurePropsDesktop?.openAmadeus && (
        <button
          className="btn"
          onClick={() => void window.futurePropsDesktop?.openAmadeus?.()}
        >
          ✦ Amadeus
        </button>
      )}
      <div className="presentation-toolbar-group presentation-split-button">
        <button
          className="btn"
          disabled={!canAdd}
          onClick={() => onAdd("blank")}
        >
          <Plus size={17} />
          新建幻灯片
        </button>
        <PresentationMenu
          label="新幻灯片版式"
          disabled={!canAdd}
          actions={layouts.map(({ value, label }) => ({
            label,
            onSelect: () => onAdd(value),
          }))}
        >
          <ChevronDown size={15} />
        </PresentationMenu>
      </div>
      <div className="presentation-toolbar-group">
        <button
          className="icon-btn"
          aria-label="撤销"
          title="撤销（Ctrl/Cmd+Z）"
          aria-keyshortcuts="Control+z Meta+z"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 size={18} />
        </button>
        <button
          className="icon-btn"
          aria-label="重做"
          title="重做（Ctrl/Cmd+Shift+Z 或 Ctrl+Y）"
          aria-keyshortcuts="Control+Shift+z Meta+Shift+z Control+y Meta+y"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Redo2 size={18} />
        </button>
      </div>
      <div className="presentation-toolbar-group">
        <button className="btn" onClick={onText}>
          <Type size={19} />
          文本
        </button>
        {onCode && (
          <button className="btn" onClick={onCode}>
            <Code2 size={18} />
            代码块
          </button>
        )}
        {onFormula && (
          <button className="btn" onClick={onFormula}>
            <Sigma size={18} />
            公式
          </button>
        )}
        <PresentationShapePicker
          onShape={onShape}
          onIcon={onIcon ?? (() => {})}
          onSvg={onSvg ?? onUpload}
        />
        <button
          className="btn"
          aria-label="上传图片"
          disabled={busy}
          onClick={onUpload}
        >
          <ImagePlus size={18} />
          图片
        </button>
        <button className="btn" onClick={onLibrary}>
          <FolderOpen size={18} />
          文件库
        </button>
      </div>
      <div className="presentation-toolbar-group">
        {infoAction && (
          <button
            className="btn"
            disabled={infoAction.disabled}
            onClick={infoAction.onSelect}
          >
            <Workflow size={18} />
            {infoAction.label}
          </button>
        )}
        <PresentationMenu
          label="更多编辑工具"
          actions={[
            ...sceneActions,
            {
              label: "复制所选元素",
              icon: <Copy size={16} />,
              disabled: !hasSelection,
              onSelect: onCopy,
            },
            {
              label: "删除所选元素",
              icon: <Trash2 size={16} />,
              disabled: !hasSelection,
              danger: true,
              onSelect: onDelete,
            },
          ]}
        >
          <Ellipsis size={18} />
          更多
          <ChevronDown size={14} />
        </PresentationMenu>
      </div>
    </div>
  );
}
