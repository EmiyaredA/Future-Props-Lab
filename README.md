# Future Props Lab

「云控 → Agent 工作台」仅允许管理员浏览器 Session 访问，支持查看与持续同步本机 Codex、Claude Code、OpenCode、DeepSeek Harness 和 Pi 的已有会话。APP／CLI 依据原生证据识别；在本机网站入口绑定当前账号来源后开始采集，本批续聊输入禁用。使用、配置及兼容边界见 [Agent 工作台](docs/reference/agent-workbench.md)。

未来道具研究所的模型基础设施管理台。项目从 Sayflow 的工程边界中提取了模型目录、模型调用日志、管理端主题与文档中心壳，不包含 Bot、模型检索知识库（RAG）、电话接入、浏览器扩展和多实例部署；实时语音仅作为模型测试能力，文件语音识别、录音分段标注与 Galgame 配音流程仍是正式能力。

运行环境要求 Node.js 24、npm 11+、Python 3.11+、Git LFS，以及提供 H.264/libx264 与 AAC 编码能力的
FFmpeg/FFprobe；持续集成同时验证 Python 3.11
最低支持版本和 Python 3.14。克隆后先运行 `git lfs install`；若检出时跳过了 LFS 对象，运行
`git lfs pull` 后再执行安装。

文件库和首页支持视频帧、真实音频波形、PDF 首页与文本摘要，点击后可播放或阅读。
PDF 预览使用随 `npm run setup` 安装的 `pypdfium2`，在独立子进程中按页渲染；无需 Office、
LibreOffice 或额外预览服务。视频和音频继续使用上述 FFmpeg/FFprobe，WebP 由 Pillow 编码，
不要求 FFmpeg 提供 libwebp。Office 文档和压缩包仍通过下载查看。

账号直接拥有私人数据，平台角色仅有管理员和普通用户。管理员可分配共享模型与 Agent，但不能浏览他人私人项目。详见[账号与数据归属](docs/reference/account-governance.md)。

## 独立服务迁移

正在按同仓库独立服务拆分。Identity、Gateway、Agents、Portal、Assets、Rendering、Management 和 Thought 已有独立构建与 Compose 装配；Agents、文件库和思绪工坊拥有独立浏览器入口，门户停止后的新登录、素材访问和原生同步已通过隔离验收。Visual 与 Galgame 的项目目录及 Creative 作品认证可通过专用 Compose 叠加清单隔离验证。Rendering 当前承接五个兼容媒体处理接口，持久导出任务、其余服务和正式切换仍在实施。`npm run services:build -- identity --build` 构建独立镜像；操作与验收范围见[独立服务迁移](docs/operations/independent-services.md)。使用 `npm run services:start` 启动独立服务。完成全部门禁前，正式网站继续使用下述现有入口。

## 快速开始

日常使用只有一套热加载前后端。`npm start` 或 `npm run dev` 启动同一个入口；
`npm run website:service -- install` 安装登录后自动启动的后台服务。默认本机入口是
[http://127.0.0.1:3000](http://127.0.0.1:3000)，后端固定为 `127.0.0.1:9001`。关闭浏览器不会停止后台任务。

Amadeus 从顶栏或工坊按钮打开页面侧栏，可引用当前页面与选中控件。CLI / Python SDK / MCP 使用
网站地址和账号设置创建的 Management API Key；`fpl connect --url http://127.0.0.1:9001` 安全保存客户端配置。
公网继续使用原 HTTPS 网关和受限 SSH 隧道；本机目录与公网管理只在本机网站入口开放给有权账号。
详见[网站部署](docs/operations/production-deployment.md)和[访问指南](docs/reference/web-access.md)。

正式数据统一在项目 `.runtime/`，配置在 `backend/config.toml`。从桌面版迁入时，唯一源是正在使用的
`~/Library/Application Support/Future Props Lab/`，必须完整停机备份并沿用原加密密钥，不能合并项目里的旧开发库。
旧桌面代码保存在 `codex/desktop-archive-2026-11-02` 分支。

以下步骤仅用于全新安装；已有部署直接沿用配置、账号和素材，不重复初始化：

1. 安装依赖：`npm run setup`
2. 新安装创建配置：`cp backend/config.example.toml backend/config.toml`，填写 `[security].secrets_key`
   （生成方法见[配置文档](docs/reference/configuration.md)）。已有 `.env` 请先执行
   `npm run config:migrate -- --check`，再执行 `npm run config:migrate -- --apply`，不要生成替代密钥。
3. 显式初始化 schema：`npm run db:migrate`，然后创建首个管理员：`npm run account -- create-admin --username admin`
4. 启动前后端：`npm run dev`，使用命令输出的一次性临时密码登录并立即改密

启动前需要 `npm run build:studio` 准备公网及后端静态资源。启动器只检查迁移，不自动升级已有数据库；后续迁移按停机、完整备份、隔离验证和 `npm run db:migrate` 的流程执行，不需要 Docker 或独立数据库服务。

前端通过 Vite 热更新，后端代码通过 Uvicorn 重载，最多等待在途请求 10 秒；重载中断的交互可在服务恢复后手动重试，不自动重提模型任务。启动器先等待后端就绪，再启动前端；任一子进程退出会停止整套服务。重复启动不会生成第二套服务，也不会另选端口。

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

静态图片缩略版本由 `npm run images:generate` 生成，并通过 `npm run images:check` 校验；更换品牌或模板原图后重新生成并一并提交 LFS 派生资产。正式与开发构建都会检查清单，详见[加载反馈与图片预览](docs/reference/loading-and-images.md)。

本机固定访问 <http://127.0.0.1:3000>，API 后端为 9001，沿用 `backend/config.toml` 和 `.runtime/` 的现有账号、模型与素材；自动测试仍只使用临时隔离数据。公网继续复用同一后端，前端使用经过构建发布的资源，不暴露 Vite。API 文档为 <http://127.0.0.1:9001/docs>。应用保持单机 SQLite 与单进程运行，同时支持多个账号及其隔离的私人数据。一级“文件管理”保存可被视觉项目引用的图片、视频、音频与文档；工具导航聚合站内模型能力与常用公开研发工具，并按账号持久化收藏和最近使用记录。独立“集成中心”用于按账号管理和验证工具 API、MCP 服务与本地不可变版本 Skill；Amadeus 可按会话加载这些资源。AI 能力菜单包含持久化多轮“模型测试”、供应商与模型管理，以及可按快速诊断/模型测试区分的调用日志；具备完整纯文本请求的日志可导出不含密钥的复现包，用标准库脚本执行同步串行或异步并发批量调用。模型测试支持文本、图片、视频、语音识别与端到端实时语音；文本会话支持提示词、采样参数和图片上下文。实时页使用聊天式消息流，提供免按键双工、自动断句、双方转写、流式播放和说话打断；转写与音频只保留在当前页面内存中。文件语音可从本地上传或从当前账号文件管理选择，自定义 Pro 端点单文件限 100 MB，其余模型限 10 MB。识别页按模型能力显示语言、翻译、时间戳、文本整理、说话人、标点、热词与缩写参数，并可导出 JSON 1.1 或创建录音标注任务。

Galgame 工坊使用 Story 1.4 管理角色表情/皮肤、真实多层场景、剧情 CG、BGM、音效、语音、视频和资源总览。项目素材拥有稳定虚拟路径、媒体元数据与打包策略；语音识别通过已启用且声明 `speech_recognition` 能力的 OpenAI 兼容或 SenseAudio ASR 模型执行。SenseAudio ASR Pro 会保存带说话人和起止时间的句级分段，不随应用捆绑大型本地模型。

视频剪辑工坊使用账号隔离的工程、素材快照和微秒级多轨时间线，支持代理预览、后端确定性
精确帧、关联片段交接、片段导出与完整 MP4 渲染。视觉创作、Galgame 和视频剪辑三套工坊共用项目
快照生命周期，但各自保留领域文档、事务与错误规则；使用方法见应用内文档中心。

文档中心位于 [docs.html](http://127.0.0.1:3000/docs.html?page=overview)，也可从 Studio
侧栏打开。使用文档覆盖平台、模型、三个工坊和内置/外部工具；开发者与 API 分类直接展示仓库
已有说明。支持全文搜索（`/` 或 `⌘/Ctrl+K`）、应用/工具独立目录、图片放大和旧章节深链接。
正文真源位于 `web/src/docs/articles/`，核验依据与截图见
[文档覆盖清单](docs/architecture/documentation-coverage.md)。
正文展示复用 Sayflow 的受控文档组件框架，沿用研究所配色与鉴权。步骤、卡片、字段表、输入输出、公式与流程图的示例见[阅读展示](web/src/docs/articles/help/docs-reading.md)，编写约定见[渲染框架](web/src/docs/rendering/README.md)；`npm run docs:check` 检查组件契约、正文编译及生成参考。

备份时先停止应用，再复制完整运行目录与 `backend/config.toml`。运行目录包含 SQLite、
`accounts/`、`profiles/` 和回收站；升级后保留的旧文件也应一并备份。数据库路径可通过
`FPL_DATABASE_PATH` 调整，运行目录是数据库所在目录。

详细说明见 [贡献指南](CONTRIBUTING.md)、[项目结构](docs/architecture/project-layout.md)、[素材清单](docs/assets/MANIFEST.md)、[生产部署](docs/operations/production-deployment.md)、[开发交付说明](docs/architecture/handoff-readiness.md)、[环境变量](docs/reference/configuration.md)、[故障排查](docs/operations/troubleshooting.md)、[后台 Runner 运维](docs/operations/background-runners.md)、[文件与事务约束](docs/operations/file-transactions.md) 和 [API 参考](docs/reference/api.md)。

当前仓库交付声明为“仅限内部开发交接，未授予再分发许可”；素材的具体来源与限制以
[素材清单](docs/assets/MANIFEST.md) 为准。本声明不替代后续由权利人确认的正式许可证。

### 思绪工坊

在「应用 → 效率协作」打开思绪工坊，创建知识库卡片，以可编辑首页、多级文件夹和文档组织内容。
「知识库」仅表示文档项目容器，归账号私有，发布后可逐篇授权。支持表格、图片、附件、链接、LaTeX、
Mermaid；AI 写作经 Agent/SDK 接入（应用内无入口）。提供回收站、v3 完整或单库备份、Markdown 导入导出与 HTML 离线阅读。
旧笔记本经 0046 迁移转为文件夹，文档 ID 与内容保留；旧备份仅在导入转换层兼容。编辑器依赖通过既有 `npm run setup` 安装，无额外服务或新环境变量。

### 面试助手

在「应用 → 效率协作 → 面试助手」提交 JD 与 TXT / Markdown / PDF / DOCX 简历原件，由本机 Codex 读取、联网整理本场资料。准备任务、输入快照与资料版本按账号私有保存，支持取消、手动重试、刷新恢复、来源审阅及 Markdown / JSON 导出；文字练习固定使用资料蓝图的首轮三题。

真实准备默认关闭，在本机 `backend/config.toml` 的 `[interview_codex]` 启用并绑定 FPL 账号；需要已登录的 Codex CLI 0.163 或更新版本，首版支持 macOS。不会改写 Codex 全局配置。画面、语音输入与评分仍为模拟，练习回答及规则复盘仅保存在本页，刷新会清空；资料继续保留。配置、任务边界和接口见[面试资料准备](docs/operations/interview-preparation.md)。

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
各账号主动接入并在模型测试中使用。无需系统 Python/uv；详见
[桌面运行说明](docs/operations/desktop-macos.md#可选本地-qwen-语音)。

视觉工坊的视频节点提供固定动作迁移验收：模型 API 在 `[visual_acceptance]` 配置，Codex、Claude Code、OpenCode、DeepSeek Harness 和 Pi CLI 在 `[code_agents]` 配置并按账号授权。默认未配置，不自动安装或登录 CLI；项目负责模板说明和节点汇总，质量记录不限制最终输出采用。配置、版本要求与执行边界见[节点验收](docs/operations/node-acceptance.md)。

账号归属升级使用 `0116_account_ownership`。完成 schema 迁移后，管理员在维护页执行文件迁移与核验，全部完成后重启应用。正式数据升级前停机备份；开发热加载不会自动应用此迁移。旧凭据撤销，需要重新登录及签发 API Key。

### 独立管理端

管理中台使用独立服务与数据库，账号和模型治理分别由 Identity、Models 承接。已配置并完成迁移的多服务部署使用 `npm start`，仅启动管理侧使用 `npm run management:start`；管理页面使用 `npm run build:management` 独立构建。管理入口默认 `http://127.0.0.1:9002`，开发入口为 3001。旧单体恢复入口为 `npm run start:legacy`，正式切换前不能与新管理器竞争同一部署。配置、权限和隔离验收见[独立管理服务](docs/reference/management-service.md)。
