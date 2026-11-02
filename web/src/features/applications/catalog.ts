import type { LucideIcon } from "lucide-react";

export type ApplicationCategory = "visual" | "productivity" | "development";
export type ApplicationDefinition = {
  id: string;
  name: string;
  description: string;
  category: ApplicationCategory;
  capabilities: readonly string[];
  path: string;
  icon: LucideIcon;
  brandImage?: string;
};

export const APPLICATION_CATEGORIES: Array<{
  value: "all" | ApplicationCategory;
  label: string;
}> = [
  { value: "all", label: "全部应用" },
  { value: "visual", label: "视觉创作" },
  { value: "productivity", label: "效率协作" },
  { value: "development", label: "开发辅助" },
];

export const APPLICATION_TAGS = [
  "笔记",
  "富文本",
  "图像",
  "视频",
  "画布",
  "AI创作",
  "剧本",
  "角色",
  "音频",
  "标注",
  "语音识别",
  "面试",
  "简历",
  "复盘",
];

export function categoryLabel(category: ApplicationCategory): string {
  return (
    APPLICATION_CATEGORIES.find((item) => item.value === category)?.label ??
    category
  );
}
