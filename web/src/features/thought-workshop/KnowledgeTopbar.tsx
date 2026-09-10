import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  Check,
  CircleAlert,
  FileCode2,
  FileText,
  History,
  Info,
  ListTree,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { CustomSelect, type SelectOption } from "@shared/ui/CustomSelect";
import { useSelectPopover } from "@shared/ui/useSelectPopover";
import { historyTime } from "./historyApi";
import type { NoteEditorChrome } from "./noteEditorChrome";
import "./knowledge-topbar.css";

type NoteAction = {
  value: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
};

function NoteActionMenu({
  busy,
  chrome,
  hasProject,
  onAction,
}: {
  busy: boolean;
  chrome: NoteEditorChrome | null;
  hasProject: boolean;
  onAction: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  const menuId = useId();
  useSelectPopover(open, trigger, menu);

  const groups: NoteAction[][] = [
    [
      { value: "save", label: "保存", icon: Save, disabled: !chrome?.canSave },
      {
        value: "history",
        label: "历史记录",
        icon: History,
        disabled: !chrome?.canOpenHistory,
      },
      { value: "import", label: "导入", icon: Upload, disabled: busy },
    ],
    [
      {
        value: "export-html",
        label: "导出 HTML 离线阅读",
        icon: FileCode2,
        disabled: !chrome,
      },
      {
        value: "export-markdown",
        label: "导出 Markdown",
        icon: FileText,
        disabled: !chrome,
      },
    ],
    [
      {
        value: "rename",
        label: "重命名",
        icon: Pencil,
        disabled: !hasProject,
      },
      {
        value: "description",
        label: "修改简介",
        icon: Info,
        disabled: !hasProject,
      },
    ],
  ];

  const enabledItems = () =>
    Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  const show = (last = false) => {
    focusLast.current = last;
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const items = enabledItems();
    (focusLast.current ? items.at(-1) : items[0])?.focus();
    const closeOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target))
        close();
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [open]);

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = enabledItems();
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | undefined;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    if (event.key === "ArrowUp")
      next = (current - 1 + items.length) % items.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = items.length - 1;
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (next === undefined) return;
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <div className="knowledge-note-actions">
      <button
        ref={trigger}
        type="button"
        className="btn knowledge-note-action-trigger"
        aria-label="笔记更多操作"
        title="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          show(event.key === "ArrowUp");
        }}
      >
        <MoreHorizontal aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={menu}
          id={menuId}
          popover="manual"
          role="menu"
          aria-label="笔记更多操作"
          className="knowledge-note-action-menu"
          onKeyDown={moveFocus}
        >
          {groups.map((group, groupIndex) => (
            <div key={group[0]!.value} role="presentation">
              {groupIndex > 0 ? (
                <div
                  className="knowledge-note-action-divider"
                  role="separator"
                />
              ) : null}
              {group.map((action) => (
                <button
                  key={action.value}
                  type="button"
                  role="menuitem"
                  disabled={action.disabled}
                  onClick={() => {
                    close(true);
                    onAction(action.value);
                  }}
                >
                  <action.icon aria-hidden="true" />
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function KnowledgeTopbar({
  noteMode,
  busy,
  projectTitle,
  currentLabel,
  noteChrome,
  projectOptions,
  onOpenKnowledge,
  onOpenProject,
  onOpenDirectory,
  onImport,
  onCreateDocument,
  onBackup,
  onCreateKnowledge,
  onNoteAction,
  onProjectAction,
}: {
  noteMode: boolean;
  busy: boolean;
  projectTitle?: string;
  currentLabel: string;
  noteChrome: NoteEditorChrome | null;
  projectOptions: SelectOption[];
  onOpenKnowledge: () => void;
  onOpenProject: () => void;
  onOpenDirectory: () => void;
  onImport: () => void;
  onCreateDocument: () => void;
  onBackup: () => void;
  onCreateKnowledge: () => void;
  onNoteAction: (value: string) => void;
  onProjectAction: (value: string) => void;
}) {
  return (
    <header className={`knowledge-topbar${noteMode ? " is-note" : ""}`}>
      {!noteMode ? (
        <button className="btn knowledge-mobile" onClick={onOpenDirectory}>
          目录
        </button>
      ) : null}
      <div className="knowledge-topbar-start">
        <div className="knowledge-breadcrumb">
          <button onClick={onOpenKnowledge}>知识库</button>
          {projectTitle ? (
            <>
              <span aria-hidden="true">/</span>
              <button onClick={onOpenProject}>{projectTitle}</button>
              <span aria-hidden="true">/</span>
              <span>{currentLabel}</span>
            </>
          ) : null}
        </div>
        {noteMode ? (
          <>
            <span className="knowledge-topbar-divider" aria-hidden="true" />
            <button
              className="btn thought-directory-toggle"
              onClick={onOpenDirectory}
            >
              <ListTree size={17} aria-hidden="true" /> 笔记目录
            </button>
            <span className="knowledge-topbar-divider" aria-hidden="true" />
            {noteChrome ? (
              <span
                role="status"
                className={`thought-save-state is-${noteChrome.state}`}
              >
                {noteChrome.state === "saved" ? (
                  <Check size={15} aria-hidden="true" />
                ) : noteChrome.state === "saving" ? (
                  <LoaderCircle size={15} aria-hidden="true" />
                ) : (
                  <CircleAlert size={15} aria-hidden="true" />
                )}
                <span>
                  {
                    {
                      saved: "已保存",
                      dirty: "待保存",
                      saving: "保存中…",
                      error: "保存失败",
                      conflict: "保存冲突",
                    }[noteChrome.state]
                  }
                </span>
                {noteChrome.state === "saved" ? (
                  <> · {historyTime(noteChrome.savedAt)}</>
                ) : null}
              </span>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="knowledge-top-actions">
        {noteMode ? (
          <>
            <NoteActionMenu
              busy={busy}
              chrome={noteChrome}
              hasProject={!!projectTitle}
              onAction={onNoteAction}
            />
            <button className="btn" disabled={busy} onClick={onCreateDocument}>
              <Plus size={16} aria-hidden="true" />
              新建文档
            </button>
            <button
              className="btn primary thought-ai-toggle"
              aria-pressed={noteChrome?.assistant ?? false}
              disabled={!noteChrome}
              onClick={() => noteChrome?.setAssistant(!noteChrome.assistant)}
            >
              <Sparkles size={16} aria-hidden="true" /> AI 写作
            </button>
          </>
        ) : (
          <>
            <button className="btn" disabled={busy} onClick={onImport}>
              导入
            </button>
            {projectTitle ? (
              <>
                <CustomSelect
                  ariaLabel="知识库更多操作"
                  value=""
                  options={projectOptions}
                  onChange={onProjectAction}
                />
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={onCreateDocument}
                >
                  <Plus size={16} aria-hidden="true" />
                  新建文档
                </button>
              </>
            ) : (
              <>
                <button className="btn" onClick={onBackup}>
                  完整备份
                </button>
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={onCreateKnowledge}
                >
                  <Plus size={16} aria-hidden="true" />
                  创建知识库
                </button>
              </>
            )}
          </>
        )}
      </div>
    </header>
  );
}
