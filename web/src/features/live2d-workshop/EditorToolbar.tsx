import { useRef } from "react";
import {
  ArrowLeft,
  Check,
  Download,
  Layers3,
  Network,
  PanelLeft,
  PanelRight,
  Play,
  Redo2,
  Save,
  Undo2,
  Upload,
} from "lucide-react";
import { AMADEUS_PACKAGE_URL } from "@shared/live2d/bundled";
import { importProject } from "./api";
import type { CharacterDocument, Mode } from "./types";

export function EditorToolbar({
  title,
  mode,
  onMode,
  readOnly,
  saving,
  dirty,
  busy,
  conflict,
  error,
  onError,
  builtIn,
  inheritedReadOnly,
  onBack,
  onRequestLeave,
  leftOpen,
  onLeftOpen,
  rightOpen,
  onRightOpen,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  historyTick,
  onImport,
  onCancelImport,
  onSave,
  localDocument,
  onRequestReload,
}: {
  title: string;
  mode: Mode;
  onMode: (mode: Mode) => void;
  readOnly: boolean;
  saving: boolean;
  dirty: boolean;
  busy: boolean;
  conflict: boolean;
  error: string;
  onError: (value: string) => void;
  builtIn: boolean;
  inheritedReadOnly: boolean;
  onBack: () => void;
  onRequestLeave: () => void;
  leftOpen: boolean;
  onLeftOpen: () => void;
  rightOpen: boolean;
  onRightOpen: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: (redo?: boolean) => void;
  onRedo: () => void;
  historyTick: number;
  onImport: (files: File[]) => void;
  onCancelImport: () => void;
  onSave: () => void;
  localDocument: CharacterDocument;
  onRequestReload: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const backup = () => {
    const blob = new Blob([JSON.stringify(localDocument, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "character-local-changes.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copyBuiltIn = async () => {
    try {
      const response = await fetch(AMADEUS_PACKAGE_URL);
      if (!response.ok) throw new Error("内置工程包无法读取");
      await importProject(
        new File([await response.blob()], "amadeus.fpllive2d", {
          type: "application/zip",
        }),
      );
      onBack();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "复制失败");
    }
  };
  return (
    <>
      <header className="l2-editor-header">
        <button
          aria-label="返回项目"
          onClick={dirty || busy ? onRequestLeave : onBack}
        >
          <ArrowLeft size={18} />
        </button>
        <div className="l2-title">
          <strong>{title}</strong>
          <small>
            {readOnly
              ? "只读浏览"
              : saving
                ? "正在保存…"
                : dirty
                  ? "有未保存修改"
                  : "已保存"}{" "}
            · FPL 原生角色工程
          </small>
        </div>
        <nav>
          {(
            [
              { id: "model", label: "模型", icon: Layers3 },
              { id: "rig", label: "绑定", icon: Network },
              { id: "animation", label: "动画", icon: Play },
              { id: "export", label: "交付", icon: Download },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              aria-pressed={mode === tab.id}
              onClick={() => onMode(tab.id)}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="l2-header-actions">
          {builtIn && !inheritedReadOnly && (
            <button onClick={() => void copyBuiltIn()}>创建可编辑副本</button>
          )}
          <button
            aria-label="对象面板"
            aria-pressed={leftOpen}
            onClick={onLeftOpen}
          >
            <PanelLeft size={16} />
          </button>
          <button
            aria-label="属性面板"
            aria-pressed={rightOpen}
            onClick={onRightOpen}
          >
            <PanelRight size={16} />
          </button>
          <button
            aria-label="撤销"
            disabled={readOnly || !canUndo}
            onClick={() => onUndo()}
            data-history={historyTick}
          >
            <Undo2 size={16} />
          </button>
          <button
            aria-label="重做"
            disabled={readOnly || !canRedo}
            onClick={onRedo}
          >
            <Redo2 size={16} />
          </button>
          <button
            disabled={readOnly || busy}
            onClick={() => input.current?.click()}
          >
            <Upload size={16} />
            <span>导入素材</span>
          </button>
          <button
            className="l2-primary"
            disabled={readOnly || saving || conflict || busy}
            onClick={onSave}
          >
            {dirty ? <Save size={16} /> : <Check size={16} />}保存
          </button>
        </div>
      </header>
      <input
        type="file"
        ref={input}
        hidden
        multiple
        accept=".png,.psd"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) onImport(files);
        }}
      />
      {busy && (
        <div className="l2-notice">
          正在检查并导入分层素材…<button onClick={onCancelImport}>取消</button>
        </div>
      )}
      {error && (
        <div className="l2-error" role="alert">
          <span>{error}</span>
          <button onClick={() => onError("")}>关闭提示</button>
        </div>
      )}
      {conflict && (
        <div className="l2-notice">
          本地修改已保留。
          <button onClick={backup}>下载本地文档备份</button>
          <button onClick={onRequestReload}>重新读取服务器版本</button>
        </div>
      )}
    </>
  );
}
