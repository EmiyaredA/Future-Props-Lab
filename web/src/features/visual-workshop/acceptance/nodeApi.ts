import type { components } from "@generated/api";
import { fetchApiJson } from "@platform/api/client";
import { send } from "./api";

export type AcceptanceCatalog =
  components["schemas"]["NodeAcceptanceCatalogOut"];
export type AcceptanceScheme = components["schemas"]["AcceptanceSchemeOut"];
export type NodeAcceptance = components["schemas"]["NodeAcceptanceOut"];
export type AcceptanceSummary = components["schemas"]["AcceptanceSummaryOut"];
export type SchemeId = NonNullable<NodeAcceptance["scheme_id"]>;
const nodeBase = (project: string, node: string) =>
  `/v1/visual-workshop/projects/${encodeURIComponent(project)}/nodes/${encodeURIComponent(node)}/acceptance`;

export const getAcceptanceCatalog = () =>
  fetchApiJson<AcceptanceCatalog>("/v1/visual-workshop/acceptance/catalog");
export const getAcceptanceSummary = (project: string) =>
  fetchApiJson<AcceptanceSummary>(
    `/v1/visual-workshop/projects/${encodeURIComponent(project)}/acceptance/summary`,
  );
export const getNodeAcceptance = (
  project: string,
  node: string,
  output?: string,
) =>
  fetchApiJson<NodeAcceptance>(
    `${nodeBase(project, node)}${output ? `?output_id=${encodeURIComponent(output)}` : ""}`,
  );
export const selectAcceptanceScheme = (
  project: string,
  node: string,
  body: components["schemas"]["NodeAcceptanceSelectIn"],
) => send<NodeAcceptance>(nodeBase(project, node), body, "PUT");
export const startNodeAcceptance = (
  project: string,
  node: string,
  body: components["schemas"]["NodeAcceptanceStartIn"],
) =>
  send<components["schemas"]["AcceptanceRunOut"]>(
    `${nodeBase(project, node)}/runs`,
    body,
  );

export const acceptanceStateNames: Record<string, string> = {
  no_output: "暂无输出",
  unconfigured: "未选择模板",
  uninspected: "未验收",
  queued: "排队中",
  processing: "检查中",
  completed: "已完成",
  pending: "待确认",
  failed: "需修改",
  passed: "已通过",
  cancelled: "已取消",
  historical: "历史结果",
  stale: "需重新验收",
};
