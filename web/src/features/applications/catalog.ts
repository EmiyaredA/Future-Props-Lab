import type { LucideIcon } from "lucide-react";
import { BookOpen, Clapperboard } from "lucide-react";

export type ApplicationCategory = "visual" | "productivity" | "development";
export type ApplicationDefinition = {
  id: string;
  name: string;
  description: string;
  category: ApplicationCategory;
  capabilities: string[];
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
  "图像",
  "视频",
  "画布",
  "AI创作",
  "剧本",
  "角色",
];

export const APPLICATIONS: ApplicationDefinition[] = [
  {
    id: "visual-workshop",
    name: "视觉创作工坊",
    description: "统一管理图像、视频与自由画布项目，让视觉内容从灵感走向成品。",
    category: "visual",
    capabilities: ["图像", "视频", "画布", "AI创作"],
    path: "/apps/visual-workshop",
    icon: Clapperboard,
    brandImage: "/brand/visual-workshop-mark.png",
  },
  {
    id: "galgame-workshop",
    name: "Galgame 工坊",
    description:
      "本地优先的 Galgame 创作工坊，编辑结构化剧本、分支并直接试玩。",
    category: "visual",
    capabilities: ["剧本", "分支", "试玩"],
    path: "/apps/galgame-workshop",
    icon: BookOpen,
    brandImage: "/brand/galgame-workshop-mark.png",
  },
];

export function categoryLabel(category: ApplicationCategory): string {
  return (
    APPLICATION_CATEGORIES.find((item) => item.value === category)?.label ??
    category
  );
}
