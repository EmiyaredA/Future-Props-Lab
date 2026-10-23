# Future Props Lab

未来道具研究所的模型基础设施管理台。项目从 Sayflow 的工程边界中提取了模型目录、模型调用日志、管理端主题与文档中心壳，不包含 Bot、模型检索知识库（RAG）、电话接入、浏览器扩展和多实例部署；实时语音仅作为模型测试能力，文件语音识别、录音分段标注与 Galgame 配音流程仍是正式能力。

运行环境要求 Node.js 24、npm 11+、Python 3.11+、Git LFS，以及提供 H.264/libx264 与 AAC 编码能力的
FFmpeg/FFprobe；持续集成同时验证 Python 3.11
最低支持版本和 Python 3.14。克隆后先运行 `git lfs install`；若检出时跳过了 LFS 对象，运行
`git lfs pull` 后再执行安装。

账号治理新增独立管理中台与四种固定工作区角色；升级前的普通成员保留协作能力，模型配置和完整日志改由空间管理员负责。详见[账号与工作区治理](docs/reference/account-governance.md)。

## 快速开始

macOS App 支持本地 CLI / Python SDK 接入：在「账号设置 → API 密钥」开启接入，运行 App 内的
`Contents/Resources/fpl/fpl connect --name "My Agent" --write`，然后在 App 核对并批准。
不需要为内置 CLI 安装 Python；默认不开放接入，不改变现有登录和数据。详见
[本地 Agent 接入](docs/operations/desktop-agent.md)。

桌面顶栏的「Amadeus」打开独立的助手窗口。它在当前授权 Workspace 内显示已打开的 FPL
窗口和手动选取的控件，按账号保存本地会话；模型使用现有供应商配置。窗口可加载集成中心的
工具 API、MCP 和 Skills，外部调用、时间线修改及会话脚本会先显示参数并等待确认。
Pi Agent 源码固定在 `vendor/pi/`，安装和构建不依赖开发机的 Pi 目录。

macOS Apple Silicon 桌面版可通过 `npm run build:desktop` 构建 `.app`，
`npm run package:desktop` 制作 `.dmg`。安装后不需要 Python、Node.js、uv 或 FFmpeg，
首次启动在应用内创建管理员，数据独立于仓库。构建机要求与验证方法见
[macOS 桌面构建](docs/operations/desktop-macos.md)。首期仅本地 ad-hoc 签名，未公证，不作为公开发行版。

桌面日常开发无需重新打包：`npm run dev:desktop` 使用已安装 App 的正式账号、配置与作品；需要隔离时运行
`npm run dev:desktop:isolated`，`npm run dev:desktop:live` 保留为正式数据入口的兼容别名。CSS/兼容 React 修改即时生效，
后端和 Electron 修改检查通过后通过菜单栏「开发 → 应用更新」或 `Cmd/Ctrl+Shift+U` 应用。正式数据首次启用前自动停机备份，
有待执行迁移时阻止启动/更新。详见 [桌面热加载开发](docs/operations/desktop-development.md)。

1. 安装依赖：`npm run setup`
2. 新安装创建配置：`cp backend/config.example.toml backend/config.toml`，填写 `[security].secrets_key`
   （生成方法见[配置文档](docs/reference/configuration.md)）。已有 `.env` 请先执行
   `npm run config:migrate -- --check`，再执行 `npm run config:migrate -- --apply`，不要生成替代密钥。
3. 创建首个管理员：`npm run account -- create-admin --username admin`
4. 启动前后端：`npm run dev`，使用命令输出的一次性临时密码登录并立即改密

首次启动会自动创建 `.runtime/future-props.db` 并执行迁移，不需要 Docker 或独立数据库服务。`npm run db:migrate` 与 `npm run db:migrate:check` 仍可用于手动诊断。

开发模式自动重载最多等待在途请求 10 秒，避免长连接阻止新进程启动；重载中断的交互可在服务恢复后手动重试。

全新的模型目录会播种两条文本通道、两条默认停用的 SenseAudio 视觉通道、两条默认停用的
SenseAudio 音乐/音效通道、一条默认停用的 SenseAudio 专业说话人识别通道和一条默认停用的
SenseAudio 实时语音通道：OpenAI 兼容网关
包含官方文本清单的 16 个模型，Anthropic 通道包含 Claude Haiku 4.5；图片通道包含 4 个官方
图片模型，视频通道包含 Doubao Seedance 2.0，语音识别通道包含 SenseAudio ASR Pro 1.5，
实时通道包含 `senseaudio-realtime-1.0`，音频通道包含 Music 2.0 与 SFX 1.0。
所有供应商默认不带 API Key，需要在“模型服务”
页面分别填写；媒体模型只会在图片/视频/音频节点中明确提交“创建生成任务”后使用，打开画布、右键
创建节点或选择节点都不会调用模型，也不会触发模型测试的付费快速诊断。

已有目录升级时会补充尚不存在的文本模型、默认停用的视觉与音乐/音效通道、专业说话人识别和实时语音通道，不覆盖既有供应商凭证、
启停状态、模型描述或其他手工配置，也不会重新加入此前删除的旧文本模型。默认清单是随代码
发布的审核快照，应用启动时不会联网同步官网；完成迁移后，后续编辑和删除不会被启动流程覆盖。

Studio 默认地址为 <http://127.0.0.1:3000>，打开后进入账号登录页；API 文档为 <http://127.0.0.1:9000/docs>。应用保持单机 SQLite 与单进程运行，同时支持多个账号和逻辑隔离的 Workspace。一级“文件管理”保存可被视觉项目引用的图片、视频、音频与文档；工具导航聚合站内模型能力与常用公开研发工具，并按 Workspace 持久化收藏和最近使用记录。独立“集成中心”用于按 Workspace 管理和验证工具 API、MCP 服务与本地不可变版本 Skill；桌面 Amadeus 可按会话加载这些资源。基模型菜单包含持久化多轮“模型测试”、只返回本地 Mock 数据的“测试工具”、供应商与模型管理，以及可按快速诊断/模型测试区分的调用日志；具备完整纯文本请求的日志可导出不含密钥的复现包，用标准库脚本执行同步串行或异步并发批量调用。模型测试支持文本、图片、视频、语音识别与端到端实时语音；文本会话可为声明工具能力的 OpenAI/Anthropic 模型绑定测试工具，展示参数、Mock 结果和多轮执行步骤。实时页使用聊天式消息流，提供免按键双工、自动断句、双方转写、流式播放、说话打断和本地 Mock 工具调用；转写与音频只保留在当前页面内存中，工具调用详情会写入测试记录。文件语音可从本地上传或从当前 Workspace 文件管理选择，自定义 Pro 端点单文件限 100 MB，其余模型限 10 MB。识别页按模型能力显示语言、翻译、时间戳、文本整理、说话人、标点、热词与缩写参数，并可导出 JSON 1.1 或创建录音标注任务。

Galgame 工坊使用 Story 1.4 管理角色表情/皮肤、真实多层场景、剧情 CG、BGM、音效、语音、视频和资源总览。项目素材拥有稳定虚拟路径、媒体元数据与打包策略；语音识别通过已启用且声明 `speech_recognition` 能力的 OpenAI 兼容或 SenseAudio ASR 模型执行。SenseAudio ASR Pro 会保存带说话人和起止时间的句级分段，不随应用捆绑大型本地模型。

视频剪辑工坊使用 Workspace 隔离的工程、素材快照和微秒级多轨时间线，支持代理预览、后端确定性
精确帧、关联片段交接、片段导出与完整 MP4 渲染。视觉创作、Galgame 和视频剪辑三套工坊共用项目
快照生命周期，但各自保留领域文档、事务与错误规则；使用方法见应用内文档中心。

文档中心位于 [docs.html](http://127.0.0.1:3000/docs.html?page=overview)，也可从 Studio
侧栏打开。使用文档覆盖平台、模型、三个工坊和内置/外部工具；开发者与 API 分类直接展示仓库
已有说明。支持全文搜索（`/` 或 `⌘/Ctrl+K`）、应用/工具独立目录、图片放大和旧章节深链接。
正文真源位于 `web/src/docs/articles/`，核验依据与截图见
[文档覆盖清单](docs/architecture/documentation-coverage.md)。
正文展示复用 Sayflow 的受控文档组件框架，沿用研究所配色与鉴权。步骤、卡片、字段表、输入输出、公式与流程图的示例见[阅读展示](web/src/docs/articles/help/docs-reading.md)，编写约定见[渲染框架](web/src/docs/rendering/README.md)；`npm run docs:check` 检查组件契约、正文编译及生成参考。

备份时先停止应用，再同时复制 `.runtime/future-props.db`、`.runtime/library/assets/`、
`.runtime/applications/`、
`.runtime/model-test/attachments/`、`.runtime/model-test/references/` 与
`.runtime/model-test/generated/`、`.runtime/workspaces/` 与 `.runtime/profiles/`。数据库路径可通过
`FPL_DATABASE_PATH` 调整，这些文件目录都位于数据库所在目录下。

详细说明见 [贡献指南](CONTRIBUTING.md)、[项目结构](docs/architecture/project-layout.md)、[素材清单](docs/assets/MANIFEST.md)、[生产部署](docs/operations/production-deployment.md)、[开发交付说明](docs/architecture/handoff-readiness.md)、[环境变量](docs/reference/configuration.md)、[故障排查](docs/operations/troubleshooting.md)、[后台 Runner 运维](docs/operations/background-runners.md)、[文件与事务约束](docs/operations/file-transactions.md) 和 [API 参考](docs/reference/api.md)。

当前仓库交付声明为“仅限内部开发交接，未授予再分发许可”；素材的具体来源与限制以
[素材清单](docs/assets/MANIFEST.md) 为准。本声明不替代后续由权利人确认的正式许可证。

### 思绪工坊

在「应用 → 效率协作」打开思绪工坊，创建知识库卡片，以可编辑首页、多级文件夹和文档组织内容。
「知识库」仅表示文档项目容器，按 Workspace 共享并隔离。支持表格、图片、附件、链接、LaTeX、
Mermaid；AI 写作经 Agent/SDK 接入（应用内无入口）。提供回收站、v3 完整或单库备份、Markdown 导入导出与 HTML 离线阅读。
旧笔记本经 0046 迁移转为文件夹，文档 ID 与内容保留；旧备份仅在导入转换层兼容。编辑器依赖通过既有 `npm run setup` 安装，无额外服务或新环境变量。

### 面试助手

在「应用 → 效率协作 → 面试助手」提交 JD 与 TXT / Markdown / PDF / DOCX 简历原件，由本机 Codex 读取、联网整理本场资料。准备任务、输入快照与资料版本按账号和 Workspace 私有保存，支持取消、手动重试、刷新恢复、来源审阅及 Markdown / JSON 导出；文字练习固定使用资料蓝图的首轮三题。

真实准备默认关闭，在本机 `backend/config.toml` 的 `[interview_codex]` 启用并绑定 FPL 账号；需要已登录的 Codex CLI 0.163 或更新版本，首版支持 macOS。不会改写 Codex 全局配置。画面、语音输入与评分仍为模拟，练习回答及规则复盘仅保存在本页，刷新会清空；资料继续保留。配置、任务边界和接口见[面试资料准备](docs/operations/interview-preparation.md)。

### Live2D 工坊

在「应用 → Live2D 工坊」创建角色，导入透明 PNG 或 RGB 8 位分层 PSD，编辑网格、变形器与参数关键形，再制作表情和动作。保存格式为 `.fpllive2d`，可往返导入；PNG 序列按表情与动作组合分别输出。Cubism/CMO3/MOC3 和视频编译尚未支持。

实现、格式限制与验证见 [Live2D 工坊说明](docs/architecture/live2d-workshop.md)。`npm run test:desktop:live2d` 使用临时数据目录验证 Electron 入口、编辑器及保存恢复，不访问正式数据。

### 演示工坊

应用中的演示工坊支持紧凑 React 编辑器、统一历史与自动保存、原生表格／图表／公式／媒体、动画放映及可编辑 PPTX。已有 PPTX 可预检后导入，跨空间复用使用携带素材的 `.fplppt` 文稿包；静态交付可选择 PNG、JPEG 或打印 PDF。图表和公式矢量能力按需加载，全部字体与资源在本地提供。
图片支持更换、画布裁剪、翻转和外观调整；图形面板提供分类形状、图标与经过预检的 SVG 导入。
后端通过锁定的 `python-pptx`（含 lxml / XlsxWriter）在现有进程内导出；
`defusedxml` 校验自包含 SVG，`resvg-py` 生成 PowerPoint 所需的 PNG 兼容图，两者随 `npm run setup` 安装。
生产环境无需安装 Office 或 LibreOffice，后者仅用于交付时的外观核验。
仍使用单进程 SQLite 与现有公共文件库，不新增环境变量或常驻服务。
使用流程见[演示工坊官方指南来源](web/src/features/thought-workshop/official/content/presentation-workshop/overview.md)，文件互通与转换边界见[交付说明](web/src/features/thought-workshop/official/content/presentation-workshop/delivery.md)。管理员可主动导入更新后的指南，升级不会覆盖已导入的文章。

### Python 自动化

Python 3.11+ 的独立包位于 [`sdk/python`](sdk/python/README.md)，发行名 `future-props-lab-sdk`，导入名 `future_props_lab`。本地安装使用 `uv pip install ./sdk/python`；`npm run sdk:build` 构建 wheel 与源码包，本次不发布到公共仓库。

文档中心的「Python SDK」提供安装、鉴权、工坊批次、独立模型调用、流式事件与错误处理。`npm run contracts:generate` 同步 Web、SDK 和参考文档；`npm run contracts:check` 检查漂移，`npm run test:sdk` 运行确定性自动化测试。调用日志页的「独立模型任务」可以查看代码创建的任务与结果。

六个工坊的可执行完整样例位于 `future_props_lab.workshop_examples`，文档会从源码提取。
[自动化覆盖与验收记录](docs/architecture/sdk-automation-coverage.md) 区分具名方法、业务流程证据和未完成验收项。

### 可选本地语音

Apple Silicon Mac（macOS 15+）可在模型服务中按需安装 Qwen3-TTS Base 0.6B/1.7B，
使用参考录音克隆音色。默认安装、启动及升级不下载模型或 MLX 环境；平台管理员安装后，
各 Workspace 主动接入并在模型测试中使用。无需系统 Python/uv；详见
[桌面运行说明](docs/operations/desktop-macos.md#可选本地-qwen-语音)。

视觉工坊的视频节点提供固定动作迁移验收：模型 API、Codex、Claude Code 的接入仅由 `[visual_acceptance]` 配置，界面只读展示。默认未配置，不自动安装或登录 CLI；项目负责模板说明和节点汇总，质量记录不限制最终输出采用。配置、版本要求与执行边界见[节点验收](docs/operations/node-acceptance.md)。
