# 项目目录索引

这是 Future Props Lab 目录职责的唯一完整索引。新增、删除目录或改变目录职责时更新本文件；
各模块文档只补充局部使用方法，不另行定义一套架构。

## 思绪工坊官方知识库

`web/src/features/thought-workshop/official/` 保留现有指南的导入来源：稳定清单、Markdown、简介、相关阅读和 CanvasScene。它不参与运行期社区列表、搜索或阅读。`scripts/official_seed_source.ts` 提取受控来源，`scripts/build_official_seed.py` 转换为普通 version 7 备份包，生成 `backend/app/apps/thought_workshop/publication/seed.json`；`knowledge:seed:check` 验证来源与包一致，桌面后端打包携带该 JSON。

`publication/imports.py` 复用普通备份导入用例，平台管理员在当前 Workspace 明确确认数量后创建 12 个私人库、93 篇文章及 12 篇首页。导入正文、目录和跨库 ID 引用与来源映射、请求回执在同一事务提交；回执按 Workspace、操作者、请求 ID 隔离。再次主动导入创建独立副本，不自动发布或覆盖。`OfficialSource` 只定位旧来源，`OfficialImportReceipt` 只记录成功结果。

官方内容与普通发布共用 Notes、编辑器、历史、搜索、收藏、导出和素材权限。Publication 保存 `is_official`、`read_only`、`editable_platform_roles`；只有平台超级管理员／管理员能改官方标记和角色授权。新发布默认只读；源普通成员不继承社区编辑权，逐篇账号授权仍生效，角色编辑授权不扩大可见范围或管理能力。能力字段独立返回，所有写入重新校验当前角色与发布权限。

`community/LegacyOfficialPage.tsx` 保留 `official-knowledge-bases` URL 兼容入口，依据来源映射解析当前可访问的官方发布。唯一匹配跳转，多匹配由用户选择，无匹配显示提示，不回退静态阅读。旧官方引用与收藏使用同一授权边界。`publication/references.py` 解析同一源空间的已发布跨库笔记引用，过滤不可见目标。

`document-layout/` 拥有普通与社区笔记的排版、卡片、动态目录、代码高亮、提示块和导出；`reading.css` 保存共用阅读首页及排版样式；`useDocumentChrome` 的页面状态通过显式 props 提供顶栏 Portal 宿主和整栏展开偏好。文章大纲从 H1–H6 派生父子关系，在右侧停靠或紧凑弹层中展开；折叠状态按编辑事务映射，不进入正文和数据库。`official/homeDocument.ts` 仅构建导入包首页。卡片保存引用和样式，标题、简介按实时权限解析；`KnowledgeTree` 仅表达父子关系。`official/technicalCatalog.ts` 和 `content/technical/figures/` 保存 31 篇技术文档及版本化图形的来源。写作约定见 `docs/operations/official-knowledge-writing.md`。

`tests/test_unified_official_publications.py` 验证导入、重试、权限、官方筛选与旧链接；`web/tests/official-knowledge.test.tsx` 验证来源，`official-reading.test.tsx` 验证兼容入口，`web/e2e/official-knowledge.spec.ts` 在隔离数据中验证实际导入与发布。

`diagrams/` 拥有 CanvasScene 模型、模板、纯操作、React Flow 全屏编辑器、Tiptap 节点、
Mermaid 共用阅读器及 SVG/PNG 导出。运行期选择和视口不进入正文；场景变更进入现有保存队列与历史。
`backend/app/apps/thought_workshop/schemas/canvas.py` 校验画板结构与关系；
`canvas_export.py` 按同一布局规则输出转义后的静态 SVG，图片由现有导出流程嵌入。
素材追踪、搜索、Markdown 和备份复用思绪工坊现有正式 API，不增加迁移或 HTTP 路由。
`web/tests/thought-canvas.test.tsx`、`technical-content.test.ts`、`web/e2e/technical-knowledge.spec.ts`
及 `tests/test_thought_canvas.py` 检查编辑、内容、只读、可移植性与租户边界。

```text
Future-Props-Lab/
├── .agents/skills/    # 仓库级 Codex Agent Skills；watch 为基于固定上游版本的通用视频分析 Skill
├── .agents/notes/     # 工程决策 Note；按 lifecycle/class 分类，不承载产品文档中心正文
├── .agents/agent-note-templates/ # proposed/implemented/rejected Note 模板
├── .github/workflows/ # 冻结依赖的 Python/Web 质量检查与 Chromium E2E
├── .gitattributes     # 文档图片、固定字体与 VAD 资产的 Git LFS 边界
├── backend/fpl_config/ # 独立 TOML 格式、字段映射与一次性 .env 转换；不导入 app 或数据库
├── backend/config.example.toml # 无真实密钥的配置示例；私有 config.toml 不提交、不打包
├── backend/app/
│   ├── main.py        # FastAPI 装配、生命周期与健康探针
│   ├── deps.py        # HTTP/WebSocket 会话、Studio 鉴权与 WorkspaceDep
│   ├── problem_details.py # 统一协议错误映射
│   ├── api.py         # `/v1` router 装配入口
│   ├── orm.py         # mapper 聚合与 Workspace 租户登记
│   ├── runtime/       # 配置、数据库、CAS/轮询、操作批回执、ID/时间工厂与 ORM Base（无业务语义）
│   ├── capabilities/  # 有契约的共享能力：identity、asset_store（VisualAsset ORM + files/媒体 schemas/routes）、agents、media_rendering、transcription
│   ├── console/       # Studio 治理、库级文件用例；自有 models/routes/schemas
│   │   ├── amadeus/   # 助手会话、引用快照、审批执行、沙箱脚本与模型桥接
│   │   └── creative_workshop/ # 跨 Workspace 公开创作版本、草稿、安装事务与文件校验
│   ├── apps/          # 已垂直切片的产品 App（含 live2d_workshop / desktop_pet）
│   ├── llm/           # 模型目录、供应商适配、共享生成/实时运行时、测试工作台、调用日志及自有 models/schemas/routes
│   ├── tool_navigation/ # 工具目录状态与桌面 Codex 模型源配置；自有 models/schemas/routes
│   ├── integrations/ # Workspace 工具 API、MCP、Skill；自有 models/schemas/routes
│   └── demo_runtime/  # 固定演示 Mock 运行时；自有 schemas/routes
├── db/migrations/
│   ├── versions/      # 只追加、不可改写的 SQLite migration
│   ├── registry.py    # 有序 migration 注册表与最新版本
│   └── runner.py      # checksum、连续前缀检查和事务应用
├── desktop/
│   ├── assets/       # 从项目品牌原图确定性生成的 macOS 主图标与 ICNS
│   ├── src/          # Electron 主进程、受限 preload、私有后端启动、稳定开发网关与生命周期
│   ├── ui/           # 本地启动/故障恢复窗口，不加载业务或用户数据
│   ├── backend/      # PyInstaller 入口；开发只读迁移检查、离线备份与继承数据锁
│   │   └── script_entry.py # Amadeus 独立无密钥脚本运行器入口
│   ├── scripts/      # 热加载监督器、源码检查、白名单打包、arm64/许可校验及 Electron 烟测
│   └── tests/        # 桌面来源与固定能力边界的确定性测试
├── web/src/
│   ├── app/           # Studio 入口、Session Context、路由、配置驱动工坊壳与应用注册表
│   ├── docs/          # Markdown 使用正文、分类与上下文目录、搜索、阅读器及旧链接映射
│   ├── features/      # 账号治理、首页、应用、文件管理、工坊、工具导航、集成中心与模型功能
│   │   ├── amadeus/   # 独立窗口 UI、Pi Worker、控件选取与原生动态头像源画
│   │   └── creative-workshop/ # 广场、创作、版本详情、能力选择与安装引导
│   ├── generated/     # OpenAPI 生成物
│   ├── platform/      # Cookie/CSRF、API 客户端、认证事件与浏览器语音基础设施
│   └── shared/        # 无业务归属的媒体处理、品牌与主题 UI；live2d/ 提供共用姿态计算与网格渲染
├── web/scripts/       # Web 构建与维护脚本；正式视频导出不在这里执行
├── web/public/docs/   # 文档中心使用的当前真实界面截图
├── web/tests/         # Web 组件测试
├── web/e2e/           # Playwright 浏览器旅程
│   └── fixtures/      # 人物旅程的确定性 API mock 与测试数据；真实烟测不使用
├── tests/             # 后端单元、API、存储与架构测试；大型 Story 契约/API 用例按行为拆分
├── vendor/pi/         # 固定 Pi Agent/AI/Chord/Telemetry 源码快照、来源与许可证
├── scripts/           # OpenAPI/LFS 检查、Agent Note 校验、配置转换、API 导入客户端、离线账号命令与 E2E 账号引导
│   └── demo/galgame_runaway/ # 内容专用演示维护工具；目标项目与素材路径必须显式传入
├── docs/assets/       # LFS 管理的文档/演示图片、来源许可证状态与内容集校验清单
├── docs/operations/   # 故障排查、备份与恢复说明
├── CONTRIBUTING.md    # 开发流程、边界、测试矩阵与交付检查表
├── CHANGELOG.md       # 交付批次的用户可见变化与工程治理记录
├── .runtime/          # 本机 SQLite 与运行期素材（已忽略，不提交）
└── .local/            # 统一本地工作区（已忽略，不提交）
    ├── scratch/       # 未定稿分镜、场景图与实验草稿
    ├── output/        # 本地导出与验收截图/视频/日志
    ├── tmp/           # 中间处理产物
    ├── downloads/     # 外源下载素材
    └── research/      # 与产品无关的调研草稿
```

## 目录与依赖边界

- `fpl_config/` 只拥有配置格式与文件转换。`runtime/config.py` 将 TOML 和进程环境映射到 Settings；
  `db/migrations/runner.py` 使用同一格式解析数据库路径，不依赖运行时 `app`。
  `scripts/migrate_config.py` 仅转换配置，不访问数据库；桌面入口在数据锁内执行旧配置一次性转换。

- `desktop/` 是现有应用的 macOS 壳，不拥有业务 API 或数据库 schema。
  Amadeus 使用无父窗口的单例 `BrowserWindow`；窗口位置保存于桌面数据目录，关闭仅隐藏。
  Electron 只转发可信 FPL 窗口上下文、控件引用、定位与截图，不持有模型凭据或业务操作。
  `scripts/dev.py` 持有跨进程更新的数据租约，`scripts/dev.cjs` 监督 Vite、源码检查与 Electron；
  `src/development-gateway.ts` 维护带凭据校验的固定开发入口，`src/development.ts` 只广播开发更新状态。
  `backend/development_data.py` 只做配置/迁移预检、停机快照与清单核验，不执行业务数据或 schema 写入。
  `app/DesktopDevelopmentHost.tsx` 只处理热加载查询刷新与未保存保护；应用更新与新建窗口入口在
  App 顶栏（`layout/DesktopAppChrome.tsx`），系统菜单栏不放这些自定义项；窗口标题仍可显示开发状态摘要。
  `src/agent.ts` 拥有本地 Unix Socket 转发及连接描述，`backend/cli_entry.py` 仅启动独立 SDK CLI。
  `console/governance/desktop_agent.py` 拥有短期配对，`desktop_ui.py` 校验打开资源的归属，Agent 操作白名单
  在 `console/governance/desktop_agent_operations.json`；`console/routes/desktop_agent.py` 只承担 `/v1/desktop` 协议边界。
  `sdk/python/src/future_props_lab/desktop.py` 负责发现和配对，`cli.py` 提供 `fpl` 命令。
  `app/DesktopAgentHost.tsx` 负责授权通知、外部更新提示及受保护导航，账号设置拥有接入开关。
  `console/governance/desktop_setup.py` 复用账号开通用例；`runtime/desktop.py` 只负责桌面凭据和静态托管。
  `web/src/features/accounts/DesktopSetupGate.tsx` 拥有首用表单，`platform/desktop.ts` 只定义固定桥接。
  桌面版配置和数据规则见 [macOS 桌面构建](../operations/desktop-macos.md)。

- `console/amadeus/` 拥有 `/v1/amadeus` 的会话、消息引用快照、Agent/Plan 运行、持久提问、参数摘要审批与执行记录；
  视频时间线执行由 `apps/video_editor/assistant_operations.py` 提供公共入口，在 `app/api.py` 装配，
  避免 Console 反向依赖工坊实现。`fpl_operations.py` 只允许调用桌面 Agent 明确登记的业务 HTTP 操作，
  由原路由重新校验 Workspace、权限和资源版本。
  `console/routes/amadeus.py` 只暴露协议。会话文件存于
  `workspaces/<workspace-id>/amadeus/<conversation-id>/{imports,scripts,outputs,tmp}/`，按账号与 Workspace
  读取隔离，文件访问拒绝符号链接和目录穿越。模型桥接仅使用现有供应商适配器和服务端凭据。
  `web/src/features/amadeus/` 拥有独立 `amadeus.html` 界面、Pi Worker、只读子任务、对话时间线与控件选取；
  `useAmadeusData.ts` 管理账号、Workspace 和会话范围内的读取与订阅，`revisionConflict.ts` 解释会话 CAS 冲突；
  `vendor/pi/SOURCE.md` 记录固定源码与许可证。沙箱脚本运行器由桌面构建单独打包，
  不复用携带后端凭据的服务进程。

- `llm/catalog/` 拥有供应商分组、接入连接与模型目录。`supplier_records.py` 提供工作区限定的
  分组读取及安全输出，`suppliers.py` 通过目录统一 CAS 执行分组写入；协议边界位于
  `llm/routes/models/suppliers.py`。供应商不持有密钥或启停状态，连接通过 `supplier_id` 显式归组。
- `web/src/features/models/catalog/` 拥有受控 `ModelCatalogEditor`、目录分类、供应商树和三层表单；
  `ModelServicePage` 适配工作区 API、缓存和冲突恢复，`WorkspaceDefaults` 负责默认用途选择与保存。
  管理中台通过数据、动作和字段权限复用编辑器，
  角色模板草稿、保存及同步由 `features/accounts/` 拥有；共用编辑器不直接请求 API 或持有 revision。
  页面、连接布局和弹窗样式分别由 `model-catalog.css`、`catalog-connections.css`、
  `catalog-dialogs.css` 维护。只读模型服务复用同一目录，隐藏写操作。
- 后端采用功能模块优先结构。`main.py` 负责装配；各包 `routes/` 只负责认证、请求校验、调用功能
  边界和响应映射，不直接导入 SQLAlchemy、ORM 模型或 migration。查询、写入和事务由
  `llm/catalog/`、`llm/playground/`、`llm/call_logs/` 等所属能力负责。
- `console/governance/provisioning.py` 是 HTTP 管理接口和离线账号命令共用的账号开通用例；账号、Workspace、
  Owner 成员关系、审计事件与新 Workspace 模型目录在同一事务内提交或回滚。`console/governance/service.py`
  不依赖模型目录实现。
- `capabilities/identity/permissions.py` 拥有固定角色与密钥范围交集，`capabilities/identity/route_permissions.py` 显式登记业务操作。
  `governance_transactions.py` 在短写事务中重验操作者并执行 CAS；`management.py`、`member_roles.py`
  分别拥有平台身份与成员授权，`errors.py` 和 `error_views.py` 定义领域错误与安全快照。
  `console/routes/account_management.py` 只适配管理查询、创建和审计协议。
- `web/src/features/accounts/` 拥有管理中台三个页面、账号中心和空间面板；空间概览与独立成员/角色/审计管理、收到的邀请弹窗由该模块协调，视图状态与账号设置标签分离；查询键由 `queryKeys.ts`
  统一维护。`AccountMenu` 与 `WorkspaceTrigger` 分别提供账号和空间入口，`AccountWorkspacePanel`
  只装配弹窗；资料、安全表单与空间设置、成员授权分开维护。工作台顶栏及布局样式归属
  `app/layout/StudioGlobalHeader`，中台外壳、统计与列表样式留在账号功能内。
  `platform/auth/` 提供有效权限 Context，`app/ReadOnlyRoutes.tsx` 只装配各业务模块自有
  的只读浏览入口，不挂载编辑控制器。共享预览和下载展示归属 `shared/ui/ReadOnlyMedia.tsx`。
- `capabilities/agents/harness/` 提供业务无关的 Agent Definition、消息/工具调用/Usage/适配器契约、上下文预算、
  Reactive 工具循环、Policy、Verifier、事件订阅、取消和内存审批；`phases.py` 原子化上下文编译、
  模型回合、工具提案、执行与审批阶段并保持事件顺序；不拥有项目数据，也不提供通用
  `/v1/agents` 管理接口。`llm/providers/` 是供应商协议差异的唯一实现边界，并反向实现 Harness
  定义的适配器契约。模型测试、诊断、REST/SSE 与 Web 消费端
  只依赖统一结果或事件，不根据供应商原始载荷控制运行行为；供应商管理界面展示配置属于例外。
- `llm/playground/` 拥有模型测试会话、测试工具、调用快照与流式结算。测试工具只执行 Workspace 内的
  确定性 Mock，不接入网络或外部系统；选择工具的文本会话复用 `capabilities/agents/harness/`，未选择工具的会话
  继续使用原单轮流式路径。Web 的工具管理页面和对话工具控件归属 `features/models/tools/` 与
  `features/models/conversation/`，不把工具逻辑堆入应用壳或通用 UI。
- `llm/providers/realtime/` 只拥有供应商无关实时桥接契约与 SenseAudio 协议适配，
  `llm/realtime/` 负责 Workspace 模型解析、短会话日志结算和浏览器 WebSocket 编排；
  `web/src/platform/voice/` 负责 16 kHz 采集、Silero VAD、回声参考打断和 24 kHz 缓冲播放。
  这些模块不拥有 Bot、工具调用、知识库、电话或持久化实时会话。
- 后端不增加通用 `services/`、`domain/`、`platform/` 或 `product/` 分层。需要拆分大型模块
  时，按具体业务能力在所属功能包内命名，避免同一职责出现多个事实源。
- 工具目录由 Web 静态注册表维护；后端 `tool_navigation/` 持久化稳定工具 ID 对应的收藏与
  最近使用状态，不复制工具名称、分类或外部网址。其 Codex 模型源用例仅在桌面私有传输内
  读取和修改当前用户的 `CODEX_HOME/config.toml`，不进入 Workspace 数据库。
- `integrations/` 拥有独立于工具导航的 Workspace 集成目录：`tool_apis/` 管理受限 HTTP 调用配置，
  `mcp/` 管理 Streamable HTTP/stdio 连接与工具快照，`skills/` 管理安全 ZIP 导入和不可变版本，
  `checks/` 只保存脱敏验证元数据。v1 只负责管理、发现和按需验证，不接入 Agent Harness 执行。
- `console/creative_workshop/` 拥有同一部署内共享的创作目录。草稿按作者和当前 Workspace 隔离；
  公开版本和方案包引用跨 Workspace 只读，不能经集成中心直接读取其他 Workspace 的配置。
  安装记录属于目标 Workspace，安装事务只复制已公开的允许字段和 Skill 文件；凭据留空，
  stdio MCP 待目标 Workspace 管理员填写本机命令。
- `apps/audio_annotation/` 管理 Workspace 级录音标注任务，根项目直接保存 `workspace_id` 并引用
  公共文件库中的音频；说话人/片段文档与最多双声道的预计算波形分别使用独立 revision CAS，
  选中片段可通过统一语音识别适配器执行一次性转写。识别参数、语言能力、文件上限和安全错误
  映射归属 `capabilities/transcription/`，录音标注、模型测试和 Galgame 只依赖该能力边界。
  删除任务不会删除原音频，被任务引用的音频不能从文件库删除。
- 应用目录同样由 Web 静态注册表维护， 应用最近访问记录只保存在浏览器本地。视觉创作工坊、
  Galgame 工坊、视频剪辑工坊、演示工坊、思绪工坊与录音标注工坊通过应用模块配置品牌、导航和 active 规则，共用 `app/layout/WorkshopShell`；侧栏展示由 `shared/ui/WorkshopSidebar.tsx` 统一拥有，
  包括品牌、返回卡片、图标导航和主题切换。思绪工坊复用该展示组件，知识库状态与目录仍由功能模块管理；录音标注工坊与演示工坊同样 `supportsProjects: true`，但只引用公共文件库、不拥有独立项目存储根。
  后端 `capabilities/asset_store/` 负责公共文件元数据、文件夹、存储校验、项目引用，以及三个工坊创建/删除时数据库与
  文件目录的一致性补偿，
  `apps/visual_workshop/` 负责真实项目、revisioned 节点画布、项目对话与图片/视频异步生成任务，
  `apps/galgame_workshop/` 负责 Galgame 工程元数据、Story 1.4 故事文档 CAS、Workspace 级旧 Story
  批量迁移与旧文件导入用例、剧情对话富文本、多人角色舞台演出、
  角色/多层场景/音视频素材生命周期、虚拟打包路径、语音识别任务、立绘尺寸快照恢复、Fragment 线路分析与
  只读 Story 快照驱动的视频导出与分层剪辑交接任务，
  `apps/video_editor/` 负责与 Story 解耦的微秒级多轨文档、类型化原子操作、项目素材快照、代理媒体、
  后端精确停帧和剪辑任务；`apps/motion_compositor/` 拥有特效项目、素材、文档 CAS、工程包、导出任务与显式剪辑交接，浏览器界面归 `web/src/features/motion-compositor/`；`capabilities/media_rendering/` 统一拥有 RenderPlan 契约、特效 RGBA 帧求值、文字排版与透明图层、共享 `assets/` 固定中文字体、确定性帧求值、固定帧网格的
  FFmpeg/Pillow 合成和取消控制。`video_sampling.py` 按源视频 PTS 选择包含当前时刻的画面区间，
  精确停帧与导出共享该采样规则。正式剪辑渲染只依赖不可变时间轴快照和原素材，
  不启动 Chromium、Playwright 或浏览器录屏；Pillow 只承担文字透明层和二维像素合成，音频 PTS
  与最终封装由 FFmpeg 统一处理。
  均不预置项目或素材。Studio 一级
  “文件管理”和项目素材浏览器复用同一文件 API；Galgame 上传图片、音视频与字体也复用公共存储、内容签名和媒体元数据校验，
  但只能通过 Galgame 工程素材 API 修改或删除。`capabilities/asset_store/document_references.py` 统一检查文档与知识库封面的公共文件删除保护。公共文件被视觉或 Galgame 工程引用期间禁止删除，
  对话消息引用的项目素材也必须先解除引用才能删除。

视频剪辑的节目监视器由 `VideoEditorPreview.tsx` 装配；`VideoEditorMediaLayer.tsx` 拥有媒体图层与图片显示，
`VideoEditorProxyVideo.tsx` 在定位和源区间校验完成后发布代理视频帧，保留画布上的上一张有效画面，
`previewGeometry.ts` 共用素材适配与图层样式，`previewClock.ts` 统一媒体时钟纠偏。
`previewPlayback.ts` 为相邻视频片段维护显示缓冲身份，连续源区间自由播放，跳剪重新定位；
同时参与视觉转场的伙伴使用独立播放器，真实空隙清空该缓冲。
后端 `apps/video_editor/runner.py` 由装配层分别注册 media 与 export 两个独立串行轮询通道，
素材预处理不等待长导出完成；每个通道只恢复自身中断任务，并分别参与后台健康检查。
`VideoEditorPreciseFrame.tsx` 保留已解码画面直到当前请求加载完成，工程与保存版本变化时清空缓存画面。
`transformModel.ts` 拥有变换几何、当前时刻求值与逐属性编辑操作，`usePreviewTransform.ts` 拥有指针手势、
临时草稿和提交取消，`VideoEditorTransformBox.tsx` 显示固定屏幕尺寸操作手柄。
`VideoEditorTransformFields.tsx` 将同一编辑契约接入属性检查器；草稿经编辑器显式传给预览与检查器，
不进入持久时间线。媒体层按画布裁切，操作框独立覆盖精确帧；所有写入仍经过时间线 CAS 保存队列。

视频剪辑时间线工具栏由 `VideoEditorTimelineTools.tsx` 拥有；`timelineGaps.ts` 检测可见画面轨的内部微秒空隙，
`gapEditPlan.ts` 规划延长与前移的关联片段最终状态，`gapFreeze.ts` 规划和准备显式定帧素材。
`VideoEditorGapPanel.tsx` 拥有筛选、选择、定位与提交前版本复核；整批复用既有原子操作、音频转场协调、
撤销历史与 CAS 保存队列，不改变吸附、波纹删除或变速跟随的语义，也不检测素材内部黑帧。

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
  `capabilities/asset_store/project_snapshots.py` 与 `capabilities/asset_store/project_folders.py` 拥有；画布、Story 和时间线的
  类型化投影、ID 重映射与模型语义匹配仍位于三个所属工坊。
- `runtime/project_records.py` 只提供显式 Workspace 谓词下的项目加载、revision CAS 更新和删除
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
  使用指南同时覆盖 Live2D、桌宠、导演台与特效制作；`articles/creative/` 拥有创意发布与安装，
  `articles/desktop/` 拥有多窗口、本地 Agent 和 Amadeus 操作说明。覆盖脚本发现全部使用正文，
  未登记入口或缺少核验依据时失败；组件测试比对实际应用注册表，防止新增应用遗漏指南。
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
- `.agents/notes/` 只保存工程决策的 why/alternatives/consequences/verification；产品文档中心正文仍由
  `web/src/docs/` 拥有，文档中心配图仍由 `web/public/docs/` 拥有，SDK/API 文档生成入口为
  `scripts/generate_sdk_docs.py`，这些内容不能通过 Note 整理迁移或改写。
- 根 `/health`、`/ready` 是无版本探针，其他业务路由由统一的 `/v1` router 注册。
- `console/governance/` 负责账号与 Workspace 用例；请求通过 Cookie Session 或绑定单一 Workspace 的
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
`applications/video-editor/projects/<project-id>/{assets,derived,exports}/`；特效制作项目使用
`applications/motion-compositor/projects/<project-id>/{assets,derived,exports}/`。项目目录只保存素材、
派生文件和正式导出结果，不保存快照历史；标题变化不改变目录。模型测试对话图片保存在 `model-test/attachments/`，生成参考
素材及语音识别输入的任务私有副本保存在 `model-test/references/`，生成结果保存在 `model-test/generated/`。
Skill 的可编辑标签保存在 `integration_skills.tags`，与目录配置共用 revision/CAS，
不属于内容版本；文件存储显式使用已鉴权 Workspace。
集成中心前端的 `features/integrations/queryKeys.ts` 统一管理目录、详情、版本与工具列表缓存；
`IntegrationInteractions.tsx` 和 `interaction.ts` 拥有草稿保护、外部更新与页面定位回执。
桌面操作登记表逐项开放现有集成 API；目标校验归属 `console/governance/desktop_ui.py`，不开放任意 URL
或系统命令。工具 API、MCP 和校验记录用例显式接收已鉴权 Workspace。

Skill 不可变版本保存在 `workspaces/<workspace-id>/integrations/skills/<skill-id>/<version>/`。
创意工坊封面、Skill 草稿与公开版本分别保存在
`workspaces/<workspace-id>/creative-workshop/{covers,skill-drafts,skill-releases}/`；
目标 Workspace 安装后的 Skill 副本回到其 `integrations/skills/`。备份数据库时必须同时保留
整个 `workspaces/` 树，才能恢复创作封面、公开 Skill 版本和安装副本。
本地临时分镜、场景图、导出结果、下载与研究草稿统一放在仓库根目录 `.local/`
（`scratch/`、`output/`、`tmp/`、`downloads/`、`research/`），与 `.runtime/`
一样被 git 忽略，不进入文档资产或产品素材真源。FastAPI 启动时自动创建
目录并执行 `registry.py` 中已登记、带 checksum 的 migration；每个连接启用外键约束、WAL
与忙等待。迁移历史只追加且不导入运行时 `app`，schema 变化必须同时更新 ORM、注册表、测试
和文档。`r0019_project_storage_layout` 只增加存储版本；旧文件由受鉴权的显式迁移 API 校验并搬迁，
schema migration 不执行文件 I/O。

目录配置、模型测试会话、测试工具与生成任务、视觉工坊项目、含节点级生成草稿和动态连线的节点画布、项目对话、文件夹、文件和项目引用
使用 revision/CAS 防止静默覆盖；Galgame 工坊工程元数据与整份故事文档分别使用 revision/CAS，
故事冲突保留服务器完整快照，完成态工程在故事修改后恢复草稿。Story 1.4 的角色、素材、国际化、
时间轴、流程与表现层交叉校验由 `apps/galgame_workshop/schemas/story_validation.py` 的纯函数拥有；
旧 Story 1.0–1.3 的格式转换只由
`apps/galgame_workshop/schemas/story_legacy.py` 适配器拥有；`apps/galgame_workshop/story/story_migrations.py`
通过正式 `/v1` API 执行状态预检、受 Workspace 约束的批量 CAS 固化和单工程旧文件导入，不以
schema migration 或直接数据库修改替代运行期迁移。工具单项状态通过幂等更新和原子 upsert 写入。图片/视频/音频生成任务持久化
供应商/模型快照和规范化参数，FastAPI 生命周期中的单机执行器负责恢复、轮询与安全下载；视觉工坊
和模型测试复用 `runtime/polling_runner.py` 的生命周期与并发控制，并由
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

后端 `multitable/` 拥有多维表格的独立 ORM、类型化契约、字段转换、受控 SQLite 查询、原子批次、CSV、差量历史及 version 7 备份重映射；`content.py` 投影当前数据用于静态导出。`routes/multitable.py` 适配 Workspace API；`publication/tables.py` 在独立会话分别校验父文章与目标表格授权，`routes/community_tables.py` 与社区路由一起装配，避免继承普通 Workspace 权限。文档根 `ThoughtNote.kind` 默认 note，子实体通过已验证根继承 Workspace 与生命周期。

Web `features/thought-workshop/multitable/` 拥有 TanStack Table/Virtual 网格、看板、月历、字段/视图配置、记录编辑、CSV、历史、嵌入节点和静态内容导出；所有缓存键继续由现有 `queryKeys.ts` 维护。`useTableDocument.ts` 合并连续编辑、串行提交并保存按账号/访问上下文/文档/标签页隔离的 IndexedDB 待保存操作；`saveLane.ts` 协调当前页面的提交顺序，服务器 CAS 判定跨标签页冲突。当前表、视图、滚动位置与侧栏折叠是个人阅读状态，视图配置是共享文档数据。`Navigation.tsx` 拥有容器响应式数据表导航和视图标签，`Toolbar.tsx` 通过回调提供配置与记录操作；`ColumnResize.tsx` 只在拖动结束提交列宽，`FieldValue.tsx` 显示主题安全标签。`ViewSettings.tsx` 保存一份跨页签草稿；`FieldForm.tsx`／`FieldEditor.tsx` 共用类型配置并拥有表头浮层，`field-settings.css` 拥有对应布局；`formatting.ts`／`fieldChanges.ts` 分别拥有展示投影与草稿合并；`grid.css` 拥有网格和单元格呈现，`multitable.css` 拥有导航、其他视图与弹层样式。

`publication/` 拥有同部署知识社区的发布、目录过滤、逐篇授权、收藏和素材访问；`routes/community.py` 仅做浏览器 Session 协议适配。发布记录直接保存源 Workspace，成员授权仅作用于已发布文章。`Community` 为每次操作创建独立会话，授权后显式绑定源空间调用 `Notes`；写入采用短事务串行化权限检查、撤回与正文 CAS。`lifecycle.py` 在源回收站事务内关闭文章或整库，恢复不自动重新发布。迁移 `0082_thought_publications` 只建发布表，不复制正文、不自动公开现有内容。

Web `community/` 拥有精选书架、发布与权限弹窗及社区阅读入口；`DocumentAccess.tsx` 是普通与社区保存、引用、上传、素材读取和导出的显式适配接口。`KnowledgeSidebar`、`KnowledgeTopbar`、`NoteReaderPane` 统一目录、顶栏和富文本阅读布局；官方与普通发布使用同一富文本阅读器，旧地址由授权后的发布映射解析。社区缓存、草稿和阅读位置按账号及发布资源隔离，权限失效停止保存并保留本机草稿。搜索、计数、反向链接与导出只返回可访问的当前文章，隐藏父文档的子文章提升到可见目录顶层；未发布首页使用社区简介。

`DocumentOutline`、`outlineHeadings.ts` 与 `useDocumentOutline` 负责从当前编辑器提取章节、
左侧留白布局和滚动定位；`document-outline.css` 拥有常驻目录及窄屏浮层样式。
目录及临时展开折叠内容只属于界面状态，不写入正文或修改 revision。

`apps/thought_workshop/link_preview.py` 拥有匿名公网网页元数据读取及连接地址校验；
`LinkPreviewCard`、`useLinkPreview` 与 `useLinkPreviewPosition` 在编辑和只读正文共用悬浮交互，
样式归 `link-preview.css`。预览不进入正文或数据库，缓存键由 `queryKeys.ts` 按 Workspace 和 URL 管理。

文档历史由 `apps/thought_workshop/history.py` 拥有快照与分页，`history_archive.py` 拥有备份历史校验和重映射；`notes.py` 在正文 CAS 事务中记录与还原内容。迁移 `0049_thought_history` 为现有文档建立作者未知的历史起点，历史附件独立引用并参与公共文件删除保护。历史全部保留，文档永久删除时级联释放。

Web 的 `NoteHistory` 复用现有只读 `RichEditor`；`historyDiff.ts` 负责有界块对齐与文字差异，`HistoryDecorations` 仅在预览中叠加标记，`history.css` 拥有列表和修改痕迹样式。历史模式不修改编辑草稿，唯一历史缓存键仍由 `queryKeys.ts` 维护。

`apps/thought_workshop/knowledge_tools/` 拥有引用索引和解析、SQLite 检索、独立模板与原子子树复制、历史命名标记、账号偏好及一致导出快照；`archive.py` 拥有 version 6 模板与标记的校验和重映射。`routes/knowledge_tools.py` 只做协议适配。新增表由 `0080_thought_knowledge_tools` 登记，不改变旧迁移。

Web `knowledge-tools/` 拥有引用与提示块节点、查找替换、跨库发现、模板与复制对话框、关联文档、阅读位置和整库 HTML 打包；`drafts/storage.ts` 以账号、Workspace、文档、标签页隔离 IndexedDB 草稿。`useNoteResults.ts` 统一编辑和只读入口的 40 条分页。个人状态经 Principal 访问，官方正文也是已发布笔记；阅读偏好不修改正文。画板 version 2 的确定性锚点、文字和连线路径归 `diagrams/model.ts`，React Flow 只承载交互。

`backend/app/apps/thought_workshop/` 拥有文档项目、目录、正文、回收站与文件备份。这里的「知识库」是文档项目容器的名称，不提供模型检索或文件内容解析。普通目录沿用 Workspace 权限，社区发布有明确的逐篇授权边界。

- `knowledge.py`：知识库元数据、封面归属、首页创建、库级 revision/CAS、整库删除与恢复。
- `directory.py`：库内嵌套文档树、移动排序、循环校验；移动正文归属时推进文档 revision。
- `notes.py`：显式知识库归属下的正文读写、自动保存冲突快照、文件引用投影。
- `attachments.py`：附件上传；公共类型与签名校验由 `capabilities/asset_store/policy.py` 拥有。
- `portability.py` / `archive_structure.py`：v3 备份的预检、磁盘暂存、短事务与失败补偿。
- `legacy_import.py`：唯一的 v1/v2 备份转换边界。生产读写没有旧笔记本模型、接口或默认知识库回退。
- `schemas/document.py`：无业务依赖的富文本允许列表、搜索文本与文件引用投影；正文保持 v2。

`web/src/features/thought-workshop/` 拥有知识库卡片、首页阅读与编辑、多级目录、保存队列、格式转换与唯一 `queryKeys.ts`。AI 写作仅经后端 API / SDK / Agent skill 接入，应用内无入口。`KnowledgeSidebar` 将库切换、搜索、直观筛选入口和独立滚动目录融入旧版侧栏；筛选结果在右侧显示，离开编辑器前沿用保存保护。`KnowledgeTree` 提供拖动与键盘菜单；旧笔记 URL 只根据文档 ID 跳转到包含知识库 ID 与文档 ID 的新地址。共享项目卡片的可选封面与元信息保持其他应用默认行为。

样式按职责分为 `knowledge.css`（项目列表与知识库布局）、`knowledge-results.css`（全部文档 / 最近编辑等筛选列表）、`thought-workshop.css`（保存冲突等）、`writing-layout.css`（编辑布局与标签）、`editor.css`（正文与工具栏）、`attachments.css`（文件卡片），所有覆盖限定在思绪工坊。共享侧栏样式位于 `shared/ui/workshop-sidebar.css`；`CustomSelect` 默认使用自绘顶层菜单避开目录滚动裁切，并根据可见视口向上或向下展开，保留原 DOM 焦点范围。

根知识库与文档显式保存 Workspace；子目录继承已验证的知识库归属。所有请求通过 `WorkspaceDep` 获取租户，模型注册中的租户过滤仅作额外防护。正文使用文档 revision，目录与库元数据使用库 revision，跨层修改在同一短事务中完成。

`thought_note_assets` 保护正文图片和附件，知识库封面通过外键与文件库用例保护，包括回收站。迁移 `0046_thought_knowledge_bases` 将每个有旧数据的 Workspace 转为「我的知识库」，旧笔记本成为顶层文件夹，移除旧表与字段，保留文档 ID 和所有内容。空空间不创建默认项目。迁移无运行时 app 依赖，并已在隔离数据库验证后登记。

## 前端屏幕适配

`shared/ui/ResponsiveSidebar.tsx` 拥有主控制台与普通工坊的单实例抽屉外壳；品牌、业务导航和账号入口仍通过原组件提供。`ViewportBounds.tsx` 同步可见视口高度和偏移，供软键盘出现时的面板与菜单约束使用。`useDrawerFocus.ts` 统一抽屉/弹窗的键盘范围与焦点恢复；`CompactPanelTabs` 仅提供面板切换展示，不拥有编辑器实例、文档或播放状态。`QueryFeedback` 展示加载失败及重试。

视频、Galgame、录音标注与模型测试的布局状态和适配 CSS 留在各自功能目录。Galgame 的独立预演也保留舞台、台词队列和检查器，布局规则由 `editor/fast-preview-compact.css` 拥有。紧凑面板通过 CSS 控制可见性，切换屏幕尺寸不重建业务控制器。思绪工坊侧栏背景随整页延伸，内部导航固定在可用视口。全站不使用根级横向溢出隐藏代替宽度修正。

`web/e2e/responsive-inventory.ts` 维护全部应用路由与独立入口的适配归属；`responsive-site`、`responsive-editors`、`responsive-panels`、`responsive-states` 分别负责入口、编辑工作区、账号/公开页/模型子面板及请求状态矩阵，`responsive-forms` 检查表单及嵌套菜单。`responsive-capture.ts` 检查页面宽度和可见弹层边界并保存实页截图。`web/tests/responsive-coverage.test.ts` 对路由联合类型与 HTML 构建入口执行遗漏检查；`viewport-bounds.test.tsx` 验证模拟可见视口收缩时的菜单定位及监听清理。验收记录见 `docs/reference/responsive-verification.md`。

## 平台治理补充职责

- `backend/app/console/governance/platform_policy.py` 解析即时敏感策略；`platform_settings.py` 拥有平台配置 CAS；`registration.py` 拥有邀请码名额与注册事务。
- `console/governance/model_templates.py`、`model_template_sync.py` 拥有角色目录模板、预览与逐空间持久同步；`demo_services.py` 拥有固定测试服务治理与工作区接入。
- `console/governance/runtime_quotas.py` 拥有并发额度领取与恢复；`runtime/task_admission.py` 只定义任务创建事务的归属回调类型；各功能用例在提交任务前调用它。
- `console/governance/developer_docs.py`、`cross_workspace_logs.py`、`project_certification.py` 分别拥有受保护文档、显式跨空间概况、官方认证。`ModelTemplateSyncItem` 和 `RuntimeAdmission` 属于平台治理记录，跨空间访问由这些正式用例显式校验，不使用业务自动租户过滤。
- `backend/app/demo_runtime/runtime.py` 只实现应用进程内的固定 Mock 文本与演示工具运行时，不启动子进程；模型适配器和工具集成将明确的本地测试连接交给它。
- `llm/catalog/defaults.py` 校验并保存当前工作区默认模型，与目录共用 CAS 版本。
- `web/src/features/accounts/` 拥有七个管理页面、平台查询键、跨空间查询、邀请/模板/权限/服务表单与官方认证交互；应用壳仅负责路由装配。`features/models/catalog/WorkspaceDefaults.tsx` 拥有工作区默认用途弹窗。
- `db/migrations/versions/r0051_platform_governance.py` 至 `r0055_model_suppliers.py` 按已登记顺序追加治理数据结构，迁移测试使用临时数据库。

调用日志页面的工具栏、筛选抽屉和表格由 `web/src/features/models/logs/` 拥有；
`features/accounts/useLogWorkspaceScope.ts` 对外提供授权工作区范围与只读概况查询，查询键归账号模块。
`backend/app/console/governance/cross_workspace_logs.py` 显式校验跨工作区范围；
`llm/call_logs/query.py` 仅复用列表筛选谓词及 UTC 今日统计，不承担授权或跨空间事务。

## 演示工坊

`backend/app/apps/presentation_workshop/` 拥有文稿项目、图片归属校验、引用同步和请求内导出。
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

## 导演台

`backend/app/apps/director_desk/` 拥有 Workspace 项目记录和用户动作库。
`director_desk_projects.document` 是编辑器写出的瘦 JSON：戏段、实体和资源引用。
模型、贴图和视频按内容 SHA-256 放在 `applications/director-desk/projects/{id}/files/`，
不进入 SQLite，也不给共享 `VisualAsset` 增加外键。
`director_desk_user_motions` 只保存动作元数据，模型包放在 `applications/director-desk/library/`。
迁移 `r0064_director_desk` 建立项目表，`r0065_director_desk_motions` 追加动作表。
`web/src/features/director-desk/` 拥有项目列表、`.director` 导入导出和三维编辑器，查询键在 `queryKeys.ts`。
编辑器的 `model.ts` 是类型及公共入口，`model-constants.ts`、`model-creation.ts`、`model-validation.ts`
分别维护常量与复制、对象创建、项目校验；`assets/catalog/shape-types.ts` 保存资产形状契约，
`cinematography/camera-effects-types.ts` 保存镜头效果类型，`scenes/scene-document-types.ts` 保存戏段快照类型，
`spatial/scene-view.ts` 定义空间报告所需的只读场景接口。编辑器实例用 AbortSignal 管理监听器生命周期。
`editor/editor/scene-sampling.ts` 拥有单帧实体动画、接触、视觉、光照与镜头采样，`engine.ts` 保留资源生命周期与交互装配。
编辑器基础控件样式保存在 `style.css`；`ui/editor-workspace.css`、`ui/editor-timeline.css` 与
`ui/workspace-responsive.css` 分别拥有面板与视口、时间线、响应式与调整布局，入口按原级联顺序加载。
编辑器内存仍使用内嵌字节；保存前换成文件引用，打开时再还原。
外部 Agent 经 `fpl` 调用项目、文件和动作库；场景工具只在该工程的编辑器已打开时执行，不另建 MCP。

演示工坊的 `image_crop.py` / Web `imageCrop.ts` 分别拥有相同的原图区域到图片框的等比填充计算，
使用 `tests/fixtures/presentation_crop_cases.json` 共用测试向量。图片尺寸仅在读取素材后取得，
不进入文稿结构；浏览器缩略图和放映共用渲染器，PPTX 使用经 EXIF 校正后的素材尺寸。

图片与矢量素材的校验、预检与规范化归属公共 `backend/app/capabilities/asset_store/svg.py`，只支持受限自包含 SVG；
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

视觉画布的 `canvasClipboard.ts` 拥有选区深拷贝、外部连线引用清理、节点与连线身份重映射及粘贴边界检查；
`useCanvasClipboard.ts` 管理当前项目内的临时剪贴板、连续粘贴偏移与反馈，所有复制入口共享同一逻辑。
`CanvasSelectionActions.tsx` 展示多选复制及符合条件的宫格合成操作，合成状态仍由 `useImageGridComposition.tsx` 拥有。
副本保留素材和生成草稿，解除原任务及批次关联；整组粘贴通过画布快照提交一次 CAS 并形成一次撤销记录。
剪贴板不持久化，离开画布后失效；浏览器旅程由 `canvas-clipboard.spec.ts` 覆盖。

## Python SDK 与自动化

- `sdk/python/`：可独立构建安装的 `future-props-lab-sdk`；`src/future_props_lab/generated/` 只保存生成模型和具名资源方法，其他模块拥有 HTTPX 通信、流、鉴权、实时语音和本地文档构建器。
- `sdk/python/operations.json`：受版本控制的 HTTP 操作到稳定 Python 方法名映射；`coverage.json` 记录契约与文档证据，不能替代业务闭环验收。
- `scripts/generate_sdk.py`、`scripts/generate_sdk_docs.py`：从 OpenAPI 与方法映射生成 SDK 和公开模块参考；纳入 `contracts:generate` 与 `contracts:check`。仅浏览器 Session 的知识社区操作不加入 SDK 方法映射，相关 HTTP 数据类型仍由 OpenAPI 生成。
- `backend/app/llm/inference/`：独立模型能力查询、输入素材、文本调用、任务与结果管理；`llm/routes/model_inference.py` 只处理协议。
- 工坊各自的 `operations.py` 拥有细粒度编辑校验与一次事务；`runtime/operation_receipts.py` 仅提供持久化回执原语，`entity_edits.py` 仅提供纯列表编辑。
- `backend/app/llm/models/model_inference.py` 与 `models/project_operations.py` 对应追加迁移 `0059_project_operations`、`0060_model_inference`。
- `web/src/features/models/inference/`：调用日志页中的独立任务查询、下载、转存与结果落盘重试入口；缓存键归属 models/queryKeys.ts。
- `web/src/docs/articles/sdk/`：公开 SDK 教程及生成方法参考；开发文档仍经已授权接口加载。
- `backend/app/apps/thought_workshop/markdown_conversion.py` 与 `content_exports.py`：受控 Markdown 转换、静态 HTML 和含素材导出；`schemas/conversion.py` 描述正式契约。
- `backend/app/apps/audio_annotation/exports.py`：项目 JSON、SRT、已保存片段裁切与识别用例。
- `backend/app/capabilities/asset_store/video_frames.py`：工作区文件的逐帧提取；确定性音频裁切与视频取帧实现归属 `media_rendering/audio_clip.py`、`video_frames.py`；HTTP 适配在 `capabilities/asset_store/routes/video_frames.py`。
- `web/src/docs/DocsExamples.tsx`、`DocsReadingProgress.tsx`：受控代码切换与阅读进度；目标阅读入口使用 `rendering/` 的 CardGroup；模块参考按业务模块分包，保留完整搜索内容。
- `sdk/python/src/future_props_lab/workshop_examples.py` 与 `sdk/python/workflows.json`：六个工坊可执行流程及业务证据，公开文档从样例源码生成；验收边界见 `docs/architecture/sdk-automation-coverage.md`。
- `sdk/python/src/future_props_lab/canvas_example.py`：独立的笔记信息图 SDK 示例，通过正式 API 创建与导出可编辑画板；不参与既有六工坊文档生成，契约回归由 `tests/test_thought_canvas.py` 覆盖。
- `skills/future-props-lab-automation/`：官方自动化 Agent Skill 包（根 `SKILL.md` 名 `future-props-lab-automation`）。叶子 skill 目录名必须等于 frontmatter `name`，可单独或组合安装；每个叶子内联「前置」与最小 `fpl` 示例。校验：`python3 skills/future-props-lab-automation/scripts/validate_skills.py`。只指导通过 `fpl`/SDK 操作产品，不修改本仓库源码；见该处 `README.md`。
- `.agents/skills/watch/`：仓库级第三方视频分析 Agent Skill，包含中文通用指南、基于固定上游的通用脚本、许可证与固定提交来源记录；仅供 Codex 在本仓库发现，不参与 Future Props Lab 产品构建。应用内 Skills 通过正式 ZIP 导入 API 单独管理。
- `skills/future-props-lab-automation/skills/thought-workshop/research-to-document/`：产品使用与技术／论文调研 Skill；普通父笔记直接承载报告，子文档用已有多维表格组织资料、比较与验证，正文引用精简嵌入视图。`references/` 拥有记录与存档契约，`assets/` 提供两类成文模板、恢复快照与原生 TableSpec，`scripts/check_project.py` 只读校验引用与状态。正式存档复用思绪工坊 CLI/SDK，不增加专用调研页面、应用内 AI 写作入口或后台调研服务；原型、截图与打包验收产物位于 `.local/research-workbench-preview/`。
- `skills/future-props-lab-automation/skills/visual-workshop/visual-character-replacement/`：人物与可选场景替换制作流程；`references/` 拥有镜头规划、review、记录与 App 适配说明，`assets/templates/` 拥有同源的 JSON、六类文本监督模板和 HTML 对照页，`scripts/` 拥有标准库本地记录校验、版本绑定、反馈合并及渲染。工具不调用 App 或模型，正式同步仍经授权 API；ZIP、演示媒体与验收产物只在 `.local/` 下生成。
- `backend/app/capabilities/asset_store/image_crop.py` 与 `capabilities/asset_store/schemas/image_crop.py`：公共文件的像素裁剪、边界与透明度规则，返回 PNG 后由调用者显式转存；HTTP 适配在 `capabilities/asset_store/routes/image_crop.py`。

### Live2D 工坊

`web/src/features/live2d-workshop/` 拥有角色项目管理、PSD Worker、PixiJS 网格编辑、参数关键形、动画 UI、Cubism 对照预览和尽力转换。`web/vendor/cubism-sdk-5-r5/` 保存用户提供的官方 SDK Core、Framework 源码与本地构建；`web/public/cubism-shaders/` 保存对应 WebGL 着色器。`backend/app/apps/live2d_workshop/` 拥有 Workspace 项目 CAS、素材、Cubism 附件、工程包与导出任务；`backend/app/capabilities/media_rendering/live2d/` 拥有版本化角色文档、确定性参数/变形器求值和 Pillow 三角纹理渲染。素材与输出位于对应 Workspace 的 `applications/live2d-workshop/projects/<id>/{assets,exports,cubism}/`。迁移 `r0071_live2d_workshop` 登记角色工程、素材与任务；`r0073_live2d_cubism_attachment` 登记附件。Cubism 编译、原生物理、视频和外部输入驱动未启用。

`web/src/shared/live2d/` 提供工坊与 Amadeus 头像共用的纯姿态计算、类型和 PixiJS 网格装配。内置 Amadeus 的原画由 `scripts/build_amadeus_model.py` 打包成 `web/public/brand/amadeus/amadeus.fpllive2d`，用户可通过现有工坊导入 API 主动创建可编辑副本；助手窗口直接读取随应用提供的工程包，不依赖用户 Workspace 项目。

`backend/app/apps/desktop_pet/` 拥有桌宠项目、固定 Live2D 角色快照、分层角色本地导入包校验、皮肤 PNG、台词与配置 CAS；`whale_package.py` 按缺省鲸鱼娘或可选 `human-chibi` 骨架验证必要部件与角色资料，沿用原数据 ZIP 与素材路径。`chat.py` 拥有按账号和 Workspace 隔离的聊天会话、请求防重放与消息记录，迁移 `r0079_desktop_pet_chat` 登记三张聊天表，`r0081_desktop_pet_presentation` 追加个人展示偏好，旧会话保留对话模式、新会话默认气泡。文字模型调用通过 `backend/app/llm/text_client.py` 的公共入口完成，保留调用日志，不使用模型测试会话。Live2D 来源只通过 `apps/live2d_workshop/public.py` 的 Workspace 只读入口取得。素材位于当前 Workspace 的 `applications/desktop-pet/projects/<id>/assets/{source,skins,whale}/`，迁移 `r0077_desktop_pet` 登记根项目，`r0078_desktop_pet_whale` 扩展来源类型。`scripts/pack_whale_demo.py` 将显式指定的本地角色目录打包为数据 ZIP，不把角色贴图提交或随应用打包。`web/src/features/desktop-pet/` 拥有项目页、台词与人设编辑器、PixiJS 预览、鲸鱼娘原版动态适配、`humanFigure.ts` 人物骨架与服饰适配、`humanFace.ts` 五官绘制与刘海遮挡、独立 `web/pet.html` 运行页与 `web/pet-chat.html` 聊天小窗；`whale-vendor/` 只保存 MIT 动画代码与许可，运行贴图从 Workspace API 读取。`EditorHeader.tsx` 拥有步骤导航、保存与桌宠重启的无状态控件，`EditorPage.tsx` 分别编排 CAS 保存和独立窗口关闭／重开，窗口启动不隐式保存草稿；`EditorStage.tsx` 拥有中央舞台、真实播放状态和舞台外能力反馈及联动入口，`useEditorPreview.ts` 管理选择、草稿变化、重播与计时，`playback.ts` 统一运行／调整／完整事件语义及实际渲染动作／表情能力；`useDesktopPreviewLink.ts` 与 `usePetPreview.ts` 分别拥有编辑器租约和桌宠授权快照校验，展示草稿仅在内存覆盖。`desktop/src/pet-preview-protocol.ts` 校验有界展示数据与素材 ID，`pet-preview-relay.ts` 管理单一所有者、递增序号、租约过期与聊天暂停，私有 IPC 由 `pet-window.ts` 校验主窗口、账号、Workspace 和项目。`humanFigure.ts` 兼容旧人物包，并为版本化关节分件装配固定父子树及侧向头部；`humanFace.ts` 集中绘制原有表情、视线与眨眼，已映射的侧眼素材保持自身宽高比，可按原图像素 sourceRects 取样，再按真实露出面部范围遮挡；完整姿态自带头部时五官跟随该姿态，避免独立旧颈部位移；`human_motion.py` 校验骨段、锚点、UV 与素材引用。`chatPresentation.ts` 拥有原文气泡摘要，`useChatWindowLayout.ts` 管理同窗布局及透明命中，聊天文本不通过角色动作 IPC 重复展示；接触阴影由 `whale-vendor/shadow.js` 统一计算。`desktop/src/pet-window-geometry.ts` 与 `desktop/src/pet-window.ts` 约束单只透明窗口、聊天小窗跟随、点击穿透和多屏可用区；主应用负责手动启动及关闭。`desktop/scripts/inspect-companion-chat.cjs` 验证两种聊天呈现与保存，通过实际腰部投影执行拎起／松手并严格检查阴影消失／恢复，记录手势、截图与聊天暂停位置；`desktop/scripts/inspect-human-pet.cjs` 在隔离烟测中渲染人物动作、表情和真实步周期的明暗背景验收图；`inspect-pet-preview.cjs` 验证草稿联动、保存、退出恢复及聊天暂停；本地角色原画、图层和资源包只保存在被忽略的 `.local/desktop-pet/<character>/`。
分层绑定审阅草案由 `scripts/build_amadeus_rig_draft.py` 和 `scripts/write_live2d_review_psd.mjs` 生成到 `.local/output/live2d-rig-review/`，`scripts/check_amadeus_rig_draft.py` 校验包与像素；草案在用户验收前不替换内置运行工程。

人物服饰贴图缓存由 `humanFigure.ts` 按素材键去重加载与上传，独立部件保留各自裁切和几何；失败缓存仅在仍属本请求时释放，用户重新选择才重试。`WhaleRenderer.tsx` 消费换装结果并显示当前实例的失败反馈，旧选择、旧资源和卸载后的回调不覆盖当前提示；缓存和提示均不写入项目配置。

`locomotion/measure.ts` 为每个 `WhaleRenderer.tsx` 实例持有一个懒创建的 80×100 alpha 采样画布，每次先清空再读取当前已绘原画和屏幕矩阵，不缓存可见范围；卸载释放其 backing surface，开发 StrictMode 重挂可再次创建。部分作者接触点按当前镜像方向映射到屏幕四边，缺失边使用对应屏幕边的可见范围回退，支撑能力沿用同一方向映射。

`locomotion/usePetLocomotion.ts` 在运动边界将渲染协议失败转为带 code、kind 和 severity 的反馈；明确缺少动作／过渡资源时保留画面并暂停轨迹，支撑、确认位移及通信失败仍作为错误。`PetRuntime.tsx` 消费反馈显示资源提示或异常，不按中文内容反推失败类型，不持久化运行提示。

正常放置的画面交接由同一 hook 持有取消代次，通过 `PetRendererHandle` 的开始、提交与取消接口通知渲染器。`WhaleRenderer.tsx` 提供真实窗口屏幕原点并使几何采样缓存随实际绘制失效；`whale-vendor/pet-core.js` 在宿主移动与新帧之间保持最后已绘画面的世界位置，非拎起输入消费后再释放。模型缩放不参与屏幕位移换算，失效代次和资源 revision 不能提交旧交接；不增加持久字段或桌面桥消息。

`humanFigure.ts` 以同一确切隐藏部件集合控制旧姿势回退与版本 1 的运行纹理引用闭包，仅跳过永久隐藏部件独占的贴图，保留共享站姿、坐姿、服饰与五官。完整模型、网格与资源包校验不缩减，版本 2 的加载路径不变。

`WhaleRenderer.tsx` 在事件及聊天反应入口按资源结构与已知动作 ID 校验能力；`whale-vendor/pet-core.js` 通过公开拒绝接口停止旧反应物理并保留实际已绘根位置，手动运动与放置恢复优先。`sequences/figure.ts` 独立保留最后完整帧和播放时钟，不加载被拒绝的同名片段；有效新反应清除拒绝状态，素材与支撑错误仍优先反馈。不冻结事件或表情计时，不改变宿主确认、项目配置或公共契约。

完整帧包装构造成功前，`WhaleRenderer.tsx` 的初始化器持有已加载基础渲染器；包装失败显式释放基础资源并保留原异常，成功后由包装实例负责释放。`EditorPage.tsx` 在用户确认放弃后同步解除自身导航拦截，再执行已确认离开，不调用保存或修改持久基线；取消仍保留草稿。

`web/src/features/desktop-pet/locomotion/` 拥有纯轨迹与手势控制器、实际像素可见范围测量、单请求在途的宿主通信、旧桥兼容及虚拟工作区试玩；控制器统一取消行走、攀爬、滑翔和拎起，不由运行页写入动画引擎内部状态。`platform/petMotion.ts` 定义私有运动帧与环境契约，`desktop/src/pet-motion.ts` 校验序号、取消代次和可见边界，`pet-window.ts` 校验可信桌宠主窗口及显示器工作区；独立 `onPetMotionConfirmed` 只读事件反馈实际移动后的序号、代次、位置和画布补偿，不能复用会取消轨迹的外部环境变化事件。`desktop/scripts/inspect-pet-motion.cjs` 在隔离数据中记录位置回执、实际连续帧及明暗姿态图；`phases.ts` 统一动作阶段及支撑时序，`articulation.ts` 拥有双骨段求解、接触锁定、腰部折叠及平滑衔接，`whaleRig.ts` 适配鲸鱼原画的骨段与坐姿保留；`whaleAuthored.ts` 拥有新鲸鱼包的专属姿势层绑定、原生面部投影和能力反馈，复用有界关节求解而不套用人物表情纹理；`whale-vendor/whale/textures.ts` 拥有配色在途缓存、失败重试与按素材 ID 去重加载；`edges.ts` 拥有四边接触平面、进入／退出阈值及角落优先级；控制器等待最终放置回执及放下反应，再管理贴附、附着休息和转角，只有行进方向前方的边界触发转边。`authoredPose.ts` 拥有版本 2 的姿势绑定和受限关节；`poseSkin.ts` 根据动作用途编译完整素材及独立四肢的蒙皮：完整拎腰的小幅惯性保持连续表面与肩胯渐变，接触动作按区域分别编译；`whale-vendor/rig/meshGeometry.js` 校验和编译固定网格、区域边界及共享 UV，`rig.js` 只消费已编译几何和权重；同模块的 `posePartIds` 收集姿势素材引用，`bindPoseParts` 为可选独立头部及三段刚性四肢建立固定关节绑定，不改变资源中固定为 `body` 的父级描述；步态收步保留同一姿势，通过短步交接支撑后回到安全中立膝角，外层呼吸缩放不影响已登记关节或足底。`walkStart.ts` 管理已登记步态的首次支撑交接，`walkArmPose.ts` 按原始手臂轴计算受限摆臂，`heldRecovery.ts` 保留原画静止关节角度、有限拖动惯性、同姿势重抓和松手恢复窗口；`supportHeight.ts` 计算固定鞋底和关节限制下的共同身体高度区间；`walkSupport.ts` 提供按确认位移预检连续支撑窗口的独立控制器，保留实际快照、固定世界支点及交接先后，不在运行时逐帧投影身体；`walkRuntime.ts` 将它接入具备完整鞋底注册的行走姿态，预检当前和下一步可达窗口，保留支撑快照并明确反馈不可达或缺少转向视图；公开朝向接口在绘制前保留当前视图，避免拒绝转向后外层仍镜像。恢复窗口不代替缺失的跨姿态素材。`authored_motion.py` 校验姿势、接触平面、五官映射、可选五官源矩形、互斥的四肢绑定方式及全局唯一分件引用；`whale_package.py` 另按所有服饰实际 PNG 尺寸校验源矩形；`whale_motion.py` 校验鲸鱼版本 2 的完整姿势、固定头发／鳍尾／裙摆层、原生眼睑纹理与非退化五官投影；`human_motion.py` 按骨架类型分派专属校验。`whale_package.py` 仅对通过完整版本 2 校验的人物或鲸鱼允许 128 分件，其他包保持 80，ZIP 与图片预算不变。跨姿势素材使用原站姿头高、躯干和骨段标尺校准物理比例，不能按各姿势轮廓总高度缩放；旧完整姿势和独立蒙皮包保留兼容路径。`record-pet-motion.cjs` 输出正常速度 GPU 录像；`pet-recording-timeline.cjs` 区分渲染时间与编码源 PTS，`extract-pet-source-frames.cjs` 按原始源帧索引分批提取，每批最多 48 项，保留源索引、PTS 与 SHA，不插帧补足频率。循环至少每秒检查 10 个原始帧，起停逐帧；录制目标帧率不等于实际源帧率；`record-live-pet.cjs` 在实际隔离桌宠接受指针手势及宿主移动期间记录工作区位置与渲染画面，异步编码快照并消费实际确认事件，保存输入指针、确认序号及接收时间，不以请求目标或旧位置替代回执。素材视觉验收与数值／安全校验分开，旧验收已撤回，候选仍需完整服饰与鲸鱼验收。边缘与滑翔习惯仍属于既有 `PetConfig` JSON 和 CAS。

`locomotion/motionAvailability.ts` 统一识别旧版本 1 人物包缺少完整动作视图；运行页暂停其自主运动，中央舞台禁用运动演示和新增习惯，保留手动移动及站姿、坐姿、表情和换装。`humanFigure.ts` 停用这类包的旧横向切块及独立侧头混合路径；未写回已保存配置。运行页通过渲染器公开失败接口停止不可达轨迹并取消在途请求，不访问引擎内部状态。`motionTransitions.ts` 拥有可选版本 2 过渡端点、关键帧、原画显示基准和支点描述及安全读取；`motion_transitions.py` 复用人物／鲸鱼姿势校验，验证素材绑定一致、所有服饰的源矩形及附着端点／转角支点交接。`locomotion/transitions/transitionPlayer.ts` 拥有完整视图播放、实际世界支点校验、目标视图保留及缺少资源的失败反馈；`locomotion/transitions/poseBindings.ts` 一次编译六姿势与中间视图的分件绑定，人物／鲸鱼使用同一入口；`authoredWalkView.ts` 将移动方向转换为当前完整原画的求解坐标，保持原画与物理骨段尺寸，不在转向后硬镜像。渲染器通过私有只读 `PetPosePlayback` 反馈过渡进度，真实运动与试玩等待过渡结束后再推进位移和活动计时；按住通过公开取消接口结束旧播放并继续手动拖动，实际腰点包含当前身体补偿。离散原画与数值校验不表示自然过渡已视觉验收。编辑器 CAS 保存成功后通过既有可信资源变更桥通知同项目桌宠重新读取基线，通知失败单独反馈，不重试保存；运行中的临时换装和走动档位继续独立。

`web/src/features/desktop-pet/sequences/` 拥有完整序列帧的独立数据与播放职责：`types.ts` 定义统一画布、片段、原始帧和过渡端点；`transitions.ts` 拥有原帧身份比较、来源每帧分支覆盖、共享区间解析、过渡容器识别及实际已绘片段／帧的过渡选择，供读取、能力判断、播放器与图集加载共用；桥接终点与目标首帧的原画及注册严格一致时，可立即从目标首帧重播，内部非终点仍需要专用恢复资源；`capabilities.ts` 统一物理运动与事件预览的片段选择、完整帧资源读取状态、四边支撑声明与直接过渡端点能力，供渲染器和编辑器共用，不把资源声明当作视觉验收；`validation.ts` 安全读取严格的版本 1 描述，将可选 `cels` 字典引用逐次展开为独立原帧，校验单一等比比例、逐帧头部标尺 ±2%、局部抓点／足底／接触及支点、片段引用与解码后的原图裁切；未用声明仍在整包校验中检查，实际渲染只检查所选片段加载的图片；`player.ts` 按真实时钟或确认步相选择完整原帧，以宿主确认位移和真实显示比例维持支撑点，拒绝不一致的原画登记及没有支点交接的切换，以所选区间计时并保留绝对原帧索引，保留原位抓点、实际首尾与取消／失败反馈，不生成缺失的过渡原画；`figure.ts` 拥有完整帧画布、配色图集缓存、所选区间的有界解码与实际接触几何适配，将确认位移换算到模型单位，按当前片段报告循环距离，不用旧肢体或五官切片重组新姿势。`backend/app/apps/desktop_pet/frame_sequences.py` 校验同一私有包命名空间、全部登记帧及所有服饰实际图集范围，保留原始上传引用，声明数与片段使用次数共同计入既有 2048 帧预算；`whale_package.py` 将独立安全素材 ID 纳入既有授权 `tex/` 闭包；首套没有服饰前缀，其余使用 `schemes/{id}/tex/`，布局和尺寸一致。序列图集不消耗伪造的部件 ID，也不提高旧部件、ZIP、图片或模型 JSON 预算。完整帧与兼容 `motionRig` 可同包保存；缺帧或过渡不能靠旧运动素材补齐，新候选尚未通过正式视觉验收。

`sequences/distanceStages.ts` 拥有可选累积距离阶段的纯校验与采样，分开停住换支点的帧时钟和发力阶段的确认位移；`player.ts` 只从实际提交的完整帧发布本阶段剩余模型距离。`figure.ts` 依据实际显示 CTM 换算为私有 `PetPosePlayback.motionBudget` 的 DIP 距离、确认位移原点与取消代次。`locomotion/motionBudget.ts` 从这份有限预算扣除原点之后的已确认位移，控制器限制整个尚未确认的目标，不能将反复读取旧反馈当成新额度；手动拖动保持原有优先级。实际与虚拟运动在暂停、配置或环境变化时经公开渲染器接口取消阶段，迟到回执仍由原宿主代次拒绝；附着休息继续按活动结束后 7／17 秒计时。该契约不提高资源预算，不替代完整原画和真实支撑验收。

`sequences/viewport.ts` 仅按完整序列共用 `modelBox` 计算中央舞台的等比取景与模型参考点，不按单帧可见轮廓拟合、不修改作者比例或支点登记。`WhaleRenderer.tsx` 通过私有 `bounds.centerX` 将相机参考点交给 `whale-vendor/pet-core.js`，原地模式在 resize 时重新居中，按住仍保留本次鼠标锚点；旧角色与实际桌宠的 floor 视图继续使用原取景。

人物基础绘制表面的生命周期由 `humanFigure.ts` 独立管理；`sequences/figure.ts` 只在完整原帧真正绘制并提交可见状态后通过公开 `releaseRenderSurface` 退休已隐藏的 GL／脸部／画布，不把配色与图片缓存一起销毁。等待或首次失败保留原站姿，退休后换装仍校验但不重新上传隐藏纹理；需要基础绘制时建立新画布并恢复当前已接受配色，最终 dispose 永久关闭实例。旧无序列包不经过退休入口，鲸鱼与 Live2D 不受该人物表面优化影响。

完整帧异步读取反馈由 `sequences/figure.ts` 持有，`WhaleRenderer.tsx` 读取并显示，运动控制器仅通过公开反馈判断成功提交后的恢复，不把解码完成当作画面成功；原通信错误保持单独生命周期。`whale-vendor/pet-core.js` 拥有本次抓取的固定模型锚点和外层缓动点，通过可选 `WhaleFrame.heldPickupPoint` 将固定点交给完整帧适配器，保留旧 figure 的 `gripPoint` 语义。播放器、源图比例、宿主放置和退出原画职责不合并。

私有 `WhaleFigure.groupFacing` 区分原画显示基准与请求运动方向；core 在构造和推进时仅接受确切 ±1，完整帧和已停用旧运动的版本 1 正面人物固定 +1，避免鼠标追随压窄／镜像后与拎起输入突变。左右完整帧仍由片段选择负责，缺少能力不合成原画；未声明或非法值保持旧 figure 策略。`sequences/figure.ts` 按实际 Image、裁切、原生画布尺寸与配色复用位图，当前样本、几何、抓点、时钟及错误反馈仍逐次提交；图集淘汰和最终释放解除引用，不扩大解码缓存预算。

`WhaleFigure.hitTest` 是可选的模型坐标命中入口；`whale-vendor/pet-core.js` 拥有已显示根变换的逆投影，明确的 false 不再回退旧圆形，null 或未实现时保留基础角色判定。`sequences/figure.ts` 仅对已成功绘制的完整帧，按实际模型框、平移与图集原矩形在复用的 1×1 CPU 画布采样原图 alpha；待加载或失败的新帧不取得旧画面的命中所有权，读取失败拒绝命中并通过既有素材反馈显示原因。命中检查不重解码图片、不读回主渲染画布、不重建角色，也不修改原图透明度。

`desktop-pet/interaction.ts` 定义私有头部／身体／未命中分类及旧入口兼容，按已绘原帧冠顶至下巴轴建立有限头部椭圆；完整帧先验证可见像素，再分类。core 复用同一已安装变换逆投影，通过公开 `classifyHit` 交给渲染器；`PetRuntime.tsx` 和 `EditorStage.tsx` 只消费分类，不读取引擎内部或调试 DOM。null 是权威未命中，只有 undefined 表示基础角色或 Live2D 未实现该分类并沿用原热区；编辑器键盘试听保留原行为，鼠标透明空白不触发事件。 该模块也定义已悬停角色与真实按钮栏之间的有限上下通路；运行页只在像素及实际按钮均未命中时读取公开 client 可见范围和动作栏 ref，不以宿主整框填补透明区域。最近真实像素点须经公开命中接口复验，只有角色上下边附近的有限窄通路可连接轮廓空隙；真实栏含按钮间隙保持可达。测量失败或没有栏时拒绝连接，几何随当前已绘角色与按钮布局更新，不保存旧布局。

`sequences/player.ts` 通过同步 `present` 接口拥有采样与安装的提交边界，只快照动态播放、失败、进度和支撑状态，不逐帧复制资源描述；`figure.ts` 在 Canvas／DOM 安装成功时提交显示样本与时钟，安装异常使位图认证失效并恢复未显示的采样状态。正常等待与业务拒绝不回滚，隐藏基础表面释放在提交之后执行；原异常不被吞掉，不以自动取消、网络重试或放宽支撑校验代替恢复。

`backend/app/apps/desktop_pet/part_registration.py` 与 `web/src/features/desktop-pet/partRegistration.ts` 拥有静态素材登记与包／内部网格边界：可选 `restTransform` 仅绑定经过完整版本 2 校验的运行或中间姿势刚性骨段，角度和锚点有限，不用于头部、躯干或蒙皮。`whale-vendor/rig/rig.js` 在 GPU 装配时一次旋转已登记素材的静态顶点，原 UV、物理骨段及后续动画角不变；未知 JSON `mesh` 和未支持的 `restAngle` 不能进入包。该兼容能力不替代完整序列的新动作制作；未声明时旧包保留原行为。

桌宠资源更新由 `desktop_pet/projects.py` 拥有：完整 ZIP 验证、新 ID 素材准备和数据库 CAS 切换，失败补偿只清理本次文件，不修改原项目配置或私人聊天；`PackageUpdate.tsx` 提供编辑器正式上传入口。人物 `schemes.outfit` 登记可选站姿／坐姿衣物，`humanFigure.ts` 按姿态切换透明度，旧包继续沿用原行为。可信角色编辑器通过 `pet-window.ts` 的资源变更 IPC 刷新同账号、Workspace 和项目的桌宠素材，保留聊天窗口及消息流；SDK 通过 `desktop_pet.replace_package` 调用正式 API。

桌宠编辑器的 `editor-layout.css` 拥有三栏、1200px 以下的列表／预览／属性切换与舞台布局；`editor-controls.css` 拥有字段、自绘滑块、按钮及基于主题变量的 Radix 单选菜单；`workshop.css` 拥有项目列表状态与项目弹窗。紧凑面板只改变 CSS 可见性，不重建舞台或保存 UI 状态。`SkinUpload.tsx` 提供有名称、可键盘触发的 PNG 上传适配，文件继续走原业务用例。`useChatHistoryScroll.ts` 管理阅读位置、历史前插补偿和距底部 48px 内的新回复跟随，聊天请求与分页状态仍归 `ChatWindow.tsx`。`web/e2e/desktop-pet-ui.spec.ts` 覆盖六个编辑步骤、项目弹窗、明暗主题与菜单边界，默认使用合成数据包，可通过环境变量显式提供本地角色包作目视验收。
`desktop/scripts/inspect-pet-ui.cjs` 随隔离桌宠烟测检查菜单、主题、悬停操作、聊天阅读位置及临时读取失败后的恢复，截图输出沿用烟测的显式目标目录。

## 视觉项目看板与输出历史

`board/MaterialTree.tsx` 为已有媒体输出提供项目素材拖拽数据；`generation/useProjectReferenceDrop.ts` 拥有生成参考框的拖入解析、项目文件与类型校验、去重及数量限制，参考框通过原草稿回调保存当前文件。全能参考栏统一按媒体类型路由拖入，不改变节点连线或来源选择。

`backend/app/apps/visual_workshop/outputs/` 拥有节点输出 ORM、历史分页、最终版本 CAS、输入解析与提交快照、上传事务及快照重映射；包入口提供 `register_imported_output`，供视频剪辑分段交接在取得画布 CAS 写锁后、同一事务内登记素材版本；`routes/outputs.py` 只负责协议适配。`canvas.py` 保留节点身份、分类与连线整体 CAS，兼容旧素材写入并统一登记版本。`generation_runner.py` 在落盘后短事务中幂等归档输出。`web/src/features/visual-workshop/board/` 拥有项目素材树、创作工作台、状态分组、历史预览与输入选择，并按素材整理、管理菜单、节点元信息与状态呈现拆分；shell、工作台与状态卡样式按职责独立维护。生成组件通过显式 `layout` 参数适配工作台，保留画布布局；画布控制器统一持有草稿、选择与视口，项目页保留两种视图切换时的历史预览。

视觉画布 `canvasPlacement.ts` 拥有卡片与节点组的有界避让，`canvasLayout.ts` 拥有稳定的流程与网格布局，`canvasVisibleArea.ts` 计算排除固定控件后的可见区域；`useCanvasSpatialActions.ts` 将纯位置结果接入视口、整体保存与单次撤销。各新增入口共用该能力，临时编辑面板不影响持久布局。后端 `visual_workshop/node_placement.py` 只处理后台自动节点，显式 API 坐标沿用原契约；`tests/fixtures/visual_node_placement.json` 同时约束前后端尺寸与默认避让结果。

`backend/app/llm/providers/volcengine_image.py` 拥有方舟 Seedream 4.5 原生图片数组协议。共享 `generation_runtime/driver.py` 接收同步图片结果并持久化下载地址，提交中断禁止重提。迁移 `r0086_visual_node_outputs` 回填明确关联的历史，`r0087_volcengine_images` 扩展供应商枚举，保留旧模型凭证与任务数据。
