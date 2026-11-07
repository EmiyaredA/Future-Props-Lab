# 贡献指南

## 准备环境

项目要求 Node.js 24、npm 11 或更高版本、Python 3.11 或更高版本，以及 Git LFS。克隆仓库后运行
`git lfs install`。使用跳过 LFS 的检出方式时，再运行 `git lfs pull`。执行 `npm run setup` 安装依赖。

新安装复制 `backend/config.example.toml` 为 `backend/config.toml`，并填写新的 `security.secrets_key`。
已有 `.env` 用 `npm run config:migrate -- --check` 检查，再用 `npm run config:migrate -- --apply` 一次性转换，
保留原密钥。配置与凭据的维护规则见[开发与验证流程](docs/operations/development-workflow.md)。

## 开发与交付

1. 阅读根 [AGENTS.md](AGENTS.md)，按任务选择专题。目录和代码所有者见[项目目录索引](docs/architecture/project-layout.md)。
2. 用 `npm run dev` 启动本地 Studio。正式服务的启停、迁移、备份与回滚遵守[生产部署流程](docs/operations/production-deployment.md)。
3. 改动应用注册、依赖方向、账号权限或跨应用交接时，遵守 [Studio 框架契约](docs/architecture/studio-framework.md)。
   变更文件与数据库事务时，阅读[文件事务约束](docs/operations/file-transactions.md)。
4. 按[开发与验证流程](docs/operations/development-workflow.md)更新关联文档和契约，运行对应检查并记录结果。
   依赖变更应在全新检出目录按冻结锁文件验证。工程决策和产品文档中心的边界见 [Agent Note 维护规则](docs/operations/agent-notes.md)。
