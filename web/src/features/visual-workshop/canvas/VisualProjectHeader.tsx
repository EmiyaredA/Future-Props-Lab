import {
  ProjectCreativeTools,
  type CreativeToolActions,
  type CreativeTool,
  type ProjectWorkspace,
} from "../ProjectCreativeTools";
import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { AmadeusButton } from "@platform/AmadeusButton";
import { AppWindow, ArrowLeft, Pencil, Sun, Moon } from "lucide-react";
import { useTheme } from "@shared/ui/theme";
import { BoardMenu } from "../board/BoardMenu";

export type VisualProjectHeaderProps = CreativeToolActions & {
  activeView?: "canvas" | "board";
  activeTool?: CreativeTool;
  workspace?: ProjectWorkspace;
  hideCreativeTools?: boolean;
  onCanvas?: () => void;
  busy?: boolean;
  onBoard?: () => void;
  projectTitle: string;
  title: string;
  editingTitle: boolean;
  saveStateText?: string;
  saveState: "saving" | "saved" | "conflict" | "error";
  onBack: () => void;
  onStartTitleEditing: () => void;
  onTitleChange: (title: string) => void;
  onSubmitTitle: () => void;
  onBlurTitle: () => void;
};

export function VisualProjectHeader({
  onWorkbench,
  onCanvas,
  onPrevis,
  onScript,
  activeTool,
  workspace,
  hideCreativeTools = false,
  projectTitle,
  title,
  editingTitle,
  saveState,
  saveStateText,
  onBack,
  onStartTitleEditing,
  onTitleChange,
  onSubmitTitle,
  onBlurTitle,
  busy,
}: VisualProjectHeaderProps) {
  const [theme, setTheme] = useTheme();
  const status =
    saveStateText ??
    {
      saved: "已保存",
      saving: "保存中",
      conflict: "存在冲突",
      error: "保存失败",
    }[saveState];
  return (
    <header className="visual-project-header visual-canvas-topbar">
      <div className="project-header-identity">
        <button
          type="button"
          aria-label="返回项目列表"
          disabled={busy}
          onClick={onBack}
        >
          <ArrowLeft size={16} aria-hidden />
        </button>
        <ResponsiveImage
          className="project-header-brand"
          src="/brand/visual-workshop-mark-cutout.png"
          alt=""
        />
        {editingTitle ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSubmitTitle();
            }}
          >
            <input
              aria-label="项目名称"
              autoFocus
              maxLength={120}
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              onBlur={onBlurTitle}
            />
          </form>
        ) : (
          <button
            type="button"
            className="project-header-title"
            title={projectTitle}
            disabled={busy}
            onClick={onStartTitleEditing}
          >
            <span>{projectTitle}</span>
            <Pencil size={12} aria-hidden />
          </button>
        )}
        <span
          className={`canvas-save-state project-header-status ${saveState}`}
          role="status"
          title={status}
        >
          <span aria-hidden className="project-save-dot" />
          <span className="project-save-text">{status}</span>
        </span>
      </div>
      {!hideCreativeTools && (
        <ProjectCreativeTools
          active={workspace ?? activeTool ?? "workbench"}
          onWorkbench={onWorkbench ?? onCanvas}
          onScript={onScript}
          onPrevis={onPrevis}
          disabled={busy}
        />
      )}
      <div className="project-header-actions">
        <AmadeusButton className="project-header-assistant" />
        <button
          type="button"
          aria-label={theme === "dark" ? "切换浅色" : "切换深色"}
          title={theme === "dark" ? "切换浅色" : "切换深色"}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? (
            <Sun size={16} aria-hidden />
          ) : (
            <Moon size={16} aria-hidden />
          )}
        </button>
        <BoardMenu
          label="项目更多操作"
          items={[
            {
              label: "重命名项目",
              onSelect: onStartTitleEditing,
              disabled: busy,
            },
            {
              label: "新建窗口",
              icon: <AppWindow size={16} aria-hidden />,
              onSelect: () =>
                window.open(
                  window.location.href,
                  "_blank",
                  "noopener,noreferrer",
                ),
            },
            { label: "浅色", onSelect: () => setTheme("light") },
            { label: "深色", onSelect: () => setTheme("dark") },
          ]}
        />
      </div>
    </header>
  );
}
