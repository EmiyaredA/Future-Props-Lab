import { WorkshopAppChrome } from "@shared/ui/WorkshopAppChrome";
import { LoadingScene } from "@shared/ui/LoadingScene";
import { AmadeusButton } from "@platform/AmadeusButton";
import { Fragment, type ReactNode, type Ref } from "react";
import {
  BookOpen,
  Check,
  CircleAlert,
  Download,
  FileCode2,
  FileText,
  History,
  Image as ImageIcon,
  Info,
  ListTree,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { KnowledgeActionMenu, type TopbarAction } from "./KnowledgeActionMenu";
import { historyTime } from "./historyApi";
import type { NoteEditorChrome } from "./noteEditorChrome";
import type { NoteSummary } from "./api";
import "./knowledge-topbar.css";

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
      { value: "library-html", label: "导出整库 HTML", icon: FileCode2 },
      { value: "copy", label: "复制文档 / 子树", icon: FileText },
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
    <KnowledgeActionMenu
      ariaLabel="笔记更多操作"
      groups={groups}
      onAction={onAction}
    />
  );
}

function ProjectActionMenu({
  canPublish,
  busy,
  onImport,
  onAction,
}: {
  canPublish?: boolean;
  busy: boolean;
  onImport: () => void;
  onAction: (value: string) => void;
}) {
  const groups: TopbarAction[][] = [
    [
      { value: "import", label: "导入", icon: Upload, disabled: busy },
      { value: "export", label: "备份知识库", icon: Download },
      { value: "library-html", label: "导出整库 HTML", icon: FileCode2 },
      ...(canPublish
        ? [{ value: "publish", label: "发布到知识社区", icon: BookOpen }]
        : []),
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
    <KnowledgeActionMenu
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
  showAssistant = true,
  reading,
  canPublish,
  onToggleReading,
  onExternalSync,
  busy,
  projectTitle,
  libraryTitle,
  librarySearch,
  utilityBar,
  currentLabel,
  currentId,
  documents,
  noteChrome,
  onOpenProject,
  onOpenDocument,
  onOpenDirectory,
  onImport,
  onCreateDocument,
  onTemplates,
  onBackup,
  onCreateKnowledge,
  onNoteAction,
  onProjectAction,
  documentToolsRef,
}: {
  noteMode: boolean;
  showAssistant?: boolean;
  canPublish?: boolean;
  reading?: boolean;
  onToggleReading?: () => void;
  onExternalSync?: () => void;
  busy: boolean;
  projectTitle?: string;
  libraryTitle?: string;
  librarySearch?: ReactNode;
  utilityBar?: ReactNode;
  currentLabel: string;
  currentId?: string;
  documents: NoteSummary[];
  noteChrome: NoteEditorChrome | null;
  onOpenProject: () => void;
  onOpenDocument: (id: string) => void;
  onOpenDirectory: () => void;
  onImport: () => void;
  onCreateDocument: (kind?: "note" | "multitable") => void;
  onTemplates?: () => void;
  onBackup: () => void;
  onCreateKnowledge: () => void;
  onNoteAction: (value: string) => void;
  onProjectAction: (value: string) => void;
  documentToolsRef?: Ref<HTMLDivElement>;
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
  const libraryMode = !noteMode && !projectTitle && !!libraryTitle;
  const directoryButton = (
    <button className="btn knowledge-mobile" onClick={onOpenDirectory}>
      目录
    </button>
  );
  const libraryActions = (
    <>
      <KnowledgeActionMenu
        ariaLabel="知识库列表更多操作"
        groups={[
          [
            {
              value: "import",
              label: "导入知识库",
              icon: Upload,
              disabled: busy,
            },
            { value: "backup", label: "完整备份", icon: Download },
          ],
        ]}
        onAction={(value) => (value === "import" ? onImport() : onBackup())}
      />
      <button
        className="btn primary"
        disabled={busy}
        onClick={onCreateKnowledge}
      >
        <Plus size={16} aria-hidden="true" />
        创建知识库
      </button>
    </>
  );
  if (libraryMode && utilityBar) {
    return (
      <WorkshopAppChrome
        className="knowledge-library-toolbar"
        title={libraryTitle}
        utilities={utilityBar}
        actions={
          <>
            {directoryButton}
            {librarySearch}
            {libraryActions}
          </>
        }
      />
    );
  }
  return (
    <header
      className={`knowledge-topbar${noteMode ? " is-note" : projectTitle ? " is-project" : libraryMode ? " is-library" : ""}`}
    >
      {!noteMode ? directoryButton : null}
      <div className="knowledge-topbar-start">
        {libraryMode ? (
          <div className="knowledge-topbar-copy">
            <h1>{libraryTitle}</h1>
          </div>
        ) : null}
        {noteMode ? (
          <>
            <nav
              className="knowledge-breadcrumb"
              aria-label="文档路径"
              onFocus={({ currentTarget, target }) => {
                const path = currentTarget.getBoundingClientRect();
                const item = target.getBoundingClientRect();
                if (item.left < path.left) {
                  currentTarget.scrollLeft += item.left - path.left;
                } else if (item.right > path.right) {
                  currentTarget.scrollLeft += item.right - path.right;
                }
              }}
            >
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
            {noteMode && (
              <button
                className="btn thought-directory-toggle knowledge-mobile"
                onClick={onOpenDirectory}
              >
                <ListTree size={17} aria-hidden="true" /> 笔记目录
              </button>
            )}
            {noteChrome ? (
              <span
                role="status"
                className={`thought-save-state is-${noteChrome.state}`}
              >
                {noteChrome.state === "saved" ? (
                  <Check size={15} aria-hidden="true" />
                ) : noteChrome.state === "saving" ? (
                  <LoadingScene />
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
        {noteMode && onExternalSync && (
          <button className="btn" onClick={onExternalSync}>
            同步到…
          </button>
        )}
        <div className="knowledge-document-tools" ref={documentToolsRef} />
        {showAssistant && <AmadeusButton className="btn" />}
        {onToggleReading && (
          <button className="btn" onClick={onToggleReading}>
            {reading ? "编辑文档" : "返回阅读"}
          </button>
        )}
        {noteMode ? (
          <>
            <NoteActionMenu
              busy={busy}
              chrome={noteChrome}
              hasProject={!!projectTitle}
              onAction={onNoteAction}
            />
            <KnowledgeActionMenu
              ariaLabel="新建文档"
              label="新建文档"
              disabled={!projectTitle}
              groups={[
                [
                  { value: "blank", label: "空白文档", icon: FileText },
                  { value: "multitable", label: "多维表格", icon: ListTree },
                  { value: "template", label: "从模板新建", icon: FileCode2 },
                ],
              ]}
              onAction={(value) =>
                value === "template"
                  ? onTemplates?.()
                  : onCreateDocument(
                      value === "multitable" ? "multitable" : "note",
                    )
              }
            />
          </>
        ) : (
          <>
            {projectTitle ? (
              <>
                <ProjectActionMenu
                  canPublish={canPublish}
                  busy={busy}
                  onImport={onImport}
                  onAction={onProjectAction}
                />
                <KnowledgeActionMenu
                  ariaLabel="新建文档"
                  label="新建文档"
                  groups={[
                    [
                      { value: "blank", label: "空白文档", icon: FileText },
                      {
                        value: "multitable",
                        label: "多维表格",
                        icon: ListTree,
                      },
                      {
                        value: "template",
                        label: "从模板新建",
                        icon: FileCode2,
                      },
                    ],
                  ]}
                  onAction={(value) =>
                    value === "template"
                      ? onTemplates?.()
                      : onCreateDocument(
                          value === "multitable" ? "multitable" : "note",
                        )
                  }
                />
              </>
            ) : (
              <>
                {librarySearch}
                {libraryActions}
              </>
            )}
          </>
        )}
      </div>
    </header>
  );
}
