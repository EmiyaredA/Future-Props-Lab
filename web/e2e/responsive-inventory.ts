// 项目只读模板、节点验收、汇总、结果与复验在 visual-acceptance.spec.ts 覆盖 390/768/1600 宽度。
// 思绪工坊多维表格的数据表侧栏、视图标签、详情抽屉、三种视图、局部滚动、明暗主题与手机操作由 thought-multitable.spec.ts 覆盖。
// 文档导航、SDK 示例切换、受控渲染块、公式/图表、桌面三栏和手机抽屉由 docs-sdk.spec.ts 补充验证。
// 账号设置与运行额度由 account-governance.spec.ts 验证。
// 本机头像菜单的访问面板与公网隐藏边界由 website.spec.ts 覆盖。
// 已移除空间治理与公开空间入口。
// 模型目录、协议类型连接树与编辑弹窗由 model-catalog.spec.ts 补充明暗主题及手机检查。
// 模型与智能体统一入口、键盘切换、授权矩阵由 code-agents.spec.ts 覆盖 390/768/1280/1600px 与明暗主题。
// 官方技术文档图、放大阅读和个人全屏画板由 technical-knowledge.spec.ts 覆盖 390/768/1600 宽度与明暗主题。
import type { AppPage } from "../src/app/routes";

// Amadeus and local website access are covered by website.spec.ts at 390/768/1600px.
export const desktopSurfaces = {} as const;

// Every application route must name its responsive scenario owner.
export const responsiveOwners = {
  "agent-workbench-session": "shell",
  "agent-workbench-sources": "shell",
  "interview-assistant-session": "shell",
  home: "shell",
  "creative-workshop": "shell",
  "creative-workshop-mine": "shell",
  "creative-workshop-new": "shell",
  "creative-workshop-editor": "shell",
  "creative-workshop-detail": "shell",
  apps: "shell",
  files: "shell",
  tools: "shell",
  "integrations-tool-apis": "shell",
  "integrations-mcp": "shell",
  "integrations-skills": "shell",
  "integrations-external-connections": "shell",
  "video-frame-exporter": "shell",
  "video-downloader": "shell",
  "codex-model-source": "shell",
  "storage-usage": "shell",
  "model-test": "shell",
  "code-agents": "shell",
  "model-service": "shell",
  "model-call-logs": "shell",
  "thought-workshop-community": "thought",
  "thought-workshop-favorites": "thought",
  "thought-workshop-published": "thought",
  "thought-workshop-notes": "thought",
  "thought-workshop-editor": "thought",
  "thought-workshop-legacy": "thought",
  "thought-workshop-official": "thought", // Legacy resolver; imported articles use community reader.
  "visual-workshop-projects": "shell",
  "visual-workshop-canvas": "editors",
  "visual-workshop-assets": "editors",
  "visual-workshop-tasks": "shell",
  "galgame-workshop-projects": "shell",
  "galgame-workshop-overview": "editors",
  "galgame-workshop-editor": "editors",
  "galgame-workshop-preview": "editors",
  "presentation-workshop-projects": "shell",
  "presentation-workshop-template-editor": "editors",
  "presentation-workshop-templates": "shell", // presentation-templates.spec.ts covers designer and binding at 390/768/1440/1920px.
  "presentation-workshop-editor": "editors",
  "video-editor-projects": "shell",
  "video-editor-editor": "editors",
  "video-editor-tasks": "shell",
  "motion-compositor-projects": "shell",
  "motion-compositor-editor": "editors",
  "audio-annotation-projects": "shell",
  "audio-annotation-editor": "editors",
  "director-desk-projects": "shell",
  "director-desk-editor": "editors",
} satisfies Record<AppPage, "shell" | "editors" | "thought">;
export const publicSurfaces = ["login", "account-settings", "docs"] as const;
export const independentApplications = {
  creative: [
    "/creative-workshop",
    "/creative-workshop/mine",
    "/creative-workshop/new",
    "/creative-workshop/edit/:id",
    "/creative-workshop/item/:id",
  ],
  models: ["/model-service", "/model-test", "/model-call-logs"],
  integrations: [
    "/integrations",
    "/integrations/mcp",
    "/integrations/skills",
    "/integrations/external-connections",
  ],
  assets: ["/files"],
  portal: ["/", "/home", "/apps", "/docs.html"],
  agents: ["/agents", "/agents/sources", "/agents/sessions/:id"],
} as const;

export const staticPaths = [
  "/apps/agent-workbench",
  "/apps/agent-workbench/sources",
  "/apps/interview-assistant",
  "/management/accounts",
  "/management/audit",
  "/management/invites",
  "/management/settings",
  "/management/services",
  "/management/quotas",
  "/home",
  "/creative-workshop",
  "/creative-workshop/mine",
  "/creative-workshop/new",
  "/apps",
  "/files",
  "/tools",
  "/integrations/tool-apis",
  "/integrations/mcp",
  "/integrations/skills",
  "/integrations/external-connections",
  "/tools/video-frame-exporter",
  "/tools/video-downloader",
  "/tools/codex-model-source",
  "/tools/storage-usage",
  "/model-test",
  "/code-agents",
  "/model-service",
  "/model-call-logs",
  "/apps/thought-workshop",
  "/apps/thought-workshop/community",
  "/apps/thought-workshop/favorites",
  "/apps/thought-workshop/published",
  "/apps/thought-workshop/official-knowledge-bases/general",
  "/apps/thought-workshop/official-knowledge-bases/technical/documents/system",
  "/apps/visual-workshop",
  "/apps/visual-workshop/tasks",
  "/apps/galgame-workshop",
  "/apps/presentation-workshop",
  "/apps/video-editor",
  "/apps/video-editor/tasks",
  "/apps/motion-compositor",
  "/apps/audio-annotation",
  "/apps/director-desk",
  "/docs.html",
];
export const viewports = [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1600, height: 1000 },
  { width: 1920, height: 1080 },
  { width: 844, height: 390 },
];

// Independent management HTML and all its routes are covered by management.spec.ts.
export const managementSurfaces = [
  "/management.html",
  "/management/accounts",
  "/management/invites",
  "/management/settings",
  "/management/services",
  "/management/quotas",
  "/management/audit",
  "/management/application",
  "/management/access",
] as const;
