import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, FilePenLine, RefreshCw } from "lucide-react";
import { visualWorkshopQueryKeys as keys } from "../queryKeys";
import {
  base,
  decide,
  getRun,
  methodNames,
  send,
  verdictNames,
  type Criterion,
  type Repair,
  type Result,
  type Run,
} from "./api";
import { EvidenceViewer } from "./EvidenceViewer";
export function RunReview({
  projectId,
  run,
  onUpdate,
  onRepair,
  onRecheck,
  onAdopt,
  writable,
  busy,
  act,
}: {
  projectId: string;
  run: Run;
  onUpdate: (run: Run) => void;
  onRepair: (draft: Repair) => void;
  onRecheck: (run: Run) => void;
  onAdopt: (run: Run) => Promise<void>;
  writable: boolean;
  busy: boolean;
  act: <T>(action: () => Promise<T>) => Promise<T | undefined>;
}) {
  const [selected, setSelected] = useState<string>();
  const [reason, setReason] = useState("");
  const [start, setStart] = useState(""),
    [end, setEnd] = useState("");
  const [region, setRegion] = useState(["", "", "", ""]);
  const active =
    run.results.find((r) => r.criterion_id === selected) ??
    run.results.find((r) => r.verdict === "failed") ??
    run.results[0];
  const criteria = run.snapshot.criteria as Criterion[];
  const criterion = criteria.find((item) => item.id === active?.criterion_id);
  const previous = useQuery({
    queryKey: keys.acceptanceRun(projectId, run.previous_run_id ?? ""),
    queryFn: () => getRun(projectId, run.previous_run_id!),
    enabled: !!run.previous_run_id,
  });
  const record = async (verdict: Result["verdict"], finalize = false) => {
    const updated = await act(() =>
      decide(projectId, run, {
        criterion_id: active?.criterion_id,
        verdict,
        reason,
        finalize,
        start_ms: start === "" ? null : Math.round(Number(start) * 1000),
        end_ms: end === "" ? null : Math.round(Number(end) * 1000),
        region: region.every((v) => v !== "") ? region.map(Number) : null,
      }),
    );
    if (updated) {
      onUpdate(updated);
      setReason("");
    }
  };
  return (
    <>
      <div className="acceptance-run-heading">
        <div>
          <h2>
            {run.snapshot.output.title as string}{" "}
            <span className={`acceptance-badge ${run.decision}`}>
              {verdictNames[run.decision]}
            </span>
          </h2>
          <p>
            输出 v{run.snapshot.output.version as number} · 标准 v
            {run.standard_version} ·{" "}
            {run.status === "completed"
              ? "检查完成"
              : run.status === "processing"
                ? "正在检查"
                : run.status === "queued"
                  ? "排队中"
                  : run.status === "failed"
                    ? "检查失败"
                    : "已取消"}
          </p>
          <small>此记录固定绑定输出版本和标准版本，AI 建议需人工确认。</small>
        </div>
        <button disabled={!writable || busy} onClick={() => onRecheck(run)}>
          <RefreshCw size={15} />{" "}
          {run.status === "failed" ? "重新验收" : "选择返修版本复验"}
        </button>
      </div>
      {run.error_message && (
        <p className="acceptance-error">{run.error_message}</p>
      )}
      <div className="acceptance-results-layout">
        <section className="acceptance-surface">
          <EvidenceViewer
            run={run}
            previous={previous.data}
            selected={active}
          />
          {previous.isError && <p role="alert">原验收记录加载失败。</p>}
        </section>
        <section className="acceptance-surface">
          <h2>逐项验收结果</h2>
          <div className="acceptance-rule-list">
            {run.results.map((item) => (
              <button
                key={item.criterion_id}
                className={`acceptance-rule ${active === item ? "is-selected" : ""}`}
                onClick={() => {
                  setSelected(item.criterion_id);
                  setReason("");
                  setStart(
                    item.start_ms == null ? "" : String(item.start_ms / 1000),
                  );
                  setEnd(item.end_ms == null ? "" : String(item.end_ms / 1000));
                  setRegion(item.region?.map(String) ?? ["", "", "", ""]);
                }}
              >
                <span>
                  <strong>
                    {criteria.find((c) => c.id === item.criterion_id)?.title}
                  </strong>
                  <small>{methodNames[item.origin]}</small>
                </span>
                <span className={`acceptance-badge ${item.verdict}`}>
                  {verdictNames[item.verdict]}
                </span>
              </button>
            ))}
          </div>
          {!run.results.length && <p>检查完成后显示逐项结果。</p>}
          {active && (
            <div className="acceptance-result-detail">
              <h3>{criterion?.title}</h3>
              <p>{criterion?.requirement}</p>
              {active.suggestion && (
                <p className="acceptance-notice">
                  AI 建议：{verdictNames[active.suggestion]}，最终结论由你确认。
                </p>
              )}
              <p>{active.explanation}</p>
              <fieldset
                disabled={!writable || busy || run.status !== "completed"}
              >
                <label>
                  判断说明／手动问题标注
                  <textarea
                    aria-label="判断说明"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="未通过、不适用或修改结论时需说明原因"
                    rows={3}
                  />
                </label>
                {run.snapshot.output.kind === "video" && (
                  <div className="acceptance-specifications">
                    <label>
                      起始秒
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={start}
                        onChange={(e) => setStart(e.target.value)}
                      />
                    </label>
                    <label>
                      结束秒
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={end}
                        onChange={(e) => setEnd(e.target.value)}
                      />
                    </label>
                    <button
                      disabled={start === "" || end === ""}
                      onClick={() =>
                        void act(async () => {
                          const updated = await send<Run>(
                            `${base(projectId)}/runs/${run.id}/samples`,
                            {
                              expected_revision: run.revision,
                              start_ms: Math.round(Number(start) * 1000),
                              end_ms: Math.round(Number(end) * 1000),
                            },
                          );
                          onUpdate(updated);
                        })
                      }
                    >
                      区间加密取样
                    </button>
                  </div>
                )}
                {run.snapshot.output.kind === "image" && (
                  <details>
                    <summary>标记图片区域</summary>
                    <small>归一化坐标 0–1：左、上、宽、高</small>
                    <div className="acceptance-specifications">
                      {["左", "上", "宽", "高"].map((name, i) => (
                        <label key={name}>
                          {name}
                          <input
                            aria-label={`标记区域${name}`}
                            type="number"
                            min={0}
                            max={1}
                            step="0.01"
                            value={region[i]}
                            onChange={(e) =>
                              setRegion(
                                region.map((v, j) =>
                                  i === j ? e.target.value : v,
                                ),
                              )
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </details>
                )}
                <div className="acceptance-actions">
                  <button onClick={() => void record("passed")}>
                    <Check size={14} /> 确认通过
                  </button>
                  <button onClick={() => void record("failed")}>需修改</button>
                  <button onClick={() => void record("not_applicable")}>
                    不适用
                  </button>
                </div>
              </fieldset>
            </div>
          )}
          <div className="acceptance-actions">
            <button
              disabled={!writable || busy || run.status !== "completed"}
              className="acceptance-primary"
              onClick={() => void record("pending", true)}
            >
              确认整体验收结论
            </button>
            <button
              disabled={
                !writable ||
                busy ||
                !run.results.some((r) => r.verdict === "failed")
              }
              onClick={() =>
                void act(async () => {
                  const draft = await send<Repair>(
                    `${base(projectId)}/runs/${run.id}/repair-drafts`,
                    {},
                  );
                  onRepair(draft);
                })
              }
            >
              <FilePenLine size={15} /> 返修草稿
            </button>
          </div>
          {run.decision === "passed" && (
            <button
              className="acceptance-primary"
              disabled={!writable || busy}
              onClick={() => void act(() => onAdopt(run))}
            >
              设为最终输出
            </button>
          )}
          {["queued", "processing"].includes(run.status) && (
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
          <details>
            <summary>人工判断历史（{run.decisions.length}）</summary>
            {run.decisions.map((item, i) => (
              <p key={i}>
                {String(item.at)} · {String(item.reason || item.decision)}
              </p>
            ))}
          </details>
        </section>
      </div>
    </>
  );
}
