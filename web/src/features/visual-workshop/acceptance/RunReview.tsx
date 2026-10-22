import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, FilePenLine, RefreshCw } from "lucide-react";
import { visualWorkshopQueryKeys as keys } from "../queryKeys";
import {
  base,
  decide,
  getRun,
  methodNames,
  send,
  verdictNames,
  type DecisionInput,
  type Repair,
  type Run,
} from "./api";
import { EvidenceViewer } from "./EvidenceViewer";
import { CriterionDecision, type DecisionDraft } from "./CriterionDecision";
import { savedDecisionDraft } from "./reviewPresentation";
import { RecheckHistory } from "./RecheckHistory";
export function RunReview({
  projectId,
  run,
  onUpdate,
  onRepair,
  onRecheck,
  onAdopt,
  onOpenRun,
  onBack,
  onViewStandard,
  repairs,
  writable,
  busy,
  act,
}: {
  projectId: string;
  run: Run;
  onUpdate: (run: Run) => void;
  onRepair: (run: Run) => Promise<void>;
  onRecheck: (run: Run) => void;
  onAdopt: (run: Run) => Promise<void>;
  onOpenRun: (id: string) => void;
  onBack: () => void;
  onViewStandard: () => void;
  repairs: Readonly<Record<string, Repair>>;
  writable: boolean;
  busy: boolean;
  act: <T>(action: () => Promise<T>) => Promise<T | undefined>;
}) {
  const [selected, setSelected] = useState<string>();
  const [compactPane, setCompactPane] = useState("detail");
  const [drafts, setDrafts] = useState<
    Record<string, DecisionDraft | undefined>
  >({});
  const active =
    run.results.find((result) => result.criterion_id === selected) ??
    run.results.find((result) => result.verdict === "failed") ??
    run.results[0];
  const criterion = run.snapshot.criteria.find(
    (item) => item.id === active?.criterion_id,
  );
  const original = run.snapshot.check_results?.find(
    (item) => item.criterion_id === active?.criterion_id,
  );
  const humanDecision = [...run.decisions]
    .reverse()
    .find((item) => item.criterion_id === active?.criterion_id);
  const previous = useQuery({
    queryKey: keys.acceptanceRun(projectId, run.previous_run_id ?? ""),
    queryFn: () => getRun(projectId, run.previous_run_id!),
    enabled: !!run.previous_run_id,
  });
  const pending = run.results.filter(
      (item) => item.verdict === "pending",
    ).length,
    failed = run.results.filter((item) => item.verdict === "failed").length,
    passed = run.results.filter((item) => item.verdict === "passed").length;
  const running = run.status === "queued" || run.status === "processing";
  const manualIssues = run.results.some(
    (result) =>
      result.verdict === "failed" &&
      run.decisions.some(
        (item) =>
          item.criterion_id === result.criterion_id &&
          item.verdict === "failed",
      ),
  );
  const repairSource = manualIssues ? run : previous.data;
  const canRepair =
    !!repairSource &&
    repairSource.results.some(
      (result) =>
        result.verdict === "failed" &&
        repairSource.decisions.some(
          (item) =>
            item.criterion_id === result.criterion_id &&
            item.verdict === "failed",
        ),
    );
  const record = async (body: Omit<DecisionInput, "expected_revision">) => {
    const result = await act(() => decide(projectId, run, body));
    if (result) {
      onUpdate(result);
      if (body.criterion_id)
        setDrafts((values) => ({ ...values, [body.criterion_id!]: undefined }));
    }
  };
  const statusText =
    run.status === "completed"
      ? "检查完成"
      : run.status === "processing"
        ? "正在检查"
        : run.status === "queued"
          ? "排队中"
          : run.status === "failed"
            ? "检查失败"
            : "已取消";
  return (
    <>
      <div className="acceptance-run-heading">
        <div>
          <div className="acceptance-inline">
            <h2>{run.snapshot.output.title}</h2>
            {previous.data && (
              <span className="acceptance-badge neutral">
                v{previous.data.snapshot.output.version} → v
                {run.snapshot.output.version} 复验
              </span>
            )}
            <span className={`acceptance-badge ${run.decision}`}>
              {verdictNames[run.decision]}
            </span>
          </div>
          <p>
            输出 v{run.snapshot.output.version} · 标准 v{run.standard_version} ·{" "}
            {statusText}
          </p>
          <small>
            使用标准：{run.snapshot.standard_title}{" "}
            <button className="acceptance-text-button" onClick={onViewStandard}>
              查看标准
            </button>{" "}
            · AI 建议需人工确认。
          </small>
        </div>
        <div className="acceptance-actions">
          {canRepair && repairSource && (
            <button
              disabled={!writable || busy}
              onClick={() => void onRepair(repairSource)}
            >
              <FilePenLine size={15} />
              {repairs[repairSource.id] ? "查看返修草稿" : "生成返修草稿"}
            </button>
          )}
          {previous.data && (
            <button onClick={() => onOpenRun(previous.data!.id)}>
              原验收记录
            </button>
          )}
          <button disabled={!writable || busy} onClick={() => onRecheck(run)}>
            <RefreshCw size={15} />
            {run.status === "failed" ? "重新验收" : "选择返修版本复验"}
          </button>
        </div>
      </div>
      {run.error_message && (
        <p role="alert" className="acceptance-error">
          {run.error_message}
        </p>
      )}
      <div
        className={`acceptance-results-layout ${previous.data ? "is-recheck" : ""}`}
      >
        <div className="acceptance-compact-tabs" aria-label="验收结果面板">
          <button
            aria-pressed={compactPane === "preview"}
            onClick={() => setCompactPane("preview")}
          >
            输出预览
          </button>
          <button
            aria-pressed={compactPane === "detail"}
            onClick={() => setCompactPane("detail")}
          >
            检查详情
          </button>
        </div>
        <section
          className={`acceptance-surface acceptance-review-media ${compactPane === "preview" ? "is-compact-active" : ""}`}
        >
          <EvidenceViewer
            run={run}
            previous={previous.data}
            selected={active}
          />
          {previous.isError && (
            <p role="alert">
              原验收记录加载失败。
              <button onClick={() => void previous.refetch()}>重试</button>
            </p>
          )}
          {previous.data && (
            <RecheckHistory
              run={run}
              previous={previous.data}
              onOpen={onOpenRun}
            />
          )}
        </section>
        <section
          className={`acceptance-surface acceptance-review-detail ${compactPane === "detail" ? "is-compact-active" : ""}`}
        >
          <div className="acceptance-list-heading">
            <h2>{previous.data ? "复验结果" : "逐项验收结果"}</h2>
            <small>
              {passed} 通过 · {failed} 未通过 · {pending} 待确认
            </small>
          </div>
          <div className="acceptance-rule-list acceptance-result-list">
            {run.results.map((item, index) => (
              <button
                key={item.criterion_id}
                className={`acceptance-rule ${active?.criterion_id === item.criterion_id ? "is-selected" : ""}`}
                onClick={() => setSelected(item.criterion_id)}
              >
                <span className="acceptance-rule-number" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="acceptance-rule-copy">
                  <strong>
                    {
                      run.snapshot.criteria.find(
                        (criterion) => criterion.id === item.criterion_id,
                      )?.title
                    }
                  </strong>
                  <small>{methodNames[item.origin]}</small>
                </span>
                <span className={`acceptance-badge ${item.verdict}`}>
                  {verdictNames[item.verdict]}
                </span>
              </button>
            ))}
          </div>
          {!run.results.length && (
            <p className="acceptance-empty">检查完成后显示逐项结果。</p>
          )}
          {active && (
            <div className="acceptance-result-detail">
              <h3>{criterion?.title}</h3>
              <p className="acceptance-muted">{criterion?.requirement}</p>
              {active.suggestion && (
                <p className="acceptance-notice">
                  AI 建议：{verdictNames[active.suggestion]}，最终结论由你确认。
                </p>
              )}
              <p>
                {humanDecision && active.verdict !== "pending"
                  ? `人工结论：${verdictNames[active.verdict]}`
                  : active.explanation}
              </p>
              {typeof humanDecision?.reason === "string" &&
                humanDecision.reason && <p>{humanDecision.reason}</p>}
              {run.status === "completed" && (
                <details
                  open={
                    active.verdict === "pending" ||
                    !!drafts[active.criterion_id]
                  }
                >
                  <summary>
                    {active.verdict === "pending"
                      ? "记录人工判断"
                      : "修改判断／标注问题"}
                  </summary>
                  <CriterionDecision
                    run={run}
                    result={active}
                    draft={
                      drafts[active.criterion_id] ??
                      savedDecisionDraft(run, active)
                    }
                    onChange={(draft) =>
                      setDrafts((values) => ({
                        ...values,
                        [active.criterion_id]: draft,
                      }))
                    }
                    disabled={!writable || busy}
                    onDecide={record}
                    onSample={async (start_ms, end_ms) => {
                      const value = await act(() =>
                        send<Run>(`${base(projectId)}/runs/${run.id}/samples`, {
                          expected_revision: run.revision,
                          start_ms,
                          end_ms,
                        }),
                      );
                      if (value) onUpdate(value);
                    }}
                  />
                </details>
              )}
              {original && (
                <details>
                  <summary>原始检查结果</summary>
                  <small>
                    {methodNames[original.origin]} ·{" "}
                    {verdictNames[original.verdict]}
                    {original.suggestion
                      ? ` · 建议${verdictNames[original.suggestion]}`
                      : ""}
                  </small>
                  <p>{original.explanation}</p>
                </details>
              )}
            </div>
          )}
          {!!pending && !running && (
            <p className="acceptance-notice">
              还有 {pending} 项待确认，暂不能确认整体通过。
              <button
                className="acceptance-text-button"
                onClick={() =>
                  setSelected(
                    run.results.find((item) => item.verdict === "pending")
                      ?.criterion_id,
                  )
                }
              >
                继续处理
              </button>
            </p>
          )}
          {run.decision === "passed" ? (
            <>
              <div className="acceptance-passed-message">
                <CheckCircle2 size={20} />
                <div>
                  <strong>
                    输出 v{run.snapshot.output.version} 已通过验收
                  </strong>
                  <small>人工结论与原始检查结果分别保留。</small>
                </div>
              </div>
              <div className="acceptance-actions">
                <button
                  className="acceptance-primary"
                  disabled={!writable || busy}
                  onClick={() => void act(() => onAdopt(run))}
                >
                  设为最终输出
                </button>
                <button onClick={onBack}>返回工作台</button>
              </div>
              <small>通过不会自动采用；采用后节点引用该版本。</small>
            </>
          ) : (
            <div className="acceptance-actions acceptance-finalize-actions">
              {run.status === "completed" && (
                <button
                  disabled={!writable || busy || !!pending}
                  className="acceptance-primary"
                  onClick={() =>
                    void record({
                      finalize: true,
                      reason: "",
                      verdict: "pending",
                    })
                  }
                >
                  确认整体验收结论
                </button>
              )}
              {canRepair && repairSource && (
                <button
                  disabled={!writable || busy}
                  onClick={() => void onRepair(repairSource)}
                  aria-label="返修草稿"
                >
                  <FilePenLine size={15} />
                  返修草稿
                </button>
              )}
              {running && (
                <button
                  disabled={!writable || busy}
                  onClick={() =>
                    void act(async () =>
                      onUpdate(
                        await send<Run>(
                          `${base(projectId)}/runs/${run.id}/cancel?expected_revision=${run.revision}`,
                          {},
                        ),
                      ),
                    )
                  }
                >
                  取消检查
                </button>
              )}
            </div>
          )}
          <details>
            <summary>人工判断历史（{run.decisions.length}）</summary>
            {run.decisions.map((item, index) => (
              <p key={index}>
                {String(item.at)} · {String(item.reason || item.decision)}
              </p>
            ))}
          </details>
        </section>
      </div>
    </>
  );
}
