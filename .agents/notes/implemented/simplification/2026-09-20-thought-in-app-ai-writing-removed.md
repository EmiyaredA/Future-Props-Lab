# Agent Note: 思绪工坊应用内 AI 写作下线

Status: implemented

## Problem

思绪工坊产品顶栏提供「AI 写作」侧栏，会在浏览器内直接调用 Workspace 模型做摘要/润色等。目标暂时改为只通过 Agent skill / SDK 对知识库写入，避免应用内再拉起模型；若不收窄入口，产品面与「仅 skill 写入」的运维意图会持续冲突。

## Decision

应用内删除 `WritingAssistant`、顶栏「AI 写作」按钮及相关 chrome / Web 客户端写作封装与专用样式。保留后端 `GET /v1/thought-workshop/models`、`POST /v1/thought-workshop/notes/{note_id}/assistant`、OpenAPI、Python SDK、桌面 Agent 白名单与 `thought-writing-assistant` skill 作为唯一接入面。产品目录与 `AGENTS.md` 表述改为「AI 写作经 Agent/SDK，应用内无入口」。`web/src/docs/` 文档中心保护路径不改。

## Alternatives considered

- **连后端写作 API / SDK / skill 一并删除** — 能彻底去掉模型调用面，但会切断已登记的 Agent 自动化与 SDK 契约；当前只是暂时收窄产品入口，否掉。
- **仅隐藏按钮、保留 `WritingAssistant` 死代码** — 改动最小，但留下可再启用的产品路径与未覆盖 e2e，违背「只依赖 skill/SDK 接入」的收窄意图；否掉。

## Consequences

- **收益**：应用内不再发起写作模型请求；写入路径收敛到 skill / SDK；后端接入面可继续被自动化使用。
- **代价与已知上限**：产品用户不能在编辑器内一键生成；重新提供应用内入口时需恢复 UI、Web API 封装与 e2e，并同步改回本 Note（决定翻转则新开篇）。

## Verification

- `WritingAssistant.tsx` 已删除；`KnowledgeTopbar` 无「AI 写作」按钮。
- `web/e2e/thought-workshop.spec.ts`、`thought-layout.spec.ts`、`thought-document-outline.spec.ts` 不再依赖该入口。
- `npm run verify-notes`；相关 web 单测 `knowledge-topbar`。

## Related proposals

[全局助手运行内核选型](../architecture/2026-09-20-global-assistant-runtime-selection.md) 已实现统一 Agent 接入；若新增应用内写作入口，需要另行明确本文产品范围的变化。
