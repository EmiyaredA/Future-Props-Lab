# Agent Note: 移除仓库内的 Trellis 集成

Status: implemented

## Problem

工程规则已有根 AGENTS.md 的任务索引、工程契约和 Agent Note。额外维护任务框架、规范索引与技能增加重复入口和维护成本，当前工作区没有需要继续交接的框架任务。

## Decision

仓库移除整个 `.trellis/` 和项目内全部 12 个 `trellis-*` 技能，包括本机开发者标识、缓存与只有初始化标题的个人日志，不迁移这些资料。根 [AGENTS.md](../../../../AGENTS.md#任务规划与审查) 直接指向现有工程契约，计划与审查引用同一组条款，验证按仓库矩阵选择。非平凡决策继续按 [Agent Note 规则](../../../../docs/operations/agent-notes.md) 记录。

原 Trellis 引入记录通过仓库归档命令封存，保留原决策正文，由本记录关联历史快照。历史快照中的 `.trellis/` 链接描述当时的文件位置，当前内容可从 Git 历史追溯。项目内 `watch` 技能、工程契约和受保护产品文档保持原状；仓库外的全局安装、其他项目及会话记录不属于此次清理范围。

## Alternatives considered

- **仅删除 `.trellis/`**。改动较少，但遗留技能和规则入口会继续指向已删除的脚本与规范。
- **移除集成并迁移个人资料**。可保留独有资料，但当前没有任务资料，个人日志只有初始化标题；用户选择直接完整移除。

## Consequences

- 开发规则与审查依据直接从现有工程文档读取，无需维护额外的 Trellis 入口。
- 仓库不再提供 Trellis 的任务管理、规范索引与日志流程；已受版本管理的旧资料可从 Git 历史追溯，被忽略的本机资料不保留。
- 本次清理不改变业务 API、数据格式或正式服务运行方式，不涉及提交、推送或部署。

## Verification

- 检查 `.trellis/` 及项目内 `trellis-*` 技能目录均不存在，`watch` 技能仍保留。
- 搜索仓库中的 Trellis 引用，仅保留本记录与归档历史中的说明。
- 运行 `npm run verify-notes`、`npm run check-docs-center-protected` 和 `git diff --check`；审查差异范围，确认既有业务代码改动保持原状。

[历史快照：主工作区的 Trellis 文档规范流程](../../archived/process/2026-11-10-trellis-codex-workflow.md)
