# AGENTS.md

## 开始前

- 每次正式处理仓库任务前先阅读本文件；所有命令默认在仓库根目录执行。
- 本项目定位为单机部署的模型基础设施管理台，支持同一进程和同一 SQLite 内的多账号与逻辑多
  Workspace 隔离；实时语音仅用于模型测试，不引入 Bot、模型检索知识库（RAG）、电话接入、浏览器扩展或多实例部署能力。
  思绪工坊中的「知识库」仅表示文档项目容器，沿用 Workspace 权限与 AI 写作。
- 目录职责以 [`docs/architecture/project-layout.md`](docs/architecture/project-layout.md)
  为唯一完整索引；新增目录或改变职责时同步更新该文件。
- Python 命令与临时诊断优先通过 `uv run` 执行。
- 仓库二进制资产使用 Git LFS；缺少对象时先按路径选择性 `git lfs pull`，不得把 LFS 指针当作字体、
  模型或图片内容处理。
- 后端持久配置只放在 `backend/config.toml`，按分组使用 TOML 原生类型；进程环境变量可供测试与部署覆盖。
  `.env` 仅用于一次性转换，成功后归档为 0600 备份，不再读取。不得提交真实配置或备份，不得输出密钥。
  `backend/fpl_config/` 是不依赖运行时 `app` 或数据库的共享配置格式和转换模块。
- 非机械性的行为、架构、跨文件契约、流程工具链、测试策略或落盘/网络/配置格式改动，按
  `docs/operations/agent-notes.md` 在 `.agents/notes/` 创建或更新 Agent Note；纯格式化、样式、无歧义重命名和局部机械修复免写。
- `web/src/docs/`、`web/public/docs/`、文档中心覆盖清单和 `scripts/generate_sdk_docs.py` 是产品文档中心的受保护内容。工程决策整理不得迁移、删除、重写或重新生成这些路径。

## 常用命令

- 安装后端与 Web 依赖：`npm run setup`。
- 一键启动后端与 Web：`npm run dev`；单独启动使用 `npm run dev:backend`、
  `npm run dev:web`。
- 桌面热加载：`npm run dev:desktop` 使用正式 App 数据；需要隔离时使用
  `npm run dev:desktop:isolated`，`npm run dev:desktop:live` 保留为同一正式数据入口的兼容别名。
  源码检查后手动应用后端/Electron 更新；
  热加载烟测使用 `npm run test:desktop:dev`，始终在临时目录运行。
- 数据库迁移：`npm run db:migrate`；只检查迁移状态：`npm run db:migrate:check`。
- OpenAPI 生成与 stale-check：`npm run contracts:generate`、`npm run contracts:check`。
- 测试：`npm test`；浏览器端到端测试：`npm run test:e2e`。
- 质量检查：`npm run lint`、`npm run format:check`、`npm run build`；需要自动格式化时使用
  `npm run format`。
- Git LFS：`npm run lfs:check:pointers` 检查指针，`npm run lfs:check` 检查生产运行资产。
- Agent Note：`npm run verify-notes` 检查树结构、格式和归档封印；`npm run check-docs-center-protected` 检查文档中心保护路径。

## 应用与目录边界

- `backend/app/` 按垂直切片装配：`main.py`、`deps.py`、`problem_details.py`、`api.py` 与
  `orm.py` 负责应用装配；无业务语义的基础设施归属
  `runtime/`；有契约的共享能力归属 `capabilities/`（含 asset_store 自有 VisualAsset ORM、files 契约与媒体
  routes/schemas）；Studio
  治理与库级文件用例归属 `console/`（含自有 models/routes/schemas）；已垂直切片的产品 App 归属 `apps/`（目前
  `presentation_workshop`、`audio_annotation`、`thought_workshop`、`video_editor`、`visual_workshop`、
  `galgame_workshop` 已迁入）；`llm/` 拥有目录/供应商/测试台/推理与自身 models/schemas/routes；
  `integrations/`、`tool_navigation/`、`demo_runtime/` 各自拥有 models/schemas/routes（demo 无独立 ORM）。
  顶层不再保留 `models/`、`schemas/`、`routes/` 横向包。
- 路由模块不得直接导入 SQLAlchemy、ORM 模型或 `db.migrations`，不得自行持有查询、写入和
  事务规则。它们只校验请求、调用功能模块并把领域结果或错误映射为协议响应；`apps/*/routes/`、
  `llm/routes/`、`console/routes/`、`capabilities/*/routes/` 与各业务包 `routes.py` 遵守同一边界。
- 不新增 `services/`、`domain/`、`platform/`、`product/` 等通用后端抽象层目录。需要拆分时，
  在所属能力内按具体职责命名文件或子包，例如 `llm/catalog/`、`capabilities/asset_store/`。
- 业务 API 统一注册在 `/v1`；只有 `/health` 与 `/ready` 作为根级探针。
- `desktop/` 只拥有 Electron 壳、私有启动协议和打包。桌面数据根为
  `~/Library/Application Support/Future Props Lab/`，隔离开发版为 `Future Props Lab Development/`；
  `runtime/` 保存数据库与素材，`backend/config.toml` 保存配置与加密密钥，禁止复制仓库运行数据。
  桌面配置必须在数据库模块导入前初始化。仅桌面入口托管 Web 静态页，HTML 回退仅用于页面导航，
  未知 `/v1` API 与缺失资源仍为 404；首次账号接口仅在桌面私有凭据边界内启用。
- 默认桌面开发使用正式数据是受控流程，不复制或合并仓库数据；隔离开发仍通过
  `dev:desktop:isolated` 使用独立目录。启动器持有数据锁，覆盖
  后端/Electron 更新交接；首次正式数据入口运行停机备份完整 `runtime/` 与配置并核验 SHA256 和 SQLite
  完整性。备份在同级 `Future Props Lab Development Backup …/`，最近成功配置在
  `development/last-success-config.toml`（0600）。配置变更前保留停机快照；新增/漂移迁移阻止启动和
  应用更新，不在热加载流程内执行正式迁移。更新不得绕过未保存保护或自动重试写入/模型提交。
  开发网关在同一窗口生命周期内保持来源稳定，只向固定 Vite/后端转发并校验私有凭据；Vite 不代理
  业务 API。正式打包不启用开发桥或开发网关，自动测试不得使用 live 数据。
- 桌面 CLI/SDK 接入默认关闭。`agent/` 保存无密钥的连接描述和 `0600` 客户端凭据，目录为
  `0700`；短路径 Unix Socket 由 Electron 持有，私有启动 token 不得交给 SDK。Agent 通道只开放
  `console/governance/desktop_agent_operations.json` 明确登记的业务操作，新 API 默认拒绝。配对与界面请求
  只保存在内存，授权复用 Management API Key；不得通过 Agent 通道开放账号治理、密钥管理或系统命令。
  `fpl` 随 App 打包，独立 Python SDK 不依赖后端；自动化验收必须使用临时数据目录。
- Web 保持 `app/ + features/ + shared/ + platform/ + generated/`：`app/` 负责入口、壳与路由，
  `features/` 拥有业务页面和用例，`shared/` 放无业务归属的复用 UI，`platform/` 放 API 与认证
  基础设施，`generated/` 只保存生成契约。
- Web 的 `platform/` 与 `shared/` 不得依赖 `features/` 或 `app/`，`features/` 不得依赖
  `app/`；业务代码不得堆回 `web/src/` 根目录。生产请求通过 OpenAPI 生成类型访问后端，
  `generated/` 文件不得手工编辑。
- Models、Visual Workshop、Thought Workshop、Presentation Workshop、Audio Annotation 与 Integration Center 的 TanStack Query 键由各自 `queryKeys.ts` 唯一
  维护；跨功能消费者导入 owner 的 key factory，不得复制同名缓存键。鉴权文件预览统一使用
  `platform/api/useApiBlobUrl.ts` 管理取消、竞态和 Object URL 回收；自有缓存或多音轨播放器除外。
- Web 中面向用户可见的交互控件不得直接暴露浏览器默认外观或原生弹层。下拉菜单、颜色选择、
  日期选择等必须使用项目自绘组件并适配明暗主题；原生 `select`、`input[type="color"]`、
  `input[type="date"]` 仅可作为完全隐藏的底层能力，不能作为最终可见 UI。新增或修改页面时应
  同步检查键盘操作、焦点状态与无障碍标签，避免因浏览器或操作系统不同出现不一致样式。
- 模型与供应商差异在 `backend/app/llm/providers/` 的适配边界内归一化。公共 REST/SSE、模型
  测试和调用日志契约保持供应商无关；供应商管理页面可以展示配置，但前端运行流程不得依赖
  供应商原始事件。
- 图片/视频后台任务的状态转换由 `llm/generation_runtime.GenerationTaskDriver` 唯一编排；各功能
  只提供任务存取、素材组装/落盘和调用日志钩子。`submitting` 中断必须安全失败，禁止自动重提。
- 确定性时间线画面与视频渲染由 `backend/app/capabilities/media_rendering/` 统一拥有；Galgame 直接导出不得
  依赖 `video_editor/` 实现，只有显式的视频编辑器交接用例可以跨功能调用。
- ORM 的 ID/时间默认工厂由 `runtime/ids.py` 与 `runtime/time.py` 维护；各包 ORM 模型只依赖
  `runtime.orm_base` 与上述工厂。生产 Python 包不得形成强依赖环。Workspace 项目记录的加载、CAS
  更新和删除原语可复用 `runtime/project_records.py`，但事务、默认文档、快照和领域规则必须留在所属功能包。
  编辑批处理回执与传输形状归属 `runtime/project_operations.py`、`runtime/operation_batches.py`。
- Story 总校验保持纯函数分层：身份/角色、素材、国际化、时间轴、流程与表现层规则归属
  `apps/galgame_workshop/schemas/story_validation.py`；Pydantic Story 入口只负责迁移适配和统一调用。
- 鉴权原语归属 `capabilities/identity/`；账号、Session、审计、Management API Key 与 Workspace 治理归属
  `console/governance/`；`StudioPrincipal` 是业务请求的唯一租户来源，业务 API 不接受客户端提交
  `workspace_id`。路由需要显式租户参数时使用 `WorkspaceDep`；不得新增 ContextVar、`default`
  回退或其他环境式 Workspace 来源。业务文件用例依赖 `capabilities.asset_store.IncomingFile`，
  `UploadFile` 只能出现在路由适配层；`AssetStorage` 的项目路径与写入方法必须显式传入
  `workspace_id`。根资源必须直接保存 `workspace_id`，子资源通过已校验的根资源继承；跨 Workspace
  的 ID 一律按不存在处理。后台执行器必须从任务记录恢复 Workspace，不能依赖请求上下文。
- 固定 Workspace 权限由 `capabilities/identity/permissions.py` 维护，业务 HTTP/SSE 操作必须登记在
  `capabilities/identity/route_permissions.py`；架构测试禁止未登记路由。Web 统一消费 Principal 的有效权限，
  只读浏览页面由各功能模块拥有，账号查询键由 `features/accounts/queryKeys.ts` 唯一维护。
- 平台模板同步项与运行额度记录属于 `console/governance/`，跨空间访问由治理用例显式校验；固定演示运行时
  `demo_runtime/` 不得依赖账号治理或模型目录，治理入口仍在 `console/governance/`。
- Web 不保存密码、Session、CSRF 或 Management API Key 明文；Session 只使用 HttpOnly Cookie，
  写请求统一携带可读 CSRF Cookie 对应的请求头。API Key 明文和临时密码只允许展示一次。
- 修改安装、启动、环境变量、依赖或目录路径时，同步检查根与 Web 的 `package.json`、
  `pyproject.toml`、脚本、README 和 CI/测试入口。
- `scripts/demo/` 只保存内容专用演示维护工具；必须通过正式 API 操作，并要求调用者显式提供项目 ID、
  素材根目录和输入/输出路径，不得保存本机绝对路径或默认目标项目。

## SDK 与文档契约

- Python SDK 位于 `sdk/python/`，不依赖后端运行时。`generated/` 由 OpenAPI 和 `operations.json` 生成，不手工编辑。
- 修改公共接口后运行 `npm run contracts:generate`，同时更新 SDK 与文档参考；`npm run sdk:check` 检查生成物。具名方法覆盖不等于业务闭环测试。
- 独立模型任务归属 `llm/inference/`；备份 Workspace 时一并保留 `model-inference/inputs/`、`model-inference/outputs/`。提交中断禁止重新提交供应商。

## SQLite、迁移与并发

- `.runtime/future-props.db` 是默认单机 SQLite 真源。FastAPI 启动时会自动应用已登记迁移，
  并为连接启用外键、WAL 和忙等待；不要把该行为替换成 Sayflow 的 PostgreSQL 多实例方案。
- 绝对禁止通过 `sqlite3`、临时 Python/SQL 脚本、数据库客户端或其他绕过应用的方式，直接对
  任何持久数据库执行数据写入、修复、删库重建或 schema 修改；不得手工修改
  `schema_migrations`、迁移 checksum 或伪造迁移状态。命令行诊断仅允许只读查询。
- 运行期数据的创建、更新、删除、修复、导入、回填与管理能力必须设计为正式的 `/v1` API，
  经所属功能模块执行业务校验、事务、并发控制和错误映射；Web、测试工具与运维流程统一调用
  该 API，不得把直接操作持久数据库作为实现方案或故障恢复步骤。仅允许存储层和迁移测试在
  各自创建的临时隔离数据库中直接构造测试状态，测试结束后不得影响任何持久数据库。
- `npm run account -- create-admin|create-user|reset-password` 是账号恢复的离线入口，但只能调用
  `accounts/` 中与 HTTP 共用的正式用例，不得执行裸 SQL；首个管理员负责认领 `default` Workspace。
- `db/migrations/` 是唯一 schema 迁移入口。已登记迁移的 ID、顺序和 SQL 不得改写；修复或
  扩展只能在 `versions/` 追加新版本并更新 `registry.py`。
- schema 演进只能通过新增并登记 migration 完成；migration 可以承担 schema 所必需的确定性
  数据变换，但不得替代面向运行期数据管理的 API。迁移首次写入真实持久数据库前必须先在
  临时测试数据库完成验证并定稿，禁止一边运行应用自动迁移一边继续修改同一 migration。
- 任何 schema 或持久化兼容性变更必须同步更新 ORM、追加 migration、更新注册表、测试和
  数据/API 文档。迁移包不得导入运行时 `app`。
- `AsyncSession` 是单任务资源，不得由并行分支共享。外部模型请求、网络等待或大文件 I/O
  不得放在已经开始写入的长事务中；流式生成应使用独立短事务准备和结算状态。
- 整体 JSON、配置和会话等 revisioned 资源使用数据库 CAS：缺少 revision 返回 422，冲突
  返回 409 与当前快照，客户端不得静默覆盖。
- 备份数据库前先停止应用，并同时复制 SQLite 主文件、`workspaces/`、`profiles/`、
  `library/assets/`、`applications/` 与 `model-test/attachments/`、`model-test/references/`、
  `model-test/generated/`；不要把
  `.runtime/` 当作可提交的代码、
  迁移或测试资产。

## 测试、文档与质量门禁

- 后端单元/API/存储测试位于 `tests/`；Web 组件测试位于 `web/tests/`，浏览器旅程位于
  `web/e2e/`。可自动化验证的行为不得只写成人工说明。
- 架构测试用于守住依赖方向、迁移独立性、路由版本和核心目录；修改架构规则时应同时更新
  `AGENTS.md`、项目结构文档与对应测试，避免出现多个互相矛盾的事实源。
- HTTP 或 SSE 契约变化必须更新后端 schema/路由、OpenAPI 生成物、Web 消费端、API 参考和
  契约测试。
- 按改动范围运行 `npm test`、`npm run lint`、`npm run format:check`、
  `npm run contracts:check` 和 `npm run build`；缺少真实凭证时明确报告相关测试未执行，不得
  用真实供应商调用代替确定性测试。
- 单文件软上限：生产 Python 900 行、TS/TSX 1000 行、CSS 800 行，测试文件 1200 行；OpenAPI 等
  生成文件排除。没有任何尺寸豁免机制，超限只能按语义拆分，不得为了过门禁做机械切片。
- 真正约束体量的是目录预算：`web/src/apps|console` 与 `backend/app/apps|console|capabilities`
  下每一层目录直接持有的源码不超过 6000 行，超出必须再分出命名子域。这些目录内的文件名不得带
  `-foundation`、`-components`、`-interactions`、`-part\d*`、`-base`、`-extra`、`-misc` 后缀，
  也不得出现只做转发的空壳 `@import` 样式。不得新增编号式 CSS 分片；构建预算脚本只读产物，
  不得在构建后拆分或改写 CSS。
- App 之间默认零互相依赖。唯一例外是视频剪辑向视觉创作工坊的片段交接，登记在
  `tests/test_architecture.py` 的 `ALLOWED_APP_HANDOFFS`，且必须经目标 App 的公共入口。
- 新增 Web 路由或独立 HTML 入口时，同步更新 `web/e2e/responsive-inventory.ts` 与相应适配用例；
  页面不得依靠根级隐藏横向溢出来通过检查，复杂区域使用明确的局部滚动和可点击操作入口。
- 修复问题时先定位根因和同类风险；保留用户已有的未提交改动，不覆盖或顺手重写无关文件。
- 新增或替换 `docs/` 图片、固定字体或 VAD 二进制时同步更新 `docs/assets/MANIFEST.md`，并执行
  `git lfs fsck`；未核清来源和许可证的演示素材不得视为可再分发资产。
