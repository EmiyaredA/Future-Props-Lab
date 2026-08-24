import { GlobalStorySearch } from "./GlobalStorySearch";
import { RouteReportDialog } from "./RouteReport";
import { WORKSPACES } from "./editorWorkspaceModules";
import type { ReadyEditorPageViewModel } from "./editorViewModel";

export function GalgameEditorStatusAndSearch({
  model,
}: {
  model: ReadyEditorPageViewModel;
}) {
  const {
    chapter,
    commandOpen,
    document,
    locateIssue,
    locateRoute,
    locateSearchTarget,
    report,
    reportIssueCount,
    reportOpen,
    reportQuery,
    reportRefreshing,
    saveState,
    savedDocument,
    selectedFragment,
    setCommandOpen,
    setReportOpen,
    workspace,
  } = model;
  return (
    <>
      <footer className="galgame-editor-statusbar">
        <span className={saveState}>
          <i />
          自动保存
          {saveState === "saved"
            ? "已开启"
            : saveState === "saving"
              ? "中"
              : "需处理"}
        </span>
        <span>
          {WORKSPACES.find((item) => item.id === workspace)?.label}
          {workspace === "script"
            ? ` / ${chapter.title} / ${selectedFragment?.title ?? ""}`
            : ""}
        </span>
        <span className={reportIssueCount ? "warning" : "healthy"}>
          {reportIssueCount ? `${reportIssueCount} 个线路问题` : "线路正常"}
        </span>
        <a
          href="https://docs.avg-engine.com/manual/overview/editor"
          target="_blank"
          rel="noreferrer"
        >
          帮助文档
        </a>
        <span>Story {document.schemaVersion}</span>
      </footer>
      <GlobalStorySearch
        open={commandOpen}
        document={document}
        onClose={() => setCommandOpen(false)}
        onSelect={locateSearchTarget}
      />

      <RouteReportDialog
        open={reportOpen}
        report={report}
        document={savedDocument}
        error={reportQuery.error}
        refreshing={reportRefreshing}
        saving={saveState === "saving"}
        onClose={() => setReportOpen(false)}
        onIssue={(issue) => {
          setReportOpen(false);
          locateIssue(issue);
        }}
        onRoute={(route) => {
          setReportOpen(false);
          locateRoute(route);
        }}
        onRefresh={() => void reportQuery.refetch()}
      />
    </>
  );
}
