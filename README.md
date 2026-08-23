# Future Props Lab

未来道具研究所的模型基础设施管理台。项目从 Sayflow 的工程边界中提取了模型目录、模型调用日志、管理端主题与文档中心壳，不包含 Bot、知识库、电话接入、浏览器扩展和多实例部署；实时语音仅作为模型测试能力，文件语音识别、录音分段标注与 Galgame 配音流程仍是正式能力。

运行环境要求 Node.js 24 与 Python 3.11 或更高版本；持续集成同时验证 Python 3.11 最低支持版本和 Python 3.14。

## 快速开始

1. 安装依赖：`npm run setup`
2. 创建配置：`cp backend/.env.example backend/.env`，并替换 `FPL_SECRETS_KEY`
3. 创建首个管理员：`npm run account -- create-admin --username admin`
4. 启动前后端：`npm run dev`，使用命令输出的一次性临时密码登录并立即改密

首次启动会自动创建 `.runtime/future-props.db` 并执行迁移，不需要 Docker 或独立数据库服务。`npm run db:migrate` 与 `npm run db:migrate:check` 仍可用于手动诊断。

全新的模型目录会播种两条文本通道、两条默认停用的 SenseAudio 视觉通道、一条默认停用的
SenseAudio 专业说话人识别通道和一条默认停用的 SenseAudio 实时语音通道：OpenAI 兼容网关
包含官方文本清单的 16 个模型，Anthropic 通道包含 Claude Haiku 4.5；图片通道包含 4 个官方
图片模型，视频通道包含 Doubao Seedance 2.0，语音识别通道包含 SenseAudio ASR Pro 1.5，
实时通道包含 `senseaudio-realtime-1.0`。
所有供应商默认不带 API Key，需要在“模型服务”
页面分别填写；视觉模型只会在图片/视频节点中明确提交“创建生成任务”后使用，打开画布、右键
创建节点或选择节点都不会调用模型，也不会触发模型测试的付费快速诊断。

已有目录升级时会补充尚不存在的文本模型、两条默认停用的视觉通道、专业说话人识别和实时语音通道，不覆盖既有供应商凭证、
启停状态、模型描述或其他手工配置，也不会重新加入此前删除的旧文本模型。默认清单是随代码
发布的审核快照，应用启动时不会联网同步官网；完成迁移后，后续编辑和删除不会被启动流程覆盖。

Studio 默认地址为 <http://127.0.0.1:3000>，打开后进入账号登录页；API 文档为 <http://127.0.0.1:9000/docs>。应用保持单机 SQLite 与单进程运行，同时支持多个账号和逻辑隔离的 Workspace。一级“文件管理”保存可被视觉项目引用的图片、视频、音频与文档；工具导航聚合站内模型能力与常用公开研发工具，并按 Workspace 持久化收藏和最近使用记录。独立“集成中心”用于按 Workspace 管理和验证工具 API、MCP 服务与本地不可变版本 Skill，v1 不把这些资源注入 Agent 执行。基模型菜单包含持久化多轮“模型测试”、供应商与模型管理，以及可按快速诊断/模型测试区分的调用日志。模型测试支持文本、图片、视频、语音识别与端到端实时语音；实时页提供免按键双工、自动断句、双方转写、流式播放和说话打断，转写与音频只保留在当前页面内存中。文件语音可从本地上传或从当前 Workspace 文件管理选择，自定义 Pro 端点单文件限 100 MB，其余模型限 10 MB。识别页按模型能力显示语言、翻译、时间戳、文本整理、说话人、标点、热词与缩写参数，并可导出 JSON 1.1 或创建录音标注任务。

Galgame 工坊使用 Story 1.4 管理角色表情/皮肤、真实多层场景、剧情 CG、BGM、音效、语音、视频和资源总览。项目素材拥有稳定虚拟路径、媒体元数据与打包策略；语音识别通过已启用且声明 `speech_recognition` 能力的 OpenAI 兼容或 SenseAudio ASR 模型执行。SenseAudio ASR Pro 会保存带说话人和起止时间的句级分段，不随应用捆绑大型本地模型。

备份时先停止应用，再同时复制 `.runtime/future-props.db`、`.runtime/library/assets/`、
`.runtime/applications/`、
`.runtime/model-test/attachments/`、`.runtime/model-test/references/` 与
`.runtime/model-test/generated/`、`.runtime/workspaces/` 与 `.runtime/profiles/`。数据库路径可通过
`FPL_DATABASE_PATH` 调整，这些文件目录都位于数据库所在目录下。

详细说明见 [贡献指南](CONTRIBUTING.md)、[项目结构](docs/architecture/project-layout.md)、[环境变量](docs/reference/configuration.md)、[故障排查](docs/operations/troubleshooting.md)、[后台 Runner 运维](docs/operations/background-runners.md)、[文件与事务约束](docs/operations/file-transactions.md) 和 [API 参考](docs/reference/api.md)。
