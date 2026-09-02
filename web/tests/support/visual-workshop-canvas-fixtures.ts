import type { VisualAssistantConversation } from "@features/visual-workshop/api";

export const canvasProject = {
  id: "project-1",
  title: "未命名项目",
  kind: "canvas" as const,
  status: "draft" as const,
  revision: 0,
  created_at: "2026-08-03T08:00:00Z",
  updated_at: "2026-08-03T08:00:00Z",
};

export const assistantConversation: VisualAssistantConversation = {
  id: "assistant-1",
  project_id: "project-1",
  title: "AI 助手对话",
  model_id: "model-chat",
  model_slug: "demo-chat",
  image_model_id: null,
  image_model_slug: "",
  video_model_id: null,
  video_model_slug: "",
  revision: 0,
  created_at: "2026-08-03T08:00:00Z",
  updated_at: "2026-08-03T08:00:00Z",
  messages: [],
};
