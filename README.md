# Future Props Lab

未来道具研究所的模型基础设施管理台。项目从 Sayflow 的工程边界中提取了模型目录、模型调用日志、管理端主题与文档中心壳，删除了 Bot、知识库、语音和部署等业务。

## 快速开始

1. 安装依赖：`npm run setup`
2. 创建配置：`cp backend/.env.example backend/.env`，并替换 `FPL_SECRETS_KEY`
3. 启动前后端：`npm run dev`

首次启动会自动创建 `.runtime/future-props.db` 并执行迁移，不需要 Docker 或独立数据库服务。`npm run db:migrate` 与 `npm run db:migrate:check` 仍可用于手动诊断。

全新的模型目录会播种 Sayflow 的两条文本通道：OpenAI 兼容网关包含 SenseAudio 官方文本生成清单的 16 个模型（SenseAudio S/S2/VL 系列、SenseNova、DeepSeek、Qwen、Kimi、GLM、MiniMax 与 Doubao），Anthropic 通道包含 Claude Haiku 4.5。供应商默认不带 API Key，需要在“模型服务”页面自行填写。

已有目录升级时只向默认 OpenAI 兼容网关补充本版本新增且尚不存在的模型，不覆盖供应商凭证、启停状态、模型描述或其他手工配置，也不会重新加入此前删除的旧模型。默认清单是随代码发布的审核快照，应用启动时不会联网同步官网；完成迁移后，后续编辑和删除不会被启动流程覆盖。

Studio 默认地址为 <http://127.0.0.1:3000>，打开后进入“工具导航”；API 文档为 <http://127.0.0.1:9000/docs>。工具导航聚合站内模型能力与常用公开研发工具，并将收藏和最近使用记录持久化到本机 SQLite。基模型菜单包含持久化多轮“模型测试”、供应商与模型管理，以及可按快速诊断/模型测试区分的调用日志。

备份时先停止应用，再复制 `.runtime/future-props.db`。数据库路径可通过 `FPL_DATABASE_PATH` 调整。

详细说明见 [项目结构](docs/architecture/project-layout.md)、[环境变量](docs/reference/configuration.md) 和 [API 参考](docs/reference/api.md)。
