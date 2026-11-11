# Web 前端规范入口

## Pre-Development Checklist

- 从 [AGENTS.md](../../../../AGENTS.md) 确认任务范围，并按 [目录索引](../../../../docs/architecture/project-layout.md) 定位对应的 feature、路由和契约。
- 跨工坊改动先读 [工坊注册与 Web 边界](../../../../docs/architecture/studio-framework.md#工坊注册与-web-边界)。修改音频标注行为时，前后端使用同一份 [音频标注契约](../../../../docs/architecture/capability-contracts.md#音频标注)。

## Quality Check

- 按 [验证矩阵](../../../../docs/operations/development-workflow.md#验证矩阵) 选择组件或浏览器测试，并检查键盘操作、焦点和无障碍标签。
- 涉及公共 API 时，按 [公共契约与 SDK](../../../../docs/operations/development-workflow.md#公共契约与-sdk) 校验生成物和消费端。
