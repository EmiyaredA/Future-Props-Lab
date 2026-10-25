import { DocumentTemplateButton } from "../master/DocumentTemplatePanel";
import {
  ArrowLeft,
  ChevronDown,
  Play,
  Download,
  Save,
  Presentation,
} from "lucide-react";
import { PresentationMenu } from "../PresentationMenu";
import type { PresentationSession } from "./usePresentationSession";
import type { ExportFormat } from "../exchange/ExportDialog";
export function EditorHeader({
  session,
  readOnly,
  onBack,
}: {
  session: PresentationSession;
  readOnly: boolean;
  onBack: () => void;
}) {
  const {
    titleDraft,
    draft,
    setTitleDraft,
    commit,
    cropSession,
    report,
    startShow,
    slideIndex,
    busy,
    exportNow,
  } = session;
  return (
    <header className="presentation-topbar">
      <button className="icon-btn" aria-label="返回文稿列表" onClick={onBack}>
        <ArrowLeft size={20} />
      </button>

      <Presentation size={22} className="presentation-mark" />
      <span className="presentation-editor-brand">
        演示工坊 <span>/</span>
      </span>
      <input
        aria-label="文稿名称"
        maxLength={120}
        value={titleDraft ?? draft.draft.title}
        readOnly={readOnly}
        onFocus={() => {
          if (!readOnly) setTitleDraft(draft.draft.title);
        }}
        onChange={(event) => {
          const next = event.target.value;
          setTitleDraft(next);
          if (next.trim() && next !== draft.draft.title)
            commit((current) => ({ ...current, title: next }), "title");
        }}
        onBlur={() => setTitleDraft(null)}
      />
      <span className={`presentation-save-state ${draft.state}`} role="status">
        {readOnly
          ? "只读"
          : {
              saved: "已保存",
              dirty: "待保存",
              saving: "正在保存…",
              error: "保存失败",
              conflict: "版本冲突",
            }[draft.state]}
      </span>
      <div className="presentation-topbar-actions">
        <DocumentTemplateButton session={session} readOnly={readOnly} />
        <button
          className="btn"
          aria-label="查找与替换"
          title="查找与替换（Ctrl/⌘ F）"
          onClick={() => session.setSearchOpen(true)}
        >
          查找
        </button>
        {!readOnly ? (
          <button
            className="btn"
            aria-label="保存文稿"
            disabled={!!cropSession}
            onClick={() =>
              void report(async () => {
                await draft.flush();
              })
            }
          >
            <Save size={16} />
            <span>保存</span>
          </button>
        ) : null}
        <div className="presentation-split-button presentation-show-button">
          <button
            className="btn"
            aria-label="从头放映"
            disabled={!!cropSession}
            onClick={() => startShow(0)}
          >
            <Play size={16} />
            <span>放映</span>
          </button>
          <PresentationMenu
            label="放映选项"
            disabled={!!cropSession}
            actions={[
              {
                label: "从当前页放映",
                onSelect: () => startShow(slideIndex),
              },
            ]}
          >
            <ChevronDown size={14} />
          </PresentationMenu>
        </div>
        <button
          className="btn primary"
          disabled={busy || !!cropSession}
          onClick={() => void exportNow()}
        >
          <Download size={16} />
          <span>{busy ? "正在导出…" : "导出 PPTX"}</span>
        </button>
        <PresentationMenu
          label="导出选项"
          disabled={busy || !!cropSession}
          actions={(
            ["pptx", "fplppt", "json", "png", "jpeg", "pdf"] as ExportFormat[]
          ).map((format) => ({
            label:
              format === "fplppt"
                ? "可编辑文稿包"
                : `导出 ${format.toUpperCase()} 文件`,
            onSelect: () => session.setExportFormat(format),
          }))}
        >
          <ChevronDown size={14} />
        </PresentationMenu>
      </div>
    </header>
  );
}
