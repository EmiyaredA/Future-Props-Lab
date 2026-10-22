import { Check } from "lucide-react";
import type { DecisionInput, Result, Run } from "./api";
export type DecisionDraft = {
  reason: string;
  start: string;
  end: string;
  region: string[];
};
export function CriterionDecision({
  run,
  result,
  draft,
  onChange,
  disabled,
  onDecide,
  onSample,
}: {
  run: Run;
  result: Result;
  draft: DecisionDraft;
  onChange: (draft: DecisionDraft) => void;
  disabled: boolean;
  onDecide: (body: Omit<DecisionInput, "expected_revision">) => Promise<void>;
  onSample: (start: number, end: number) => Promise<void>;
}) {
  const change = (values: Partial<DecisionDraft>) =>
    onChange({ ...draft, ...values });
  const submit = (verdict: Result["verdict"]) =>
    onDecide({
      finalize: false,
      criterion_id: result.criterion_id,
      verdict,
      reason: draft.reason,
      start_ms:
        draft.start === "" ? null : Math.round(Number(draft.start) * 1000),
      end_ms: draft.end === "" ? null : Math.round(Number(draft.end) * 1000),
      region: draft.region.every((value) => value !== "")
        ? draft.region.map(Number)
        : null,
    });
  return (
    <fieldset disabled={disabled} className="acceptance-decision-editor">
      <label>
        判断说明／手动问题标注
        <textarea
          aria-label="判断说明"
          value={draft.reason}
          onChange={(event) => change({ reason: event.target.value })}
          rows={2}
          maxLength={3000}
          placeholder="未通过、不适用或修改结论时需说明原因"
        />
      </label>
      {run.snapshot.output.kind === "video" && (
        <details>
          <summary>问题区间与加密取样</summary>
          <div className="acceptance-interval-fields">
            <label>
              起始秒
              <input
                type="number"
                min={0}
                step=".01"
                value={draft.start}
                onChange={(event) => change({ start: event.target.value })}
              />
            </label>
            <label>
              结束秒
              <input
                type="number"
                min={0}
                step=".01"
                value={draft.end}
                onChange={(event) => change({ end: event.target.value })}
              />
            </label>
            <button
              disabled={
                disabled ||
                draft.start === "" ||
                draft.end === "" ||
                Number(draft.end) <= Number(draft.start)
              }
              onClick={() =>
                void onSample(
                  Math.round(Number(draft.start) * 1000),
                  Math.round(Number(draft.end) * 1000),
                )
              }
            >
              区间加密取样
            </button>
          </div>
        </details>
      )}
      {run.snapshot.output.kind === "image" && (
        <details>
          <summary>标记图片区域</summary>
          <small>归一化坐标 0–1：左、上、宽、高</small>
          <div className="acceptance-region-fields">
            {["左", "上", "宽", "高"].map((name, index) => (
              <label key={name}>
                {name}
                <input
                  aria-label={`标记区域${name}`}
                  type="number"
                  min={0}
                  max={1}
                  step=".01"
                  value={draft.region[index]}
                  onChange={(event) =>
                    change({
                      region: draft.region.map((value, i) =>
                        index === i ? event.target.value : value,
                      ),
                    })
                  }
                />
              </label>
            ))}
          </div>
        </details>
      )}
      <div className="acceptance-actions">
        <button onClick={() => void submit("passed")}>
          <Check size={14} />
          确认通过
        </button>
        <button onClick={() => void submit("failed")}>需修改</button>
        <button onClick={() => void submit("not_applicable")}>不适用</button>
      </div>
    </fieldset>
  );
}
