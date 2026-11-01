import { TECHNICAL_LIBRARY } from "./technicalCatalog";
import { officialReading, type OfficialReadingMetadata } from "./reading";
export type OfficialDocumentSummary = OfficialReadingMetadata & {
  readonly id: string;
  readonly title: string;
  readonly group: string;
  readonly order: number;
  readonly source: string;
};
export type OfficialKnowledgeBase = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly applicationId?: string;
  readonly documents: readonly OfficialDocumentSummary[];
};

const applicationLibraries = [
  [
    "agent-workbench",
    "Agent 工作台",
    "阅读、绑定与持续同步本机编程会话，核对来源与附件权限。",
  ],
  [
    "interview-assistant",
    "面试助手",
    "由本机 Codex 准备岗位资料，并完成文字练习与报告交付。",
  ],
  [
    "presentation-workshop",
    "演示工坊",
    "制作幻灯片，排版文字与矢量素材，放映并交付 PPTX。",
  ],
  [
    "thought-workshop",
    "思绪工坊",
    "整理知识库与富文本文档，管理历史、附件及可迁移备份。",
  ],
  [
    "visual-workshop",
    "视觉创作工坊",
    "用节点画布组织素材与提示，完成图片和视频生成。",
  ],
  [
    "galgame-workshop",
    "Galgame 工坊",
    "编排角色、剧情与分支，试玩故事并导出路线视频。",
  ],
  [
    "video-editor",
    "视频剪辑工坊",
    "组织多轨片段、字幕与声音，预检并渲染成片。",
  ],
  [
    "motion-compositor",
    "特效制作工坊",
    "制作二维动画、路径遮罩和透明镜头，交接剪辑工程。",
  ],
  [
    "audio-annotation",
    "录音标注工坊",
    "分段试听录音，校对说话人、文本与情绪，导出标注。",
  ],
  [
    "director-desk",
    "导演台",
    "搭建三维预演，安排演员走位和摄影机运动，保存工程与输出。",
  ],
] as const;
const applicationChapters = [
  ["overview", "功能概览与快速开始", "开始使用"],
  ["workflow", "主要操作流程", "创作与编辑"],
  ["storage", "保存与素材管理", "保存与交付"],
  ["delivery", "导入导出与交付", "保存与交付"],
  ["help", "常见问题与能力边界", "帮助"],
] as const;
const generalChapters = [
  ["start", "入门与基本概念", "开始使用"],
  ["accounts", "账号与私人数据", "平台基础"],
  ["models", "模型配置与连接", "模型服务"],
  ["testing", "模型测试与后台任务", "模型服务"],
  ["logs", "调用日志与排查", "模型服务"],
  ["files", "文件管理与引用", "平台基础"],
  ["integrations", "工具 API、MCP 与 Skill", "平台基础"],
  ["creative", "创意工坊与固定版本安装", "平台基础"],
  ["desktop", "网站、Amadeus 与本地 Agent", "网站与自动化"],
  ["tools", "工具导航与视频帧导出", "平台基础"],
  ["automation", "SDK/API 使用指南", "桌面与自动化"],
  ["applications", "应用总览与选用", "开始使用"],
] as const;

export const OFFICIAL_KNOWLEDGE_BASES: readonly OfficialKnowledgeBase[] = [
  {
    id: "general",
    title: "Future Props Lab 官方文档",
    description:
      "从入门、账号与模型配置到桌面自动化，了解平台并找到各应用的完整指南。",
    documents: generalChapters.map(([id, title, group], order) => ({
      id,
      title,
      group,
      order,
      source: `./content/general/${id}.md`,
      ...officialReading("general", id),
    })),
  },
  TECHNICAL_LIBRARY,
  ...applicationLibraries.map(([id, name, description]) => ({
    id,
    applicationId: id,
    title: `${name}官方文档`,
    description,
    documents: applicationChapters.map(([chapter, title, group], order) => ({
      id: chapter,
      title,
      group,
      order,
      source: `./content/${id}/${chapter}.md`,
      ...officialReading(id, chapter),
    })),
  })),
];

export function officialPath(libraryId: string, documentId?: string) {
  return `/apps/thought-workshop/official-knowledge-bases/${encodeURIComponent(libraryId)}${documentId ? `/documents/${encodeURIComponent(documentId)}` : ""}`;
}
export function findOfficialLibrary(id?: string) {
  return OFFICIAL_KNOWLEDGE_BASES.find((library) => library.id === id);
}
/** Match the grouped directory rather than jumping across groups in file order. */
export function officialReadingOrder(library: OfficialKnowledgeBase) {
  const groups = [...new Set(library.documents.map((item) => item.group))];
  return groups.flatMap((group) =>
    library.documents.filter((item) => item.group === group),
  );
}
export function filterOfficialLibraries(query: string) {
  const term = query.trim().toLocaleLowerCase("zh-CN");
  return OFFICIAL_KNOWLEDGE_BASES.filter((library) =>
    `${library.title} ${library.description}`
      .toLocaleLowerCase("zh-CN")
      .includes(term),
  );
}
