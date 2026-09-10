import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Check,
  CircleAlert,
  Download,
  FileCode2,
  FileText,
  History,
  Image as ImageIcon,
  Info,
  ListTree,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useSelectPopover } from "@shared/ui/useSelectPopover";
import { historyTime } from "./historyApi";
import type { NoteEditorChrome } from "./noteEditorChrome";
import type { NoteSummary } from "./api";
import "./knowledge-topbar.css";

type TopbarAction = {
  value: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  danger?: boolean;
};

function TopbarActionMenu({
  ariaLabel,
  groups,
  onAction,
}: {
  ariaLabel: string;
  groups: TopbarAction[][];
  onAction: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  const menuId = useId();
  useSelectPopover(open, trigger, menu, 360);

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
    <div className="knowledge-topbar-menu-wrap">
      <button
        ref={trigger}
        type="button"
        className="btn knowledge-topbar-menu-trigger"
        aria-label={ariaLabel}
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
          aria-label={ariaLabel}
          className="knowledge-topbar-menu"
          onKeyDown={moveFocus}
        >
          {groups.map((group, groupIndex) => (
            <div key={group[0]!.value} role="presentation">
              {groupIndex > 0 ? (
                <div
                  className="knowledge-topbar-menu-divider"
                  role="separator"
                />
              ) : null}
              {group.map((action) => (
                <button
                  key={action.value}
                  type="button"
                  role="menuitem"
                  className={action.danger ? "is-danger" : undefined}
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
  const groups: TopbarAction[][] = [
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
  return (
    <TopbarActionMenu
      ariaLabel="笔记更多操作"
      groups={groups}
      onAction={onAction}
    />
  );
}

function ProjectActionMenu({
  busy,
  onImport,
  onAction,
}: {
  busy: boolean;
  onImport: () => void;
  onAction: (value: string) => void;
}) {
  const groups: TopbarAction[][] = [
    [
      { value: "import", label: "导入", icon: Upload, disabled: busy },
      { value: "export", label: "导出知识库", icon: Download },
    ],
    [
      { value: "rename", label: "重命名", icon: Pencil },
      { value: "description", label: "修改简介", icon: Info },
      { value: "cover", label: "更换封面", icon: ImageIcon },
      { value: "clear-cover", label: "恢复默认封面", icon: RotateCcw },
    ],
    [
      {
        value: "trash",
        label: "移入回收站",
        icon: Trash2,
        danger: true,
      },
    ],
  ];
  return (
    <TopbarActionMenu
      ariaLabel="知识库更多操作"
      groups={groups}
      onAction={(value) => {
        if (value === "import") onImport();
        else onAction(value);
      }}
    />
  );
}

export function KnowledgeTopbar({
  noteMode,
  busy,
  projectTitle,
  currentLabel,
  currentId,
  documents,
  noteChrome,
  onOpenProject,
  onOpenDocument,
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
  currentId?: string;
  documents: NoteSummary[];
  noteChrome: NoteEditorChrome | null;
  onOpenProject: () => void;
  onOpenDocument: (id: string) => void;
  onOpenDirectory: () => void;
  onImport: () => void;
  onCreateDocument: () => void;
  onBackup: () => void;
  onCreateKnowledge: () => void;
  onNoteAction: (value: string) => void;
  onProjectAction: (value: string) => void;
}) {
  const ancestors: NoteSummary[] = [];
  if (noteMode && currentId) {
    const byId = new Map(documents.map((doc) => [doc.id, doc]));
    const seen = new Set([currentId]);
    let parentId = byId.get(currentId)?.parent_id;
    while (parentId && !seen.has(parentId)) {
      const parent = byId.get(parentId);
      if (!parent) break;
      ancestors.unshift(parent);
      seen.add(parentId);
      parentId = parent.parent_id;
    }
  }
  return (
    <header
      className={`knowledge-topbar${noteMode ? " is-note" : projectTitle ? " is-project" : ""}`}
    >
      {!noteMode ? (
        <button className="btn knowledge-mobile" onClick={onOpenDirectory}>
          目录
        </button>
      ) : null}
      <div className="knowledge-topbar-start">
        {noteMode ? (
          <>
            <nav className="knowledge-breadcrumb" aria-label="文档路径">
              {projectTitle ? (
                <>
                  <button title={projectTitle} onClick={onOpenProject}>
                    {projectTitle}
                  </button>
                  <span aria-hidden="true">/</span>
                </>
              ) : null}
              {ancestors.map((ancestor) => (
                <Fragment key={ancestor.id}>
                  <button
                    title={ancestor.title}
                    onClick={() => onOpenDocument(ancestor.id)}
                  >
                    {ancestor.title}
                  </button>
                  <span aria-hidden="true">/</span>
                </Fragment>
              ))}
              <span aria-current="page" title={currentLabel}>
                {currentLabel}
              </span>
            </nav>
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
            {projectTitle ? (
              <>
                <ProjectActionMenu
                  busy={busy}
                  onImport={onImport}
                  onAction={onProjectAction}
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
                <button className="btn" disabled={busy} onClick={onImport}>
                  导入
                </button>
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
