# Studio 后端规范入口

## Pre-Development Checklist

- 先按 [AGENTS.md 的任务索引](../../../../AGENTS.md#按任务阅读) 确认任务边界和相关文档。
- 音频标注是试点。修改创建、编辑、转录、删除或导出时，先读 [音频标注能力契约](../../../../docs/architecture/capability-contracts.md#音频标注)，在计划里指明涉及哪项规则和哪个入口。
- 涉及账号、路由或事务时，按需查 [身份与公共接口](../../../../docs/architecture/studio-framework.md#身份与公共接口)、[数据与事务](../../../../docs/architecture/studio-framework.md#数据与事务) 和 [文件暂存与数据库事务](../../../../docs/operations/file-transactions.md)。
- 按 [项目目录索引](../../../../docs/architecture/project-layout.md) 确认业务应用、协议和装配的归属。其他工坊同样使用 [能力实现契约](../../../../docs/architecture/capability-contracts.md) 的对应章节。

## Quality Check

- 对照计划中的条款检查涉及的入口与失败路径。音频标注文档保存重点核对版本检查、CAS 与回执同事务提交、重试和取消回滚。
- 按 [验证矩阵](../../../../docs/operations/development-workflow.md#验证矩阵) 选择检查，音频标注测试在 [tests/apps/audio_annotation](../../../../tests/apps/audio_annotation)。HTTP 或 SSE 契约有变化时查 [公共契约与 SDK](../../../../docs/operations/development-workflow.md#公共契约与-sdk)。
- 当前工程规则更新到所属契约，非平凡决策按 [Agent Note 规则](../../../../docs/operations/agent-notes.md) 记录。
