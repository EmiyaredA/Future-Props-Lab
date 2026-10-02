import {
  ChevronDown,
  Copy,
  FolderOpen,
  ImagePlus,
  Plus,
  Redo2,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { PresentationMenu } from "./PresentationMenu";
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
  onShape,
  onIcon,
  onSvg,
  onUpload,
  onLibrary,
  onCopy,
  onDelete,
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
  onShape: (kind: SlideElement["kind"], patch?: Partial<SlideElement>) => void;
  onIcon?: (svg: string, name: string) => void;
  onSvg?: () => void;
  onUpload: () => void;
  onLibrary: () => void;
  onCopy: () => void;
  onDelete: () => void;
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
          title="撤销"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 size={18} />
        </button>
        <button
          className="icon-btn"
          aria-label="重做"
          title="重做"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Redo2 size={18} />
        </button>
      </div>
      <div className="presentation-toolbar-group presentation-desktop-control">
        <button className="btn" onClick={onText}>
          <Type size={19} />
          文本
        </button>
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
      <div className="presentation-toolbar-group presentation-desktop-control">
        <button
          className="icon-btn"
          aria-label="复制所选元素"
          title="复制所选元素"
          disabled={!hasSelection}
          onClick={onCopy}
        >
          <Copy size={17} />
        </button>
        <button
          className="icon-btn"
          aria-label="删除所选元素"
          title="删除所选元素"
          disabled={!hasSelection}
          onClick={onDelete}
        >
          <Trash2 size={17} />
        </button>
      </div>
    </div>
  );
}
