import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  workers: 1,
  testMatch: [
    "thought-workshop.spec.ts",
    "knowledge-community.spec.ts",
    "visual-workshop-real-smoke.spec.ts",
    "presentation-workshop.spec.ts",
    "presentation-export-feedback.spec.ts",
  ],
  grep: /(?:rich notes persist and archives import|精选书架、逐篇发布、跨空间授权编辑、收藏导出和撤回|真实前后端可通过 UI 创建视觉项目并上传项目图片|创建、编辑文字、备注和页面，保存重开及放映|真实 PPTX 下载期间持续显示进度，完成后明确提示下载位置入口)$/,
  use: {
    ...base.use,
    actionTimeout: 12000,
    navigationTimeout: 30000,
    trace: "on",
    screenshot: "only-on-failure",
  },
});
