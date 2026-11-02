import { LoadingState } from "@shared/ui/LoadingState";
import { useEffect, useId, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  CircleAlert,
  GitBranch,
  RefreshCcw,
  X,
} from "lucide-react";
import type {
  GalgameStoryProject,
  GalgameStoryRouteReport,
} from "@features/galgame-workshop/api";

export type GalgameStoryReportIssue = GalgameStoryRouteReport["errors"][number];

export type StoryRoute = {
  chapterId: string;
  blockId: string;
  sourceId: string;
  source: string;
  targetId: string;
  target: string;
  choice: string;
};

type ReportSeverity = "clear" | "warning" | "blocked";
type ReportIssueEntry = {
  issue: GalgameStoryReportIssue;
  severity: "error" | "warning";
};

type ReportModel = {
  severity: ReportSeverity;
  reachable: number;
  fragments: number;
  endings: number;
  unreachable: number;
  openEnds: number;
  cycles: number;
  trappedCycles: number;
  routes: StoryRoute[];
  issues: ReportIssueEntry[];
  chapters: Array<{
    id: string;
    title: string;
    reachable: number;
    fragments: number;
    endings: number;
    cycles: number;
    severity: ReportSeverity;
  }>;
};

function reportSeverity(errors: number, warnings: number): ReportSeverity {
  if (errors) return "blocked";
  if (warnings) return "warning";
  return "clear";
}

function storyRoutes(document: GalgameStoryProject): StoryRoute[] {
  return (document.chapters ?? []).flatMap((chapter) =>
    (chapter.fragments ?? []).flatMap((fragment) =>
      (fragment.blocks ?? []).flatMap((block) =>
        block.type === "branch"
          ? block.choices.map((choice) => ({
              chapterId: chapter.id,
              blockId: block.id,
              sourceId: fragment.id,
              source: fragment.title,
              targetId: choice.targetFragmentId,
              target:
                chapter.fragments?.find(
                  (candidate) => candidate.id === choice.targetFragmentId,
                )?.title ?? choice.targetFragmentId,
              choice: choice.text,
            }))
          : [],
      ),
    ),
  );
}

function makeReportModel(
  report: GalgameStoryRouteReport,
  document: GalgameStoryProject,
): ReportModel {
  const issues: ReportIssueEntry[] = [
    ...report.errors.map((issue) => ({
      issue,
      severity: "error" as const,
    })),
    ...report.warnings.map((issue) => ({
      issue,
      severity: "warning" as const,
    })),
  ];
  const chaptersById = new Map(
    (document.chapters ?? []).map((chapter) => [chapter.id, chapter]),
  );
  const chapters = report.chapters.map((chapter) => {
    const errors = report.errors.filter(
      (issue) => issue.chapter_id === chapter.chapter_id,
    ).length;
    const warnings = report.warnings.filter(
      (issue) => issue.chapter_id === chapter.chapter_id,
    ).length;
    return {
      id: chapter.chapter_id,
      title: chaptersById.get(chapter.chapter_id)?.title ?? chapter.chapter_id,
      reachable: chapter.reachable_fragment_ids.length,
      fragments:
        chapter.reachable_fragment_ids.length +
        chapter.unreachable_fragment_ids.length,
      endings: chapter.ending_ids.length,
      cycles: chapter.cycles.length,
      severity: reportSeverity(errors, warnings),
    };
  });
  return {
    severity: reportSeverity(report.errors.length, report.warnings.length),
    reachable: chapters.reduce(
      (total, chapter) => total + chapter.reachable,
      0,
    ),
    fragments: chapters.reduce(
      (total, chapter) => total + chapter.fragments,
      0,
    ),
    endings: chapters.reduce((total, chapter) => total + chapter.endings, 0),
    unreachable: report.chapters.reduce(
      (total, chapter) => total + chapter.unreachable_fragment_ids.length,
      0,
    ),
    openEnds: report.errors.filter((issue) => issue.code === "open_fragment")
      .length,
    cycles: report.chapters.reduce(
      (total, chapter) => total + chapter.cycles.length,
      0,
    ),
    trappedCycles: report.errors.filter(
      (issue) => issue.code === "trapped_cycle",
    ).length,
    routes: storyRoutes(document),
    issues,
    chapters,
  };
}

function statusCopy(model: ReportModel) {
  if (model.severity === "blocked") {
    return {
      title: "线路尚未完成",
      copy: `${model.issues.filter((entry) => entry.severity === "error").length} 错误 · ${model.issues.filter((entry) => entry.severity === "warning").length} 警告`,
    };
  }
  if (model.severity === "warning") {
    return {
      title: "线路可玩，但存在警告",
      copy: `0 错误 · ${model.issues.length} 警告`,
    };
  }
  return {
    title: "线路检查通过",
    copy: "0 错误 · 0 警告",
  };
}

function canLocate(issue: GalgameStoryReportIssue) {
  return Boolean(issue.fragment_id || issue.block_id);
}

function QueryState({
  error,
  onRefresh,
}: {
  error?: unknown;
  onRefresh: () => void;
}) {
  return (
    <div className="galgame-report-query-state">
      {error ? (
        <CircleAlert aria-hidden />
      ) : (
        <RefreshCcw className="spinning" aria-hidden />
      )}
      <strong>
        {error ? (
          "线路报告暂时无法读取"
        ) : (
          <LoadingState variant="inline" label="正在检查已保存线路…" />
        )}
      </strong>
      {error ? (
        <button type="button" onClick={onRefresh}>
          <RefreshCcw aria-hidden /> 重试
        </button>
      ) : null}
    </div>
  );
}

export function RouteReportInspector({
  report,
  document,
  error,
  refreshing,
  saving,
  onIssue,
  onRoute,
  onOpen,
  onRefresh,
}: {
  report?: GalgameStoryRouteReport;
  document: GalgameStoryProject;
  error?: unknown;
  refreshing: boolean;
  saving: boolean;
  onIssue: (issue: GalgameStoryReportIssue) => void;
  onRoute: (route: StoryRoute) => void;
  onOpen: () => void;
  onRefresh: () => void;
}) {
  const model = useMemo(
    () => (report ? makeReportModel(report, document) : undefined),
    [document, report],
  );
  if (!report || !model)
    return <QueryState error={error} onRefresh={onRefresh} />;
  const status = statusCopy(model);
  return (
    <div className="galgame-inspector-report">
      <div className={`galgame-report-status ${model.severity}`}>
        {model.severity === "clear" ? (
          <CheckCircle2 aria-hidden />
        ) : (
          <CircleAlert aria-hidden />
        )}
        <span>
          <strong>{status.title}</strong>
          <small>{status.copy}</small>
        </span>
        {refreshing ? (
          <RefreshCcw className="spinning" aria-label="检查中" />
        ) : null}
      </div>
      <div className="galgame-inspector-metrics">
        <span>
          <strong>{model.reachable}</strong>
          <small>可达 Fragment</small>
        </span>
        <span>
          <strong>{model.endings}</strong>
          <small>结局</small>
        </span>
      </div>
      {model.routes.length ? (
        <section className="galgame-inspector-section">
          <header>
            <strong>分支线路</strong>
            <small>{model.routes.length} 条</small>
          </header>
          <ul className="galgame-route-list">
            {model.routes.map((route) => (
              <li
                key={`${route.chapterId}-${route.blockId}-${route.targetId}-${route.choice}`}
              >
                <span>
                  <strong>
                    {route.source} → {route.target}
                  </strong>
                  <small>{route.choice}</small>
                </span>
                <button type="button" onClick={() => onRoute(route)}>
                  定位
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {model.issues.length ? (
        <section className="galgame-inspector-section">
          <header>
            <strong>检查结果</strong>
            <small>{model.issues.length} 项</small>
          </header>
          <div className="galgame-inspector-issues">
            {model.issues.slice(0, 5).map(({ issue, severity }) => {
              const content = (
                <>
                  <CircleAlert aria-hidden />
                  <span>
                    <strong>{issue.message}</strong>
                    <small>{issue.path}</small>
                  </span>
                </>
              );
              return canLocate(issue) ? (
                <button
                  key={`${severity}-${issue.code}-${issue.path}`}
                  type="button"
                  className={`galgame-inspector-issue ${severity}`}
                  onClick={() => onIssue(issue)}
                >
                  {content}
                </button>
              ) : (
                <div
                  key={`${severity}-${issue.code}-${issue.path}`}
                  className={`galgame-inspector-issue ${severity}`}
                >
                  {content}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
      <p className="galgame-report-save-note">
        {saving ? (
          <LoadingState
            variant="inline"
            label="故事正在保存；完成后将自动更新检查结果。"
          />
        ) : (
          "检查基于最近一次保存的故事。"
        )}
      </p>
      <div className="galgame-report-actions">
        <button type="button" disabled={refreshing} onClick={onRefresh}>
          <RefreshCcw className={refreshing ? "spinning" : ""} aria-hidden />
          {refreshing ? "检查中…" : "重新检查"}
        </button>
        <button type="button" className="primary" onClick={onOpen}>
          查看完整报告
        </button>
      </div>
    </div>
  );
}

export function RouteReportDialog({
  open,
  report,
  document: story,
  error,
  refreshing,
  saving,
  onClose,
  onIssue,
  onRoute,
  onRefresh,
}: {
  open: boolean;
  report?: GalgameStoryRouteReport;
  document: GalgameStoryProject;
  error?: unknown;
  refreshing: boolean;
  saving: boolean;
  onClose: () => void;
  onIssue: (issue: GalgameStoryReportIssue) => void;
  onRoute: (route: StoryRoute) => void;
  onRefresh: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const model = useMemo(
    () => (report ? makeReportModel(report, story) : undefined),
    [report, story],
  );

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = window.document
      .activeElement as HTMLElement | null;
    const previousOverflow = window.document.body.style.overflow;
    const ownsScrollLock = previousOverflow !== "hidden";
    if (ownsScrollLock) window.document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    requestAnimationFrame(() => closeButton.current?.focus());
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (ownsScrollLock)
        window.document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;
  const status = model ? statusCopy(model) : undefined;
  return createPortal(
    <div
      className="galgame-route-report-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="galgame-route-report-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header>
          <div>
            <h2 id={titleId}>工程检查</h2>
            <p id={descriptionId}>
              {model && status ? (
                model.severity === "clear" ? (
                  `未发现线路问题。${model.reachable}/${model.fragments} 个 Fragment 可达，${model.endings} 个结局。`
                ) : (
                  status.copy
                )
              ) : (
                <LoadingState
                  variant="inline"
                  label="正在读取最近一次保存的线路报告。"
                />
              )}
            </p>
          </div>
          <button
            ref={closeButton}
            type="button"
            aria-label="关闭工程检查"
            onClick={onClose}
          >
            <X aria-hidden />
          </button>
        </header>
        <div className="galgame-route-report-meta">
          <span>检查范围</span>
          <strong>已保存故事</strong>
          <small>{refreshing ? "正在更新" : "刚刚完成"}</small>
        </div>
        <div className="galgame-route-report-content">
          {!report || !model ? (
            <QueryState error={error} onRefresh={onRefresh} />
          ) : (
            <>
              <section className="galgame-route-report-section">
                <header>
                  <span>
                    <strong>线路报告</strong>
                    <small>
                      {model.reachable}/{model.fragments} 可达 · {model.endings}{" "}
                      个结局
                    </small>
                  </span>
                  <em className={model.severity}>{status?.title}</em>
                </header>
                <div className="galgame-route-report-metrics">
                  <article>
                    <span>不可达</span>
                    <strong>{model.unreachable}</strong>
                  </article>
                  <article>
                    <span>开放断点</span>
                    <strong>{model.openEnds}</strong>
                  </article>
                  <article>
                    <span>循环 / 困住</span>
                    <strong>
                      {model.cycles} / {model.trappedCycles}
                    </strong>
                  </article>
                </div>
                <div className="galgame-route-report-chapters">
                  {model.chapters.map((chapter) => (
                    <div key={chapter.id}>
                      <span>
                        <strong>{chapter.title}</strong>
                        <small>
                          可达 {chapter.reachable}/{chapter.fragments} · 结局{" "}
                          {chapter.endings} · 循环 {chapter.cycles}
                        </small>
                      </span>
                      <em className={chapter.severity}>
                        {chapter.severity === "blocked"
                          ? "需修复"
                          : chapter.severity === "warning"
                            ? "有警告"
                            : "可玩"}
                      </em>
                    </div>
                  ))}
                </div>
              </section>

              {model.routes.length ? (
                <section className="galgame-route-report-section">
                  <header>
                    <span>
                      <strong>分支线路</strong>
                      <small>{model.routes.length} 条</small>
                    </span>
                  </header>
                  <ul className="galgame-route-report-routes">
                    {model.routes.map((route) => (
                      <li
                        key={`${route.chapterId}-${route.blockId}-${route.targetId}-${route.choice}`}
                      >
                        <GitBranch aria-hidden />
                        <span>
                          <strong>
                            {route.source} → {route.target}
                          </strong>
                          <small>{route.choice}</small>
                        </span>
                        <button type="button" onClick={() => onRoute(route)}>
                          定位
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="galgame-route-report-section">
                <header>
                  <span>
                    <strong>检查结果</strong>
                    <small>{model.issues.length} 项</small>
                  </span>
                </header>
                {model.issues.length ? (
                  <div className="galgame-route-report-issues">
                    {model.issues.map(({ issue, severity }) => (
                      <div
                        key={`${severity}-${issue.code}-${issue.path}`}
                        className={severity}
                      >
                        <CircleAlert aria-hidden />
                        <span>
                          <strong>{issue.message}</strong>
                          <small>{issue.path}</small>
                        </span>
                        <em>{severity === "error" ? "错误" : "警告"}</em>
                        {canLocate(issue) ? (
                          <button type="button" onClick={() => onIssue(issue)}>
                            定位
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="galgame-route-report-clear">
                    <CheckCircle2 aria-hidden />
                    <span>
                      <strong>没有发现错误或警告</strong>
                      <small>当前工程可以开始试玩。</small>
                    </span>
                    <em>通过</em>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
        <footer>
          <span>
            {saving ? (
              <LoadingState
                variant="inline"
                label="故事正在保存；完成后将自动更新检查结果"
              />
            ) : (
              "检查基于最近一次保存的故事"
            )}
          </span>
          <div>
            <button type="button" disabled={refreshing} onClick={onRefresh}>
              <RefreshCcw
                className={refreshing ? "spinning" : ""}
                aria-hidden
              />
              {refreshing ? "检查中…" : "重新检查"}
            </button>
            <button type="button" className="primary" onClick={onClose}>
              关闭
            </button>
          </div>
        </footer>
      </section>
    </div>,
    window.document.body,
  );
}
