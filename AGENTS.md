# AGENTS.md

## 开始前

- 每次正式处理仓库任务前先阅读本文件。命令默认在仓库根目录执行，Python 命令与诊断优先用 `uv run`。
- 保留用户已有的未提交改动。先定位问题根因和同类风险，修复影响当前交付的缺陷，把无关问题留给单独的改动。
- 主动落盘的临时输入、诊断、截图、渲染中间结果和本地验收产物放在 `.local/` 的任务子目录。创建前用
  `git check-ignore` 核验。用户指定的正式交付路径和工具自身不可配置的短生命周期系统临时文件除外。

## 编程与验证

- 按业务职责组织代码。用清楚的接口传递数据，由调用方显式提供依赖。避免循环依赖、访问模块内部实现、
  共享可变状态和隐式上下文。拆分应让组件可独立修改，避免为满足体量检查机械分片。
- 实现前梳理输入、校验、转换、输出和持久状态。考虑并发、取消、部分失败、重试和恢复。
- 修改用户行为时，检查各入口的权限、状态和反馈是否一致，并检查性能、错误恢复和可访问性。
- 按改动范围验证相关行为与契约，优先使用确定性测试。说明缺失的验证和原因。命令、质量门禁及文档同步范围见
  [开发与验证流程](docs/operations/development-workflow.md)。

## 数据与凭据

- 私人资源归已验证账号所有，管理员也受账号隔离约束。后台任务从持久记录恢复账号。
- 禁止绕过应用修改持久数据库，包括数据修复、删库重建和 schema 修改。日常命令行诊断仅限只读查询。
  已登记迁移和账本不可手改。正式迁移先在隔离库验证，再走显式部署流程。
- 自动测试使用隔离配置和临时数据库。正式配置、凭据、备份和运行数据不得提交，密钥不得输出。
- 产品文档中心受保护。工程整理不得迁移、删除、改写或重新生成受保护内容。
  路径与提交规则见 [Agent Note 维护规则](docs/operations/agent-notes.md#受保护的产品文档中心)。

## 按任务阅读

| 改动范围 | 先读 |
| --- | --- |
| 新增工坊、调整应用装配、跨工坊交接、公共路由或权限 | [Studio 框架契约](docs/architecture/studio-framework.md) |
| 新增目录、调整职责或定位实现 | [项目目录索引](docs/architecture/project-layout.md)，目录职责变化同步更新索引 |
| 改某项能力的行为、存储或恢复 | [能力实现契约](docs/architecture/capability-contracts.md) |
| 开发命令、测试门禁、公共契约和 SDK 生成 | [开发与验证流程](docs/operations/development-workflow.md) |
| 文件落盘与数据库提交 | [文件暂存与数据库事务](docs/operations/file-transactions.md) |
| 正式启动、公网、停机备份或数据迁移 | [生产部署](docs/operations/production-deployment.md) |
| 知识社区发布与逐篇授权 | [知识社区](docs/reference/knowledge-community.md) |
| 修改思绪工坊用户行为或维护官方文章与图形 | [官方知识库写作](docs/operations/official-knowledge-writing.md)，同步更新对应指南 |
| 云控授权、Happier 或外部 Agent 执行 | [云控](docs/reference/cloud-control.md)、[Happier 部署](docs/operations/happier.md)、[编程智能体接入](docs/operations/code-agents.md) |
| 非机械性的行为、架构、跨文件契约、工具链、测试策略或落盘、网络、配置格式改动 | 按 [Agent Note 维护规则](docs/operations/agent-notes.md#何时写) 记录决策 |
