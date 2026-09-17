import type { LogFilters } from "@features/models/api";

export type DeleteTarget =
  { kind: "single"; ids: [string] } | { kind: "batch"; ids: string[] } | null;

export const sourceLabels: Record<string, string> = {
  model_diagnostic: "快速诊断",
  model_playground: "模型测试",
  model_inference: "独立模型调用",
  audio_annotation: "录音标注",
  thought_workshop_assistant: "思绪工坊写作",
  visual_workshop_assistant: "视觉助手",
  visual_workshop_generation: "视觉生成",
};

export function formatNumber(value: number | null | undefined): string {
  return value == null ? "—" : new Intl.NumberFormat("zh-CN").format(value);
}

export function formatCredential(row: {
  auth_kind?: string | null;
  api_key_name?: string | null;
  api_key_prefix?: string | null;
}): string {
  if (row.auth_kind === "session") return "网页会话";
  if (row.auth_kind === "management_api_key") {
    const name = row.api_key_name?.trim() || "API 密钥";
    return row.api_key_prefix ? `${name} · ${row.api_key_prefix}…` : name;
  }
  return "—";
}

export const emptyLogFilters: LogFilters = {
  q: "",
  callSource: "",
  providerKind: "",
  model: "",
  apiKeyId: "",
  status: "",
  from: "",
  to: "",
  page: 1,
  pageSize: 25,
};
