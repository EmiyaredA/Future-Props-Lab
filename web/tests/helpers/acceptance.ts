import {
  newCriterion,
  type Run,
} from "@features/visual-workshop/acceptance/api";
export function acceptanceRun(changes: Partial<Run> = {}): Run {
  const criterion = {
    ...newCriterion(),
    id: "rule",
    title: "角色外观一致",
    method: "ai" as const,
  };
  return {
    id: "review",
    node_id: "node",
    output_id: "output",
    previous_run_id: null,
    standard_version: 1,
    model_id: "model",
    status: "completed",
    decision: "pending",
    revision: 3,
    created_at: "2026-10-22T08:00:00Z",
    error_message: null,
    snapshot: {
      standard_version: 1,
      standard_title: "镜头标准",
      criteria: [criterion],
      output: {
        id: "output",
        kind: "video",
        asset_id: "asset",
        text: null,
        version: 2,
        title: "S03 镜头",
      },
      prompt: "",
      coverage: "抽取 12 帧，仅抽帧辅助",
      metadata: { duration_ms: 8000 },
      check_results: [],
    },
    results: [
      {
        criterion_id: "rule",
        verdict: "pending",
        origin: "ai",
        suggestion: "passed",
        explanation: "AI 建议通过",
        evidence_ids: [],
      },
    ],
    evidence: [],
    decisions: [],
    ...changes,
  };
}
