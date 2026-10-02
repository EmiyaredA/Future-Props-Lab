import { PLATFORM_READING } from "./platformReading";
import { CREATIVE_READING } from "./creativeReading";
import { TECHNICAL_READING } from "./technicalReading";

export type OfficialDocumentReference = {
  readonly libraryId: string;
  readonly documentId: string;
};
export type OfficialReadingMetadata = {
  readonly summary: string;
  readonly related: readonly OfficialDocumentReference[];
};
const applicationReading = { ...PLATFORM_READING, ...CREATIVE_READING };
export function officialReading(
  library: string,
  document: string,
): OfficialReadingMetadata {
  const entry =
    library === "technical"
      ? TECHNICAL_READING[document]
      : applicationReading[`${library}/${document}`];
  if (!entry) throw new Error(`官方文章缺少阅读信息：${library}/${document}`);
  return entry;
}

export function officialGroupDescription(group: string) {
  const descriptions: Record<string, string> = {
    开始使用: "从第一个可验证的结果开始，选择适合当前任务的入口。",
    平台基础: "理解账号、空间和资源如何组织，建立稳定的工作环境。",
    模型服务: "完成连接与测试，根据调用结果定位问题。",
    桌面与自动化: "连接本机应用与自动化流程，明确授权和执行边界。",
    创作与编辑: "跟随具体流程操作，并检查每一步的结果。",
    保存与交付: "保存可编辑原稿，管理素材，并选择合适的交付格式。",
    帮助: "从遇到的现象出发，找到原因、处理办法和能力边界。",
    模型与执行: "沿请求和任务的生命周期，理解执行、恢复和结果交付。",
    工程与交付: "了解本机运行、构建和验证怎样组成可发布的应用。",
    应用原理: "深入十个应用的数据结构、编辑流程和执行机制。",
  };
  return descriptions[group] || "按主题阅读，了解相关能力和实际操作。";
}
