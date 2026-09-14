# 项目目录索引

这是 Future Props Lab 目录职责的唯一完整索引。新增、删除目录或改变目录职责时更新本文件；
各模块文档只补充局部使用方法，不另行定义一套架构。

```text
Future-Props-Lab/
├── .github/workflows/ # 冻结依赖的 Python/Web 质量检查与 Chromium E2E
├── .gitattributes     # 文档图片、固定字体与 VAD 资产的 Git LFS 边界
├── backend/fpl_config/ # 独立 TOML 格式、字段映射与一次性 .env 转换；不导入 app 或数据库
├── backend/config.example.toml # 无真实密钥的配置示例；私有 config.toml 不提交、不打包
├── backend/app/
│   ├── main.py        # FastAPI 装配、生命周期与健康探针
│   ├── deps.py        # HTTP/WebSocket 会话、Studio 鉴权与 WorkspaceDep
│   ├── problem_details.py # 统一协议错误映射
│   ├── accounts/      # 账号、Session、审计、API Key、Workspace 与公开投影
│   ├── concurrency/   # revision/CAS、Workspace 项目记录原语与通用单进程轮询 Runner 生命周期
│   ├── core/          # 配置、数据库与密钥基础设施
│   ├── files/         # IncomingFile、文件策略、显式 Workspace 落盘、项目事务与旧布局迁移
│   ├── media_rendering/ # 供应商/业务无关的 RenderPlan、帧求值、源时间/变速滤镜、视频渲染与取消控制
│   ├── agents/        # 供应商无关 Agent Harness、Reactive 工具循环与内存审批
│   ├── llm/           # 模型目录、供应商适配、共享生成/实时运行时、测试工作台和调用日志
│   ├── tool_navigation/ # 工具收藏与最近使用状态规则
│   ├── integrations/ # Workspace 工具 API、MCP、Skill 目录、验证与文件事务
│   ├── audio_annotation/ # Workspace 录音标注任务、文档/波形 CAS 与导入校验
│   ├── visual_workshop/ # 视觉工坊项目、画布、助手、生成任务与领域适配器
│   ├── galgame_workshop/ # Galgame 工程、Story 1.4 CAS、Story→RenderPlan 编译、剪辑交接、素材/ASR 与线路分析
│   ├── presentation_workshop/ # 文稿 CAS、公共图片引用与受限请求内原生 PPTX 导出
│   ├── thought_workshop/ # Workspace 富文本笔记、图片引用、AI 写作与可移植备份
│   ├── video_editor/ # API 驱动的多轨时间轴、代理/精确帧、片段交接与后台任务
│   ├── models/        # SQLAlchemy 持久化形状及其自有 ID/时间默认工厂
│   ├── routes/        # `/v1` HTTP/SSE 协议边界；Galgame 按九类协议模块拆分
│   └── schemas/       # Pydantic 请求与响应形状；Galgame 项目内容、Block 核心/流程与视频剪辑按职责拆包
├── db/migrations/
│   ├── versions/      # 只追加、不可改写的 SQLite migration
│   ├── registry.py    # 有序 migration 注册表与最新版本
│   └── runner.py      # checksum、连续前缀检查和事务应用
├── desktop/
│   ├── assets/       # 从项目品牌原图确定性生成的 macOS 主图标与 ICNS
│   ├── src/          # Electron 主进程、受限 preload、私有后端启动与生命周期
│   ├── ui/           # 本地启动/故障恢复窗口，不加载业务或用户数据
│   ├── backend/      # PyInstaller 入口：独立配置、数据锁、管道与 loopback 监听
│   ├── scripts/      # 白名单打包、arm64/动态库/许可校验及真实 Electron 烟测
│   └── tests/        # 桌面来源与固定能力边界的确定性测试
├── web/src/
│   ├── app/           # Studio 入口、Session Context、路由、配置驱动工坊壳与应用注册表
│   ├── docs/          # Markdown 使用正文、分类与上下文目录、搜索、阅读器及旧链接映射
│   ├── features/      # 账号治理、首页、AI 应用、文件管理、工坊、工具导航、集成中心与模型功能
│   ├── generated/     # OpenAPI 生成物
│   ├── platform/      # Cookie/CSRF、API 客户端、认证事件与浏览器语音基础设施
│   └── shared/        # 无业务归属的媒体处理、品牌与主题 UI
├── web/scripts/       # Web 构建与维护脚本；正式视频导出不在这里执行
├── web/public/docs/   # 文档中心使用的当前真实界面截图
├── web/tests/         # Web 组件测试
├── web/e2e/           # Playwright 浏览器旅程
│   └── fixtures/      # 人物旅程的确定性 API mock 与测试数据；真实烟测不使用
├── tests/             # 后端单元、API、存储与架构测试；大型 Story 契约/API 用例按行为拆分
├── scripts/           # OpenAPI/LFS 检查、配置转换、API 导入客户端、离线账号命令与 E2E 账号引导
│   └── demo/galgame_runaway/ # 内容专用演示维护工具；目标项目与素材路径必须显式传入
├── docs/assets/       # LFS 管理的文档/演示图片、来源许可证状态与内容集校验清单
├── docs/operations/   # 故障排查、备份与恢复说明
├── CONTRIBUTING.md    # 开发流程、边界、测试矩阵与交付检查表
├── CHANGELOG.md       # 交付批次的用户可见变化与工程治理记录
├── .runtime/          # 本机 SQLite 与运行期素材（已忽略，不提交）
├── .scratch/          # 本地临时分镜、场景图与工作草稿（已忽略，不提交）
├── output/            # 本地导出结果（已忽略，不提交）
└── tmp/               # 本地临时处理目录（已忽略，不提交）
```

## 目录与依赖边界

- `fpl_config/` 只拥有配置格式与文件转换。`core/config.py` 将 TOML 和进程环境映射到 Settings；
  `db/migrations/runner.py` 使用同一格式解析数据库路径，不依赖运行时 `app`。
  `scripts/migrate_config.py` 仅转换配置，不访问数据库；桌面入口在数据锁内执行旧配置一次性转换。

- `desktop/` 是现有应用的 macOS 壳，不拥有业务 API 或数据库 schema。
  `src/agent.ts` 拥有本地 Unix Socket 转发及连接描述，`backend/cli_entry.py` 仅启动独立 SDK CLI。
  `accounts/desktop_agent.py` 拥有短期配对，`desktop_ui.py` 校验打开资源的归属，Agent 操作白名单
  在 `accounts/desktop_agent_operations.json`；`routes/desktop_agent.py` 只承担 `/v1/desktop` 协议边界。
  `sdk/python/src/future_props_lab/desktop.py` 负责发现和配对，`cli.py` 提供 `fpl` 命令。
  `app/DesktopAgentHost.tsx` 负责授权通知、外部更新提示及受保护导航，账号设置拥有接入开关。
  `accounts/desktop_setup.py` 复用账号开通用例；`core/desktop.py` 只负责桌面凭据和静态托管。
  `web/src/features/accounts/DesktopSetupGate.tsx` 拥有首用表单，`platform/desktop.ts` 只定义固定桥接。
  桌面版配置和数据规则见 [macOS 桌面构建](../operations/desktop-macos.md)。

- `llm/catalog/` 拥有供应商分组、接入连接与模型目录。`supplier_records.py` 提供工作区限定的
  分组读取及安全输出，`suppliers.py` 通过目录统一 CAS 执行分组写入；协议边界位于
  `routes/models/suppliers.py`。供应商不持有密钥或启停状态，连接通过 `supplier_id` 显式归组。
- `web/src/features/models/catalog/` 拥有受控 `ModelCatalogEditor`、目录分类、供应商树和三层表单；
  `ModelServicePage` 适配工作区 API、缓存和冲突恢复，`WorkspaceDefaults` 负责默认用途选择与保存。
  管理中台通过数据、动作和字段权限复用编辑器，
  角色模板草稿、保存及同步由 `features/accounts/` 拥有；共用编辑器不直接请求 API 或持有 revision。
  页面、连接布局和弹窗样式分别由 `model-catalog.css`、`catalog-connections.css`、
  `catalog-dialogs.css` 维护。只读模型服务复用同一目录，隐藏写操作。
- 后端采用功能模块优先结构。`main.py` 负责装配，`routes/` 只负责认证、请求校验、调用功能
  边界和响应映射，不直接导入 SQLAlchemy、ORM 模型或 migration。查询、写入和事务由
  `llm/catalog/`、`llm/playground/`、`llm/call_logs/` 等所属能力负责。
- `accounts/provisioning.py` 是 HTTP 管理接口和离线账号命令共用的账号开通用例；账号、Workspace、
  Owner 成员关系、审计事件与新 Workspace 模型目录在同一事务内提交或回滚。`accounts/service.py`
  不依赖模型目录实现。
- `accounts/permissions.py` 拥有固定角色与密钥范围交集，`route_permissions.py` 显式登记业务操作。
  `governance_transactions.py` 在短写事务中重验操作者并执行 CAS；`management.py`、`member_roles.py`
  分别拥有平台身份与成员授权，`errors.py` 和 `error_views.py` 定义领域错误与安全快照。
  `routes/account_management.py` 只适配管理查询、创建和审计协议。
- `web/src/features/accounts/` 拥有管理中台三个页面、账号中心和空间面板；空间概览与独立成员/角色/审计管理、收到的邀请弹窗由该模块协调，视图状态与账号设置标签分离；查询键由 `queryKeys.ts`
  统一维护。`AccountMenu` 与 `WorkspaceTrigger` 分别提供账号和空间入口，`AccountWorkspacePanel`
  只装配弹窗；资料、安全表单与空间设置、成员授权分开维护。工作台顶栏及布局样式归属
  `app/layout/StudioGlobalHeader`，中台外壳、统计与列表样式留在账号功能内。
  `platform/auth/` 提供有效权限 Context，`app/ReadOnlyRoutes.tsx` 只装配各业务模块自有
  的只读浏览入口，不挂载编辑控制器。共享预览和下载展示归属 `shared/ui/ReadOnlyMedia.tsx`。
- `agents/harness/` 提供业务无关的 Agent Definition、消息/工具调用/Usage/适配器契约、上下文预算、
  Reactive 工具循环、Policy、Verifier、事件订阅、取消和内存审批；`phases.py` 原子化上下文编译、
  模型回合、工具提案、执行与审批阶段并保持事件顺序；不拥有项目数据，也不提供通用
  `/v1/agents` 管理接口。`llm/providers/` 是供应商协议差异的唯一实现边界，并反向实现 Harness
  定义的适配器契约。模型测试、诊断、REST/SSE 与 Web 消费端
  只依赖统一结果或事件，不根据供应商原始载荷控制运行行为；供应商管理界面展示配置属于例外。
- `llm/playground/` 拥有模型测试会话、测试工具、调用快照与流式结算。测试工具只执行 Workspace 内的
  确定性 Mock，不接入网络或外部系统；选择工具的文本会话复用 `agents/harness/`，未选择工具的会话
  继续使用原单轮流式路径。Web 的工具管理页面和对话工具控件归属 `features/models/tools/` 与
  `features/models/conversation/`，不把工具逻辑堆入应用壳或通用 UI。
- `llm/providers/realtime/` 只拥有供应商无关实时桥接契约与 SenseAudio 协议适配，
  `llm/realtime/` 负责 Workspace 模型解析、短会话日志结算和浏览器 WebSocket 编排；
  `web/src/platform/voice/` 负责 16 kHz 采集、Silero VAD、回声参考打断和 24 kHz 缓冲播放。
  这些模块不拥有 Bot、工具调用、知识库、电话或持久化实时会话。
- 后端不增加通用 `services/`、`domain/`、`platform/` 或 `product/` 分层。需要拆分大型模块
  时，按具体业务能力在所属功能包内命名，避免同一职责出现多个事实源。
- 工具目录由 Web 静态注册表维护；后端 `tool_navigation/` 只持久化稳定工具 ID 对应的收藏与
  最近使用状态，不复制工具名称、分类或外部网址。
- `integrations/` 拥有独立于工具导航的 Workspace 集成目录：`tool_apis/` 管理受限 HTTP 调用配置，
  `mcp/` 管理 Streamable HTTP/stdio 连接与工具快照，`skills/` 管理安全 ZIP 导入和不可变版本，
  `checks/` 只保存脱敏验证元数据。v1 只负责管理、发现和按需验证，不接入 Agent Harness 执行。
- `audio_annotation/` 管理 Workspace 级录音标注任务，根项目直接保存 `workspace_id` 并引用
  公共文件库中的音频；说话人/片段文档与最多双声道的预计算波形分别使用独立 revision CAS，
  选中片段可通过统一语音识别适配器执行一次性转写。识别参数、语言能力、文件上限和安全错误
  映射归属 `llm/transcription/`，录音标注、模型测试和 Galgame 只依赖该能力边界。
  删除任务不会删除原音频，被任务引用的音频不能从文件库删除。
- AI 应用目录同样由 Web 静态注册表维护，应用最近访问记录只保存在浏览器本地。视觉创作工坊、
  Galgame 工坊与视频剪辑工坊通过应用模块配置品牌、导航和 active 规则，共用 `app/layout/WorkshopShell`；侧栏展示由 `shared/ui/WorkshopSidebar.tsx` 统一拥有，
  包括品牌、返回卡片、图标导航和主题切换。思绪工坊复用该展示组件，知识库状态与目录仍由功能模块管理；
  后端 `files/` 负责公共文件元数据、文件夹、存储校验、项目引用，以及三个工坊创建/删除时数据库与
  文件目录的一致性补偿，
  `visual_workshop/` 负责真实项目、revisioned 节点画布、项目对话与图片/视频异步生成任务，
  `galgame_workshop/` 负责 Galgame 工程元数据、Story 1.4 故事文档 CAS、Workspace 级旧 Story
  批量迁移与旧文件导入用例、剧情对话富文本、多人角色舞台演出、
  角色/多层场景/音视频素材生命周期、虚拟打包路径、语音识别任务、立绘尺寸快照恢复、Fragment 线路分析与
  只读 Story 快照驱动的视频导出与分层剪辑交接任务，
  `video_editor/` 负责与 Story 解耦的微秒级多轨文档、类型化原子操作、项目素材快照、代理媒体、
  后端精确停帧和剪辑任务；`media_rendering/` 统一拥有 RenderPlan 契约、文字排版与透明图层、共享 `assets/` 固定中文字体、确定性帧求值、固定帧网格的
  FFmpeg/Pillow 合成和取消控制。正式剪辑渲染只依赖不可变时间轴快照和原素材，
  不启动 Chromium、Playwright 或浏览器录屏；Pillow 只承担文字透明层和二维像素合成，音频 PTS
  与最终封装由 FFmpeg 统一处理。
  均不预置项目或素材。Studio 一级
  “文件管理”和项目素材浏览器复用同一文件 API；Galgame 上传图片、音视频与字体也复用公共存储、内容签名和媒体元数据校验，
  但只能通过 Galgame 工程素材 API 修改或删除。`files/document_references.py` 统一检查文档与知识库封面的公共文件删除保护。公共文件被视觉或 Galgame 工程引用期间禁止删除，
  对话消息引用的项目素材也必须先解除引用才能删除。
- Galgame 视频导出按 `video_export_planning.py` 路线/片段/试片纯规划、`video_compiler.py`
  冻结 Story 到共享 `RenderPlan` 的编译、`video_compiler_events.py` 的绝对时间状态归约、
  `video_compiler_support.py`/`video_actor_compiler.py` 的舞台、序列帧与组合动画投影、
  `video_lip_sync.py` 的离线音频包络和确定性口型事件，以及 `video_dialogue.py` 的对白图层生成，
  `video_export.py` 用例和 `video_export_runner.py`
  后台执行拆分。直接导出与 `video_handoff.py`/`video_handoff_runner.py` 创建的分层剪辑工程共用
  同一编译结果；中文对白使用随应用分发的固定 Noto CJK 字体，正式成片只经过后端像素合成与
  FFmpeg，不启动网页、Chromium 或实时播放器。
  广播剧导入由 `annotation_import.py` 负责预检和任务
  用例，`annotation_import_runner.py` 将预检、FFmpeg 裁切、内容验收、文件落位、Story 结算与
  自动补偿保持为独立阶段。HTTP 路由不直接依赖
  Runner，应用生命周期只装配 Runner 模块。
- Galgame 素材写入和 CAS 用例保留在 `assets.py`；文件命名、媒体元数据映射等纯规则位于
  `asset_support.py`，引用分析、资源总览和打包清单位于 `asset_analysis.py`，避免 CRUD、Story
  遍历和打包投影继续共享一个大型类文件。
- 视觉助手对话生命周期与发送事务保留在 `visual_workshop/assistant/conversations.py`，附件权限、
  内容投影、图片编码和文档提取集中在同目录 `attachments.py`，避免会话持久化依赖具体媒体解析。
- 版本化项目快照的 ZIP64 流式校验、临时文件清理和跨平台目录打开命令由
  `files/project_snapshots.py` 与 `files/project_folders.py` 拥有；画布、Story 和时间线的
  类型化投影、ID 重映射与模型语义匹配仍位于三个所属工坊。
- `concurrency/project_records.py` 只提供显式 Workspace 谓词下的项目加载、revision CAS 更新和删除
  原语，不自动提交事务也不承载默认文档、就绪状态、快照投影或领域错误规则；三套工坊继续拥有各自
  用例。Web 的 `shared/ui/project-library/useProjectLibraryController.ts` 通过功能适配器统一项目列表、
  创建、改名、删除、快照导入导出、缓存和错误恢复，不依赖任何业务 feature。
- Web 的依赖方向是 `app → features → shared/platform/generated`。`platform/` 与 `shared/`
  不依赖 `features/` 或 `app/`，`features/` 不依赖 `app/`；入口装配留在 `app/`，业务代码不
  放回 `web/src/` 根目录，生成契约不手工修改。
- `features/models/queryKeys.ts`、`features/visual-workshop/queryKeys.ts` 与
  `features/audio-annotation/queryKeys.ts` 是各功能缓存键的唯一 owner；跨功能调用只复用 factory。
  `platform/api/useApiBlobUrl.ts` 统一鉴权预览请求的取消、竞态保护和 Object URL 回收，带独立缓存、
  重试预加载或多音轨调度的媒体运行时继续由所属 feature 管理。`shared/ui/project-library/` 只拥有
  项目卡片、快照导入/导出/目录按钮、重命名/删除对话框和无业务 API 依赖的集合更新规则；
  `shared/media/` 只拥有浏览器侧通用帧捕获、图片编码与安全文件命名，不持有项目 API。
- `features/accounts/` 拥有 Workspace 治理、个人资料与安全、平台账号页面和账号 API/Mutation；
  `app/StudioSession.ts` 只提供 Session Context，认证与业务请求统一经过 `platform/api` 客户端。
- Character Workspace 的 ViewModel 由独立 `characterWorkspaceViewModel.ts` 拥有，展示子面板不再
  反向导入总视图。Galgame 样式由 `galgameStyles.ts` 懒加载编辑器壳、Story 编排、角色舞台和
  素材/播放器四个语义包；源码在各语义所有者下继续按 foundation/components/interactions 拆分，
  不使用编号分片。构建预算只读产物，单 CSS 不超过 150 KiB、单懒加载 JS 不超过 500 KiB，
  Galgame CSS 总量以重构前 369,600 bytes 为基线至少降低 10% 并禁止回升。
- Galgame 编辑器内部以 `story-authoring/`、`timeline/`、`characters/`、`visuals/`、`audio/`、
  `preview/`、`presentation/`、`assets/` 为语义边界，各目录的 `index.ts` 是内部稳定入口；根目录
  同名旧文件只承担兼容转发或页面编排。Block 设置与 Inspector 均按文字、舞台、媒体、流程和系统
  家族维护，时间轴、角色与视觉工作区把交互 Hook、业务 mutation、派生 ViewModel 和视图分开，
  不允许把拆出的内部状态重新摊平成跨模块共享的巨型返回值。
- `web/src/docs/` 是独立文档入口的数据与展示边界。`articles/` 按能力维护唯一的 Markdown
  使用正文，`content.ts` 与 `types.ts` 维护分类、分组和应用/工具上下文；开发者与 API 分类直接
  加载仓库已有 Markdown，不保存副本。`legacyLinks.json` 显式映射拆分后的旧章节。
  阅读器从正文派生二三级目录、全文搜索和复制内容，保留 `docs.html?page=...#section`、前进后退、
  主题与移动端抽屉。配套截图及逐图来源只存于 `web/public/docs/`，不作为产品状态或测试数据源。
  `web/scripts/documentation-coverage.mjs` 从正文与来源清单生成文章覆盖表；文档结构回归在
  `web/tests/docs-content.test.ts`，浏览器阅读旅程在 `web/e2e/docs.spec.ts`。
  `rendering/` 移植 Sayflow 的静态文档树、受控组件与阅读样式，支持步骤、卡片、参数、输入输出、
  高亮代码、公式和 Mermaid；通过研究所主题、URL 与 API 操作适配器集成，不执行文章中的 JavaScript。
  组件契约、所有公开正文编译和渲染回归在 `web/tests/docs-rendering.test.tsx`，纳入 `npm run docs:check`。
- `scripts/demo/galgame_runaway/performance_upgrade.py` 只保留兼容入口、CLI 和流程编排；稳定演出规格、素材上传、
  Story 变换/演出块、审计报告与 API/CAS 辅助分别归属同目录 `performance_assets.py`、
  `performance_spec.py`、`performance_transform.py`/`performance_story.py`、`performance_audit.py` 和
  `performance_http.py`，旧函数入口通过兼容重导出继续可用。
- Web 组件和 E2E 测试按编辑器作者工作流、时间轴/角色、音频/舞台、播放器表现、画布助手和分支旅程
  等领域行为拆分；共享 mock/data builder 保留在所属测试能力内。测试文件不使用编号分片，单文件
  不超过 1,200 行，尺寸豁免基线保持为空。
- `.github/workflows/` 使用锁文件安装依赖：后端验证 Python 3.11 与 3.14，Web 使用 Node.js 24，
  Chromium E2E 使用隔离临时数据库和确定性 fixture，不携带真实供应商凭证。CI 检出默认不下载
  文档演示图，只为后端、Web 和 E2E Job 选择性拉取各自运行资产，并独立检查 LFS 指针完整性。
- 根 `/health`、`/ready` 是无版本探针，其他业务路由由统一的 `/v1` router 注册。
- `accounts/` 负责账号与 Workspace 用例；请求通过 Cookie Session 或绑定单一 Workspace 的
  Management API Key 生成 `StudioPrincipal`，`deps.WorkspaceDep` 只从该 Principal 派生租户 ID。
  业务模块不使用 ContextVar 或 `default` 回退；后台任务从持久任务记录恢复 Workspace，缺失归属
  立即失败。HTTP 上传在路由层适配为 `files.IncomingFile`，业务模块不依赖 FastAPI `UploadFile`；
  `AssetStorage` 项目路径与写入方法要求显式 `workspace_id`，`path_for(asset)` 只读取已验证资产归属。
  平台管理员切换到其他空间时也不会自动创建成员关系。

## 数据与运行边界

数据库是仓库根目录 `.runtime/future-props.db` 下的单机 SQLite 文件，也是项目状态唯一真源。
部署仍是单进程、单 SQLite，但账号之间按 `workspace_id` 做逻辑隔离。历史 `default` Workspace
继续读取原有目录；其他 Workspace 的新文件保存在
`workspaces/<workspace-id>/` 下，个人头像位于 `profiles/<user-id>/`。历史公共文件保存在
`library/assets/`；视觉项目使用
`applications/visual-workshop/projects/<project-id>/{assets,generated}/`；Galgame 项目使用
`applications/galgame-workshop/projects/<project-id>/{assets,derived,exports}/`；视频剪辑项目使用
`applications/video-editor/projects/<project-id>/{assets,derived,exports}/`。项目目录只保存素材、
派生文件和正式导出结果，不保存快照历史；标题变化不改变目录。模型测试对话图片保存在 `model-test/attachments/`，生成参考
素材及语音识别输入的任务私有副本保存在 `model-test/references/`，生成结果保存在 `model-test/generated/`。
Skill 的可编辑标签保存在 `integration_skills.tags`，与目录配置共用 revision/CAS，
不属于内容版本；文件存储显式使用已鉴权 Workspace。
Skill 不可变版本保存在 `workspaces/<workspace-id>/integrations/skills/<skill-id>/<version>/`。
本地临时分镜、场景图与未定稿草稿放在仓库根目录 `.scratch/`，与 `.runtime/`
一样被 git 忽略，不进入文档资产或产品素材真源。FastAPI 启动时自动创建
目录并执行 `registry.py` 中已登记、带 checksum 的 migration；每个连接启用外键约束、WAL
与忙等待。迁移历史只追加且不导入运行时 `app`，schema 变化必须同时更新 ORM、注册表、测试
和文档。`r0019_project_storage_layout` 只增加存储版本；旧文件由受鉴权的显式迁移 API 校验并搬迁，
schema migration 不执行文件 I/O。

目录配置、模型测试会话、测试工具与生成任务、视觉工坊项目、含节点级生成草稿和动态连线的节点画布、项目对话、文件夹、文件和项目引用
使用 revision/CAS 防止静默覆盖；Galgame 工坊工程元数据与整份故事文档分别使用 revision/CAS，
故事冲突保留服务器完整快照，完成态工程在故事修改后恢复草稿。Story 1.4 的角色、素材、国际化、
时间轴、流程与表现层交叉校验由 `schemas/galgame_workshop/story_validation.py` 的纯函数拥有；
旧 Story 1.0–1.3 的格式转换只由
`schemas/galgame_workshop/story_legacy.py` 适配器拥有；`galgame_workshop/story_migrations.py`
通过正式 `/v1` API 执行状态预检、受 Workspace 约束的批量 CAS 固化和单工程旧文件导入，不以
schema migration 或直接数据库修改替代运行期迁移。工具单项状态通过幂等更新和原子 upsert 写入。图片/视频/音频生成任务持久化
供应商/模型快照和规范化参数，FastAPI 生命周期中的单机执行器负责恢复、轮询与安全下载；视觉工坊
和模型测试复用 `concurrency/polling_runner.py` 的生命周期与并发控制，并由
`llm/generation_runtime/GenerationTaskDriver` 统一编排 queued、submitting、pending、processing
与终态转换、重启恢复及安全失败；两者分别提供任务存取、调用日志、素材组装和结果落盘钩子。
`submitting` 中断不会自动重提，以避免重复计费。`AsyncSession` 只能由单个异步任务
使用；每个生成分支使用独立短会话，供应商网络调用和文件下载不占用已开始写入的事务。
项目对话同样在发送准备与流式结算阶段使用独立短事务，并复用统一供应商适配边界。视觉工坊
Agent 是通用 Harness 的首个消费者：读取画布、素材和生成任务无需确认，画布写入和外部生成必须
经过内存审批；工具步骤持久化到对话消息，运行和审批等待不持久化，服务重启会安全取消遗留状态。
写工具复用视觉工坊校验与短事务，批量节点/连线变更只执行一次画布 CAS，生成任务与占位节点原子创建，
且不与 `model_test_*` 数据混用。

模型测试对话、测试工具、工具调用快照、图片附件及生成结果是独立的 Workspace 调试数据，不进入视觉
工坊文件管理，也不参与 Bot 或业务编排。测试工具均按无副作用 read 类型自动执行；启动恢复会把遗留
的 pending 模型回复和工具调用标记为 cancelled。`llm/call_logs/` 根据日志中已有的脱敏请求快照
按需生成不含凭证的临时复现 ZIP，不新增持久化副本；只有具备完整纯文本输入的供应商协议可导出。
实时语音通话不建立持久化会话，转写和音频只在浏览器与连接内存中存在，调用日志
仅保存时长、字符数、延迟、usage 与状态。当前工程包含单机账号和逻辑多 Workspace，但仍刻意不包含
Bot 会话、知识库、电话接入、浏览器扩展或多实例租户部署。

## 按需扩展

Sayflow 的 PostgreSQL、多实例 worker、扩展、共享 runtime 包、知识库、评测仓和部署体系不属于
当前架构。只有出现至少两个真实消费者或明确交付需求时，才创建 `packages/`、`extension/`、
`evals/`、`deploy/` 等目录，并同时补充本索引、运行命令和架构测试。

## 思绪工坊

文档历史由 `thought_workshop/history.py` 拥有快照与分页，`history_archive.py` 拥有 v5 备份历史校验和重映射；`notes.py` 在正文 CAS 事务中记录与还原内容。迁移 `0049_thought_history` 为现有文档建立作者未知的历史起点，历史附件独立引用并参与公共文件删除保护。历史全部保留，文档永久删除时级联释放。

Web 的 `NoteHistory` 复用现有只读 `RichEditor`；`historyDiff.ts` 负责有界块对齐与文字差异，`HistoryDecorations` 仅在预览中叠加标记，`history.css` 拥有列表和修改痕迹样式。历史模式不修改编辑草稿，唯一历史缓存键仍由 `queryKeys.ts` 维护。

`backend/app/thought_workshop/` 拥有文档项目、目录、正文、回收站与文件备份。这里的「知识库」是文档项目容器的名称，不提供模型检索、文件内容解析或独立权限系统。

- `knowledge.py`：知识库元数据、封面归属、首页创建、库级 revision/CAS、整库删除与恢复。
- `directory.py`：库内嵌套文档树、移动排序、循环校验；移动正文归属时推进文档 revision。
- `notes.py`：显式知识库归属下的正文读写、自动保存冲突快照、文件引用投影。
- `attachments.py`：附件上传；公共类型与签名校验由 `files/policy.py` 拥有。
- `portability.py` / `archive_structure.py`：v3 备份的预检、磁盘暂存、短事务与失败补偿。
- `legacy_import.py`：唯一的 v1/v2 备份转换边界。生产读写没有旧笔记本模型、接口或默认知识库回退。
- `schemas/thought_document.py`：无业务依赖的富文本允许列表、搜索文本与文件引用投影；正文保持 v2。

`web/src/features/thought-workshop/` 拥有知识库卡片、首页阅读与编辑、多级目录、保存队列、写作助手、格式转换与唯一 `queryKeys.ts`。`KnowledgeSidebar` 将库切换、搜索、直观筛选入口和独立滚动目录融入旧版侧栏；筛选结果在右侧显示，离开编辑器前沿用保存保护。`KnowledgeTree` 提供拖动与键盘菜单；旧笔记 URL 只根据文档 ID 跳转到包含知识库 ID 与文档 ID 的新地址。共享项目卡片的可选封面与元信息保持其他应用默认行为。

样式按职责分为 `knowledge.css`（项目列表与知识库布局）、`knowledge-results.css`（全部文档 / 最近编辑等筛选列表）、`thought-workshop.css`（保存冲突与助手面板）、`writing-layout.css`（编辑布局与标签）、`editor.css`（正文与工具栏）、`attachments.css`（文件卡片），所有覆盖限定在思绪工坊。共享侧栏样式位于 `shared/ui/workshop-sidebar.css`；`CustomSelect` 默认使用自绘顶层菜单避开目录滚动裁切，并根据可见视口向上或向下展开，保留原 DOM 焦点范围。

根知识库与文档显式保存 Workspace；子目录继承已验证的知识库归属。所有请求通过 `WorkspaceDep` 获取租户，模型注册中的租户过滤仅作额外防护。正文使用文档 revision，目录与库元数据使用库 revision，跨层修改在同一短事务中完成。

`thought_note_assets` 保护正文图片和附件，知识库封面通过外键与文件库用例保护，包括回收站。迁移 `0046_thought_knowledge_bases` 将每个有旧数据的 Workspace 转为「我的知识库」，旧笔记本成为顶层文件夹，移除旧表与字段，保留文档 ID 和所有内容。空空间不创建默认项目。迁移无运行时 app 依赖，并已在隔离数据库验证后登记。

## 前端屏幕适配

`shared/ui/ResponsiveSidebar.tsx` 拥有主控制台与普通工坊的单实例抽屉外壳；品牌、业务导航和账号入口仍通过原组件提供。`ViewportBounds.tsx` 同步可见视口高度和偏移，供软键盘出现时的面板与菜单约束使用。`useDrawerFocus.ts` 统一抽屉/弹窗的键盘范围与焦点恢复；`CompactPanelTabs` 仅提供面板切换展示，不拥有编辑器实例、文档或播放状态。`QueryFeedback` 展示加载失败及重试。

视频、Galgame、录音标注与模型测试的布局状态和适配 CSS 留在各自功能目录。Galgame 的独立预演也保留舞台、台词队列和检查器，布局规则由 `editor/fast-preview-compact.css` 拥有。紧凑面板通过 CSS 控制可见性，切换屏幕尺寸不重建业务控制器。思绪工坊侧栏背景随整页延伸，内部导航固定在可用视口。全站不使用根级横向溢出隐藏代替宽度修正。

`web/e2e/responsive-inventory.ts` 维护全部应用路由与独立入口的适配归属；`responsive-site`、`responsive-editors`、`responsive-panels`、`responsive-states` 分别负责入口、编辑工作区、账号/公开页/模型子面板及请求状态矩阵，`responsive-forms` 检查表单及嵌套菜单。`responsive-capture.ts` 检查页面宽度和可见弹层边界并保存实页截图。`web/tests/responsive-coverage.test.ts` 对路由联合类型与 HTML 构建入口执行遗漏检查；`viewport-bounds.test.tsx` 验证模拟可见视口收缩时的菜单定位及监听清理。验收记录见 `docs/reference/responsive-verification.md`。

## 平台治理补充职责

- `backend/app/accounts/platform_policy.py` 解析即时敏感策略；`platform_settings.py` 拥有平台配置 CAS；`registration.py` 拥有邀请码名额与注册事务。
- `accounts/model_templates.py`、`model_template_sync.py` 拥有角色目录模板、预览与逐空间持久同步；`demo_services.py` 拥有固定测试服务治理与工作区接入。
- `accounts/runtime_quotas.py` 拥有并发额度领取与恢复；`concurrency/task_admission.py` 只定义任务创建事务的归属回调类型；各功能用例在提交任务前调用它。
- `accounts/developer_docs.py`、`cross_workspace_logs.py`、`project_certification.py` 分别拥有受保护文档、显式跨空间概况、官方认证。`ModelTemplateSyncItem` 和 `RuntimeAdmission` 属于平台治理记录，跨空间访问由这些正式用例显式校验，不使用业务自动租户过滤。
- `backend/app/demo_runtime/runtime.py` 只实现应用进程内的固定 Mock 文本与演示工具运行时，不启动子进程；模型适配器和工具集成将明确的本地测试连接交给它。
- `llm/catalog/defaults.py` 校验并保存当前工作区默认模型，与目录共用 CAS 版本。
- `web/src/features/accounts/` 拥有七个管理页面、平台查询键、跨空间查询、邀请/模板/权限/服务表单与官方认证交互；应用壳仅负责路由装配。`features/models/catalog/WorkspaceDefaults.tsx` 拥有工作区默认用途弹窗。
- `db/migrations/versions/r0051_platform_governance.py` 至 `r0055_model_suppliers.py` 按已登记顺序追加治理数据结构，迁移测试使用临时数据库。

调用日志页面的工具栏、筛选抽屉和表格由 `web/src/features/models/logs/` 拥有；
`features/accounts/useLogWorkspaceScope.ts` 对外提供授权工作区范围与只读概况查询，查询键归账号模块。
`backend/app/accounts/cross_workspace_logs.py` 显式校验跨工作区范围；
`llm/call_logs/query.py` 仅复用列表筛选谓词及 UTC 今日统计，不承担授权或跨空间事务。

## 演示工坊

`backend/app/presentation_workshop/` 拥有文稿项目、图片归属校验、引用同步和请求内导出。
`projects.py` 处理 Workspace 限定加载与整体 CAS；`exports.py` 负责只读版本快照、
两路导出并发、私有临时文件和取消清理；`pptx_export.py` 组装 python-pptx 导出，`pptx_styles.py` 映射 DrawingML 样式，
`pptx_media.py` 拥有 SVG 扩展嵌入、PNG 兼容图与图片外观，`native_shapes.py` 构造可编辑自由形状。
文稿持久化于 `presentation_projects`，图片引用位于 `presentation_asset_references`。
迁移 `0057_presentation_styles` 为文稿 JSON 补齐确定性样式缺省值，不改变 revision 或更新时间；
`pptx_styles.py` 与 Web `PresentationShape.tsx` 分别拥有 DrawingML 和 SVG 样式映射。
格式控件拆分到 `PresentationShapeSettings.tsx` 与 `PresentationNumberField.tsx`。
迁移 `0056_presentation_workshop` 仅追加这两张表；图片沿用公共文件库并参与删除保护，
不增加独立项目素材目录或持久导出任务。API 不接收 Workspace ID。

`web/src/features/presentation-workshop/` 拥有项目列表、五种版式、DOM/SVG 页面渲染、
当前文本框 Tiptap 编辑、统一撤销、自动保存队列、元素变换、属性面板与放映。
`queryKeys.ts` 维护该功能缓存键；`SlideSurface` 被画布、可见缩略图和放映复用。
结构类型来自 OpenAPI，缩放不改变文稿坐标。样式分别由 `presentation-library.css`、
`presentation-workshop.css`、`presentation-canvas.css`、`presentation-controls.css` 与 `presentation-selection.css` 维护，
分别对应首页、编辑器布局、画布渲染、交互控件与选区悬浮操作；移动端只做浏览及轻编辑。
`presentation-inspector.css` 拥有格式面板的分区与控件样式，`InspectorArrange` 拥有对齐和层级控件，
`useInspectorResize` 管理面板左边缘拖动、键盘调宽与工作区宽度约束，宽度仅作为界面状态。
`PresentationToolbar`、`PresentationMenu`、`PresentationNotes` 与 `PresentationStatusbar`
拥有工具栏、键盘菜单、备注折叠和缩放操作，UI 状态不进入文稿数据。
`SelectionOverlay` 根据旋转后的屏幕选区定位悬浮栏，`SelectionToolbar` 按元素类型提供格式命令，
`useSelectionFormat` 统一整框与 Tiptap 选区格式，`selectionGeometry` 和 `SelectionHandles` 拥有八方向缩放及选框。
首页基础版式创建复用 `templates.ts`；画布报告实际缩放比例，缩略图按容器宽度等比适配。
新增路由由响应式清单登记，浏览器流程位于 `presentation-workshop.spec.ts`。

演示工坊的 `image_crop.py` / Web `imageCrop.ts` 分别拥有相同的原图区域到图片框的等比填充计算，
使用 `tests/fixtures/presentation_crop_cases.json` 共用测试向量。图片尺寸仅在读取素材后取得，
不进入文稿结构；浏览器缩略图和放映共用渲染器，PPTX 使用经 EXIF 校正后的素材尺寸。

图片与矢量素材的校验、预检与规范化归属公共 `backend/app/files/svg.py`，只支持受限自包含 SVG；
`/v1/files/svg/preview` 不持久化，上传继续走公共文件用例。文件列表默认排除 SVG，文件管理与演示工坊显式启用。
迁移 `0058_presentation_media` 只补齐确定性媒体外观缺省值，不改变文稿版本、revision 或更新时间。
演示工坊前端的 `usePresentationMedia` 统一插入和替换素材，`PresentationImages` 拥有文件搜索与分页，
`SvgImport` 拥有隔离图片预览；`PresentationShapePicker`、`shapeCatalog`、`iconCatalog` 管理分类和静态 Lucide 图标。
`SelectionMediaTools`、`MediaAppearance`、`MediaPreview` 管理媒体操作和精确外观。
`useImageCrop`、`ImageCropOverlay`、`cropGeometry` 管理可取消的裁剪草稿、旋转局部坐标及一次撤销提交。
`presentation-media.css` 维护媒体工具、选择器与裁剪覆盖层；覆盖层不进入缩略图、放映或导出。

视频创作工坊的图片预览裁剪由 `CanvasImageCrop` / `ImageCropSurface` 拥有临时选区、比例选择、键盘与触摸操作；
`imageCropGeometry.ts` 使用原图像素坐标，`imageCropExport.ts` 从同一已解码静态帧导出保留透明度的 PNG。
保存复用公共文件上传与画布 CAS，`derivedImageNode.ts` 负责裁剪和视频截帧派生节点的稳定身份及避让位置。
裁剪保存失败保留已上传素材并重试同一节点；冲突返回现有画布版本选择界面。裁剪不创建生成任务或修改原素材。
样式归属 `styles/image-crop.css`，浏览器验收由 `canvas-image-crop.spec.ts` 覆盖。

## Python SDK 与自动化

- `sdk/python/`：可独立构建安装的 `future-props-lab-sdk`；`src/future_props_lab/generated/` 只保存生成模型和具名资源方法，其他模块拥有 HTTPX 通信、流、鉴权、实时语音和本地文档构建器。
- `sdk/python/operations.json`：受版本控制的 HTTP 操作到稳定 Python 方法名映射；`coverage.json` 记录契约与文档证据，不能替代业务闭环验收。
- `scripts/generate_sdk.py`、`scripts/generate_sdk_docs.py`：从 OpenAPI 与方法映射生成 SDK 和公开模块参考；纳入 `contracts:generate` 与 `contracts:check`。
- `backend/app/llm/inference/`：独立模型能力查询、输入素材、文本调用、任务与结果管理；`routes/model_inference.py` 只处理协议。
- 工坊各自的 `operations.py` 拥有细粒度编辑校验与一次事务；`concurrency/operation_receipts.py` 仅提供持久化回执原语，`entity_edits.py` 仅提供纯列表编辑。
- `backend/app/models/model_inference.py` 与 `project_operations.py` 对应追加迁移 `0059_project_operations`、`0060_model_inference`。
- `web/src/features/models/inference/`：调用日志页中的独立任务查询、下载、转存与结果落盘重试入口；缓存键归属 models/queryKeys.ts。
- `web/src/docs/articles/sdk/`：公开 SDK 教程及生成方法参考；开发文档仍经已授权接口加载。
- `backend/app/thought_workshop/markdown_conversion.py` 与 `content_exports.py`：受控 Markdown 转换、静态 HTML 和含素材导出；`schemas/thought_conversion.py` 描述正式契约。
- `backend/app/audio_annotation/exports.py`：项目 JSON、SRT、已保存片段裁切与识别用例。
- `backend/app/files/video_frames.py`：工作区文件的逐帧提取；确定性音频裁切与视频取帧实现归属 `media_rendering/audio_clip.py`、`video_frames.py`。
- `web/src/docs/DocsExamples.tsx`、`DocsReadingProgress.tsx`：受控代码切换与阅读进度；目标阅读入口使用 `rendering/` 的 CardGroup；模块参考按业务模块分包，保留完整搜索内容。
- `sdk/python/src/future_props_lab/workshop_examples.py` 与 `sdk/python/workflows.json`：六个工坊可执行流程及业务证据，公开文档从样例源码生成；验收边界见 `docs/architecture/sdk-automation-coverage.md`。
- `backend/app/files/image_crop.py` 与 `schemas/image_crop.py`：公共文件的像素裁剪、边界与透明度规则，返回 PNG 后由调用者显式转存。
