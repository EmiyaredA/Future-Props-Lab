# Future Props Lab

未来道具研究所的模型基础设施管理台。项目从 Sayflow 的工程边界中提取了模型目录、模型调用日志、管理端主题与文档中心壳，删除了 Bot、知识库、语音和部署等业务。

## 快速开始

1. 安装依赖：`npm run setup`
2. 创建配置：`cp backend/.env.example backend/.env`，并替换 `FPL_SECRETS_KEY`
3. 启动前后端：`npm run dev`

首次启动会自动创建 `.runtime/future-props.db` 并执行迁移，不需要 Docker 或独立数据库服务。`npm run db:migrate` 与 `npm run db:migrate:check` 仍可用于手动诊断。

Studio 默认地址为 <http://127.0.0.1:3000>，API 文档为 <http://127.0.0.1:9000/docs>。

备份时先停止应用，再复制 `.runtime/future-props.db`。数据库路径可通过 `FPL_DATABASE_PATH` 调整。

详细说明见 [项目结构](docs/architecture/project-layout.md)、[环境变量](docs/reference/configuration.md) 和 [API 参考](docs/reference/api.md)。
