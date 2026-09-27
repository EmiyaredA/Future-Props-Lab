# Agent Note: Amadeus 会话能力范围选择

Status: implemented

## Problem

Amadeus 原有能力列表直接展开在聊天窗口中，勾选会立即改变当前对话范围，资源较多时也难以定位需要的 Skill、工具 API 或 MCP。

## Decision

Amadeus 使用模态弹窗编辑当前对话的能力范围。弹窗以 Skill 分类为默认视图，同时提供工具 API 与 MCP 分类；三个分类都可按多个标签和关键词筛选，所选标签采用任一命中规则，每个资源也直接显示自身标签。所有勾选通过“应用更改”一次提交草稿。已选 Skill 仍通过既有会话加载接口在运行前加载，选择范围继续保存在每个对话的本地状态中；切换对话时先读取目标范围，再允许写回，避免覆盖其他对话的选择。会话脚本与 FPL 工具作为只读状态信息显示。

## Alternatives considered

- **在聊天窗口中继续使用内联即时勾选** — 实现简单，但编辑时缺少提交边界，资源多时占用聊天区域。
- **把范围改为 Workspace 全局配置** — 会改变现有的每个对话独立授权行为，且用户当前需求聚焦于 Amadeus 对话可用范围。

## Consequences

- **收益**：API、MCP 与 Skill 使用一致的选择、搜索、多标签筛选和应用流程；取消操作不会覆盖当前对话已保存的选择，不同对话的范围也不会在切换时串写。
- **代价与已知上限**：筛选范围取决于集成资源提供的标签；会话脚本和 FPL 工具仍由既有运行策略控制，不在此弹窗中逐项配置。

## Verification

- 确认 Amadeus 集成资源响应包含各分类使用的标签字段，并保持前端类型与其兼容。
- `npx eslint src/features/amadeus/CapabilityDialog.tsx src/features/amadeus/Window.tsx src/features/amadeus/protocol.ts src/features/amadeus/useAmadeusController.ts src/app/amadeus.tsx --max-warnings=0`
- `npx vite build`
- `npm run build --workspace web` 目前仍受仓库既有问题阻断：Pi agent 缺少 `vendor/pi/packages/agent/src/harness/env/nodejs.ts`，跳过其 prebuild 后还有 Amadeus 以外的 TypeScript 错误。
