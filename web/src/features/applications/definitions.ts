import {
  BookOpen,
  Clapperboard,
  Film,
  MessagesSquare,
  Mic2,
  Presentation,
} from "lucide-react";
import type { ApplicationDefinition } from "./catalog";

export const AUDIO_ANNOTATION_DEFINITION = {
  id: "audio-annotation",
  serviceId: "annotation",
  name: "录音标注工坊",
  category: "productivity",
  description: "切分录音、配置说话人与情绪，逐段转写并导出字幕与片段。",
  capabilities: ["音频切分", "说话人", "语音识别", "字幕导出"],
  path: "/apps/audio-annotation",
  icon: Mic2,
  brandImage: "/brand/audio-annotation-mark.png",
} as const satisfies ApplicationDefinition;

export const DIRECTOR_DESK_DEFINITION = {
  id: "director-desk",
  serviceId: "director",
  name: "导演台",
  category: "visual",
  description: "搭三维场景、排走位和运镜，导出预演参考。",
  brandImage: "/brand/director-desk-mark.png",
  capabilities: ["三维预演", "走位", "运镜"],
  path: "/apps/director-desk",
  icon: Clapperboard,
} as const satisfies ApplicationDefinition;

export const PRESENTATION_WORKSHOP_DEFINITION = {
  id: "presentation-workshop",
  serviceId: "presentation",
  name: "演示工坊",
  category: "productivity",
  description: "用文字、图片和图形整理想法，编辑、放映并导出可编辑 PPTX。",
  capabilities: ["演示文稿", "排版", "PPTX导出"],
  path: "/apps/presentation-workshop",
  icon: Presentation,
  brandImage: "/brand/presentation-workshop-mark.png",
} as const satisfies ApplicationDefinition;

export const THOUGHT_WORKSHOP_DEFINITION = {
  id: "thought-workshop",
  serviceId: "thought",
  name: "思绪工坊",
  category: "productivity",
  description:
    "记录灵感，整理思绪。支持丰富排版、公式图表；AI 写作经 Agent/SDK 接入。",
  capabilities: ["笔记", "富文本"],
  path: "/apps/thought-workshop",
  icon: BookOpen,
  brandImage: "/brand/thought-workshop-mark.png",
} as const satisfies ApplicationDefinition;

export const GALGAME_WORKSHOP_DEFINITION = {
  id: "galgame-workshop",
  serviceId: "galgame",
  name: "Galgame 工坊",
  description: "本地优先的 Galgame 创作工坊，编辑结构化剧本、分支并直接试玩。",
  category: "visual",
  capabilities: ["剧本", "分支", "试玩"],
  path: "/apps/galgame-workshop",
  icon: BookOpen,
  brandImage: "/brand/galgame-workshop-mark.png",
} as const satisfies ApplicationDefinition;

export const VISUAL_WORKSHOP_DEFINITION = {
  id: "visual-workshop",
  serviceId: "visual",
  name: "视觉创作工坊",
  description: "统一管理图像、视频与自由画布项目，让视觉内容从灵感走向成品。",
  category: "visual",
  capabilities: ["图像", "视频", "画布", "AI创作"],
  path: "/apps/visual-workshop",
  icon: Clapperboard,
  brandImage: "/brand/visual-workshop-mark.png",
} as const satisfies ApplicationDefinition;

export const VIDEO_EDITOR_DEFINITION = {
  id: "video-editor",
  serviceId: "video",
  name: "视频剪辑工坊",
  description: "确定性多轨剪辑、精确停帧与原生 FFmpeg 成片。",
  category: "visual",
  capabilities: ["视频", "多轨剪辑", "字幕", "确定性导出"],
  path: "/apps/video-editor",
  icon: Film,
  brandImage: "/brand/video-editor-mark.png",
} as const satisfies ApplicationDefinition;

export const MOTION_COMPOSITOR_DEFINITION = {
  id: "motion-compositor",
  serviceId: "motion",
  name: "特效制作工坊",
  description: "制作可编辑的二维特效、路径遮罩与透明镜头。",
  category: "visual",
  capabilities: ["特效", "遮罩", "关键帧", "透明导出"],
  path: "/apps/motion-compositor",
  icon: Clapperboard,
  brandImage: "/brand/motion-compositor-mark.png",
} as const satisfies ApplicationDefinition;

export const INTERVIEW_ASSISTANT_DEFINITION = {
  id: "interview-assistant",
  serviceId: "interview",
  name: "面试助手",
  category: "productivity",
  description:
    "由本机 Codex 读取 JD 与简历、检索整理本场资料，再进行文字面试练习。",
  capabilities: ["面试", "简历", "复盘"],
  path: "/apps/interview-assistant",
  icon: MessagesSquare,
  brandImage: "/brand/interview-assistant-mark.png",
} as const satisfies ApplicationDefinition;

export const AGENT_WORKBENCH_DEFINITION = {
  id: "agent-workbench",
  serviceId: "agents",
  name: "Agent 工作台",
  category: "development",
  description: "查看本机 APP 与 CLI 的已有编程会话，实时跟随新增内容。",
  capabilities: ["会话", "编程", "实时同步"],
  path: "/agents",
  icon: MessagesSquare,
  brandImage: "/brand/agent-workbench-mark.png",
} as const satisfies ApplicationDefinition;

export const APPLICATION_DEFINITIONS = [
  PRESENTATION_WORKSHOP_DEFINITION,
  THOUGHT_WORKSHOP_DEFINITION,
  INTERVIEW_ASSISTANT_DEFINITION,
  VISUAL_WORKSHOP_DEFINITION,
  GALGAME_WORKSHOP_DEFINITION,
  VIDEO_EDITOR_DEFINITION,
  MOTION_COMPOSITOR_DEFINITION,
  AUDIO_ANNOTATION_DEFINITION,
  DIRECTOR_DESK_DEFINITION,
] as const;
