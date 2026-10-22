import type { components } from "@generated/api";
import { fetchApiJson } from "@platform/api/client";
export type Criterion = components["schemas"]["AcceptanceCriterion"];
export type StandardDocument = components["schemas"]["AcceptanceDocument"];
export type Standard = components["schemas"]["AcceptanceStandardOut"];
export type Template = components["schemas"]["AcceptanceTemplateOut"];
export type Run = components["schemas"]["AcceptanceRunOut"];
export type Result = components["schemas"]["AcceptanceResult"];
export type Repair = components["schemas"]["AcceptanceRepairOut"];
export type DecisionInput = components["schemas"]["AcceptanceDecisionIn"];
export const base = (projectId: string) =>
  `/v1/visual-workshop/projects/${encodeURIComponent(projectId)}/acceptance`;
export const send = <T>(path: string, body: unknown, method = "POST") =>
  fetchApiJson<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
export const getTemplates = () =>
  fetchApiJson<components["schemas"]["AcceptanceTemplateListOut"]>(
    "/v1/visual-workshop/acceptance-templates",
  );
export const getStandard = (id: string) =>
  fetchApiJson<Standard>(`${base(id)}/standard`);
export const saveStandard = (
  id: string,
  body: components["schemas"]["AcceptanceStandardWriteIn"],
) => send<Standard>(`${base(id)}/standard`, body, "PUT");
export const getRuns = (id: string, page: number) =>
  fetchApiJson<components["schemas"]["AcceptanceRunListOut"]>(
    `${base(id)}/runs?page=${page}`,
  );
export const getRun = (id: string, runId: string) =>
  fetchApiJson<Run>(`${base(id)}/runs/${encodeURIComponent(runId)}`);
export const createRuns = (
  id: string,
  body: components["schemas"]["AcceptanceRunCreateIn"],
) =>
  send<components["schemas"]["AcceptanceRunListOut"]>(`${base(id)}/runs`, body);
export const getModels = (id: string) =>
  fetchApiJson<components["schemas"]["AcceptanceModelListOut"]>(
    `${base(id)}/models`,
  );
export const decide = (
  id: string,
  run: Run,
  body: Omit<DecisionInput, "expected_revision">,
) =>
  send<Run>(`${base(id)}/runs/${run.id}/decisions`, {
    ...body,
    expected_revision: run.revision,
  });
export const verdictNames: Record<string, string> = {
  passed: "通过",
  failed: "未通过",
  pending: "待确认",
  not_applicable: "不适用",
  historical: "历史记录",
};
export const methodNames: Record<string, string> = {
  automatic: "自动检查",
  ai: "AI 辅助",
  manual: "人工确认",
};
export function emptyDocument(): StandardDocument {
  return { title: "项目验收标准", node_ids: [], criteria: [] };
}
export function newCriterion(): Criterion {
  return {
    id: crypto.randomUUID(),
    title: "自定义验收项",
    requirement: "",
    kinds: ["image", "video"],
    method: "manual",
    required: true,
    specifications: { require_audio: false },
    reference_label: "",
    reference_asset_ids: [],
  };
}
