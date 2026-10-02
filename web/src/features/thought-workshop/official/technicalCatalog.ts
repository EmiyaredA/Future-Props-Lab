import type { OfficialKnowledgeBase } from "./catalog";
const chapters = [
  ["system", "系统全景：一份操作如何穿过应用", "平台基础"],
  ["modules", "模块边界与路由：为什么按功能拆分", "平台基础"],
  ["identity", "Workspace 与权限：资源为什么不能串空间", "平台基础"],
  ["sqlite", "SQLite 与迁移：单机数据如何可靠演进", "平台基础"],
  ["revision", "保存、历史与并发：防止静默覆盖", "平台基础"],
  ["assets", "素材与导出：引用、快照和包有什么不同", "平台基础"],
  ["providers", "供应商适配与流式推理", "模型与执行"],
  ["tasks", "后台任务：提交中断与结果恢复", "模型与执行"],
  ["rendering", "时间线与媒体渲染：从状态到帧", "模型与执行"],
  ["automation", "集成与 Agent/SDK：受控的自动化入口", "模型与执行"],
  ["desktop", "Electron 桌面：本机服务与私有边界", "工程与交付"],
  ["engineering", "构建与契约测试：如何证明版本一致", "工程与交付"],
  ["presentation-workshop", "演示工坊：文稿树、布局与 PPTX", "应用原理"],
  ["thought-workshop", "思绪工坊：富文本、画板与知识库", "应用原理"],
  ["visual-workshop", "视觉创作工坊：节点图与生成任务", "应用原理"],
  ["galgame-workshop", "Galgame 工坊：故事图与路线求值", "应用原理"],
  ["video-editor", "视频剪辑：多轨、速度与接缝", "应用原理"],
  ["motion-compositor", "特效制作：关键帧与二维合成", "应用原理"],
  ["live2d-workshop", "Live2D：参数绑定、网格与动作", "应用原理"],
  ["desktop-pet", "桌宠：固定角色快照与运行事件", "应用原理"],
  ["audio-annotation", "录音标注：时间片段、说话人与转写", "应用原理"],
  ["director-desk", "导演台：场景图、动作与摄影机", "应用原理"],
] as const;
export const TECHNICAL_LIBRARY: OfficialKnowledgeBase = {
  id: "technical",
  title: "Future Props Lab 技术原理",
  description:
    "用 UML 与可编辑信息图理解系统架构、数据流、模型执行和十个应用的实现。",
  documents: chapters.map(([id, title, group], order) => ({
    id,
    title,
    group,
    order,
    source: `./content/technical/${id}.md`,
  })),
};
