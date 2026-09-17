import { Box, Image, ListChecks, Palette } from "lucide-react";
import { WorkshopAppChrome } from "@shared/ui/WorkshopAppChrome";
import "@features/visual-workshop/visual-workshop.css";

const pages = {
  canvas: {
    eyebrow: "创作空间",
    title: "创作画布",
    description: "这里将用于组织视觉内容与创作步骤。",
    empty: "还没有打开的画布",
    detail: "创建项目后，你可以从项目工作台进入对应的创作空间。",
    icon: Palette,
  },
  assets: {
    eyebrow: "资源管理",
    title: "素材库",
    description: "统一查看项目使用的图像、视频与其他视觉素材。",
    empty: "素材库还是空的",
    detail: "首版暂不支持素材上传，后续能力将在这里接入。",
    icon: Image,
  },
  tasks: {
    eyebrow: "生成记录",
    title: "生成任务",
    description: "查看视觉生成任务的状态与结果。",
    empty: "还没有生成任务",
    detail: "首版暂不执行真实生成，因此这里不会展示模拟任务。",
    icon: ListChecks,
  },
} as const;

export function VisualWorkshopEmptyPage({
  page,
  onProjects,
}: {
  page: keyof typeof pages;
  onProjects: () => void;
}) {
  const content = pages[page];
  const Icon = content.icon;
  return (
    <section className="workshop-page">
      <WorkshopAppChrome
        eyebrow={content.eyebrow}
        title={content.title}
        description={content.description}
      />
      <div className="workshop-state workshop-empty workshop-feature-empty">
        <span className="workshop-empty-icon">
          <Icon aria-hidden />
        </span>
        <strong>{content.empty}</strong>
        <p>{content.detail}</p>
        <button type="button" onClick={onProjects}>
          <Box aria-hidden />
          返回项目工作台
        </button>
      </div>
    </section>
  );
}
