export type DeleteTarget =
  { kind: "single"; ids: [string] } | { kind: "batch"; ids: string[] } | null;

export const sourceLabels: Record<string, string> = {
  model_diagnostic: "快速诊断",
  model_playground: "模型测试",
  audio_annotation: "录音标注",
  thought_workshop_assistant: "思绪工坊写作",
  visual_workshop_assistant: "视觉助手",
  visual_workshop_generation: "视觉生成",
};

export function formatNumber(value: number | null | undefined): string {
  return value == null ? "—" : new Intl.NumberFormat("zh-CN").format(value);
}
