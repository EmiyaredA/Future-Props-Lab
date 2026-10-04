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
    系统全景与架构: "先认识系统边界、运行组成和代码组织，再定位具体机制。",
    组件化设计: "明确组件输入输出、状态所有权、生命周期与公开协作接口。",
    数据模型与数据流: "沿保存、引用与迁移追踪数据，理解权限、版本和持久化。",
    模型与执行机制: "跟踪外部推理、后台任务和媒体输出的执行与恢复。",
    各应用实现: "把公共机制带入十个应用，理解各自的数据与编辑流程。",
    工程验证与设计取舍: "用契约、测试与交付证据理解当前选择及其代价。",
  };
  return descriptions[group] || "按主题阅读，了解相关能力和实际操作。";
}
