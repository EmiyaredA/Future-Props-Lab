import type { Result, Run } from "./api";
import type { DecisionDraft } from "./CriterionDecision";
export function savedDecisionDraft(run: Run, result?: Result): DecisionDraft {
  const decision = [...run.decisions]
    .reverse()
    .find((item) => item.criterion_id === result?.criterion_id);
  return {
    reason: typeof decision?.reason === "string" ? decision.reason : "",
    start: result?.start_ms == null ? "" : String(result.start_ms / 1000),
    end: result?.end_ms == null ? "" : String(result.end_ms / 1000),
    region: result?.region?.map(String) ?? ["", "", "", ""],
  };
}
